import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect, test } from '@playwright/test';
import { sessionReplySchema } from '../src/messaging/contracts';
import { eventsReplySchema } from '../src/messaging/capture';

test('keeps recording across hash/history navigation and stops when the document is replaced', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'scope-document-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const page = await context.newPage();
    await page.route('https://scope-document.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<a href="#first">First section</a><a href="#second">Second section</a><button onclick="history.pushState(null, \'\', \'/route\')">Push route</button><button onclick="history.replaceState(null, \'\', \'/replaced\')">Replace route</button><button>Action</button>',
      }),
    );
    await page.goto('https://scope-document.example/');
    await expect
      .poll(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()))
      .toEqual({ openPanelOnActionClick: false });
    const browser = context.browser();
    if (!browser) throw new Error('Browser missing');
    const cdp = await browser.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((entry) => entry.url === page.url());
    if (!target) throw new Error('App tab missing');
    await cdp.send('Extensions.triggerAction', {
      id,
      targetId: target.targetId,
    });
    await panel.getByRole('button', { name: 'Start session' }).click();
    const current = async () => {
      const reply = sessionReplySchema.parse(
        await panel.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'scope/get-session' }),
        ),
      );
      if (reply.status !== 'ok' || !reply.session)
        throw new Error('Session unavailable');
      return reply.session;
    };
    const started = await current();
    expect(started.documentId).toBeTruthy();
    expect(started.status).toBe('active');
    for (const label of [
      'First section',
      'Second section',
      'Push route',
      'Replace route',
      'Action',
    ]) {
      await page
        .getByRole(label.endsWith('section') ? 'link' : 'button', {
          name: label,
          exact: true,
        })
        .click();
      const session = await current();
      expect(session.status).toBe('active');
      expect(session.id).toBe(started.id);
      expect(session.documentId).toBe(started.documentId);
    }
    const count = async () => {
      const reply = eventsReplySchema.parse(
        await panel.evaluate(
          (sessionId) =>
            chrome.runtime.sendMessage({ type: 'scope/get-events', sessionId }),
          started.id,
        ),
      );
      if (reply.status !== 'ok') throw new Error('Events unavailable');
      return reply.snapshot.count;
    };
    await expect.poll(count).toBe(5);
    await page.reload();
    await expect.poll(async () => (await current()).status).toBe('interrupted');
    expect((await current()).endReason).toBe('page-navigation');
    await page.getByRole('button', { name: 'Action', exact: true }).click();
    await page.evaluate(() => new Promise((done) => setTimeout(done, 350)));
    expect(await count()).toBe(5);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
