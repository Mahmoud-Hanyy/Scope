import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { sessionReplySchema } from '../src/messaging/contracts';
import { eventsReplySchema } from '../src/messaging/capture';

test('records inline startup failures after an explicit reload and removes temporary scripts', async () => {
  const profile = await mkdtemp('/tmp/scope-reload-');
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await context.route('https://scope-reload.example/**', (route) => {
      if (new URL(route.request().url()).pathname === '/api/model')
        return route.fulfill({ status: 503, body: 'Not available' });
      return route.fulfill({
        contentType: 'text/html',
        body: `<script>
        window.originalFetch = fetch;
        fetch('/api/model').then(() => { throw new TypeError('private error must not persist'); });
        </script><button onclick="fetch('/api/model')">Request</button>`,
      });
    });
    const page = await context.newPage();
    await page.goto('https://scope-reload.example/');
    const browser = context.browser();
    if (!browser) throw new Error('Browser unavailable');
    const cdp = await browser.newBrowserCDPSession();
    const grant = async () => {
      await page.bringToFront();
      const { targetInfos } = await cdp.send('Target.getTargets', {
        filter: [{ type: 'tab' }],
      });
      const target = targetInfos.find((t) => t.url === page.url());
      if (!target) throw new Error('Tab unavailable');
      await cdp.send('Extensions.triggerAction', {
        id,
        targetId: target.targetId,
      });
    };
    await grant();
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
    await panel
      .getByRole('button', { name: 'Record and reload', exact: true })
      .click();
    await expect
      .poll(async () => {
        const session = await current();
        return session.status === 'active' && !session.reload;
      })
      .toBe(true);
    const started = await current();
    expect(started.documentId).toBeTruthy();
    const snapshot = async () => {
      const reply = eventsReplySchema.parse(
        await panel.evaluate(
          (sessionId) =>
            chrome.runtime.sendMessage({ type: 'scope/get-events', sessionId }),
          started.id,
        ),
      );
      if (reply.status !== 'ok') throw new Error('Events unavailable');
      return reply.snapshot;
    };
    await expect.poll(async () => (await snapshot()).count).toBe(3);
    const recorded = await snapshot();
    expect(recorded.events.map((e) => e.type)).toEqual([
      'request',
      'response',
      'promise-rejection',
    ]);
    expect(
      recorded.events.every((e) => e.documentId === started.documentId),
    ).toBe(true);
    expect(recorded.events[1]).toMatchObject({ data: { status: 503 } });
    expect(JSON.stringify(recorded)).not.toContain('private error');
    expect(
      await worker.evaluate(() =>
        chrome.scripting.getRegisteredContentScripts(),
      ),
    ).toEqual([]);
    await panel
      .getByRole('button', { name: 'Stop session', exact: true })
      .click();
    expect((await current()).status).toBe('stopped');
    await page.getByRole('button', { name: 'Request', exact: true }).click();
    await page.waitForTimeout(350);
    expect((await snapshot()).count).toBe(3);
    // The reload script no longer prepares this or other pages after the claim.
    await page.reload();
    expect(await page.evaluate(() => '__scopeNetworkCaptureV1' in window)).toBe(
      false,
    );
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
