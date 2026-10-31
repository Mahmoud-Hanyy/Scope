import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { sessionReplySchema } from '../src/messaging/contracts';

test('built extension connects after toolbar invocation and reports missing access', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'scope-e2e-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 380, height: 780 },
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(
      page.getByRole('heading', { name: 'Connect to your page' }),
    ).toBeVisible();
    await expect(
      page.getByRole('status', { name: 'Connection status' }),
    ).toContainText('has not been checked');
    // Opening an extension URL does not grant activeTab. Exercise the real
    // runtime response channel without adding host permissions just for tests.
    await page.getByRole('button', { name: 'Check connection' }).click();
    await expect(
      page.getByRole('status', { name: 'Connection status' }),
    ).toContainText('Page unavailable');
    await expect(
      page.getByRole('button', { name: 'Check connection' }),
    ).toBeEnabled();
    await expect(
      page.getByRole('heading', { name: 'Debugging session' }),
    ).toBeVisible();

    const webpage = await context.newPage();
    await webpage.route('https://scope-test.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<h1>Scope test page</h1>',
      }),
    );
    await webpage.goto('https://scope-test.example/');
    await webpage.bringToFront();
    await expect
      .poll(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()))
      .toEqual({ openPanelOnActionClick: false });

    const browser = context.browser();
    if (!browser) throw new Error('Browser unavailable');
    const session = await browser.newBrowserCDPSession();
    const { targetInfos } = await session.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((entry) => entry.url === webpage.url());
    if (!target) throw new Error('Test webpage tab missing');
    // Trigger the real toolbar action so Chrome grants activeTab; no test-only
    // host permissions or mocked scripting APIs are used.
    await session.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: target.targetId,
    });
    await page.getByRole('button', { name: 'Check connection' }).click();
    await expect(
      page.getByRole('status', { name: 'Connection status' }),
    ).toContainText('Connected to the current page');
    await page.getByRole('button', { name: 'Check connection' }).click();
    await expect(
      page.getByRole('status', { name: 'Connection status' }),
    ).toContainText('Connected to the current page');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(
      page.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session active');
    const started = sessionReplySchema.parse(
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'scope/get-session' }),
      ),
    );
    if (started.status !== 'ok' || !started.session)
      throw new Error('Session not persisted');
    await expect(page.getByLabel('Session duration')).not.toHaveText(
      '00:00:00',
    );
    await page.reload();
    await expect(
      page.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session active');

    // Force termination rather than merely reopening the UI: the next message
    // must wake a fresh worker and recover the same session from IndexedDB.
    const panelSession = await context.newCDPSession(page);
    const version = new Promise<string>((resolveVersion) => {
      panelSession.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        const running = versions.find(
          (entry) =>
            entry.scriptURL === worker.url() &&
            entry.runningStatus === 'running',
        );
        if (running) resolveVersion(running.versionId);
      });
    });
    await panelSession.send('ServiceWorker.enable');
    await panelSession.send('ServiceWorker.stopWorker', {
      versionId: await version,
    });
    await page.getByRole('button', { name: 'Refresh session' }).click();
    await expect(
      page.getByRole('button', { name: 'Stop session' }),
    ).toBeEnabled();
    const restored = sessionReplySchema.parse(
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'scope/get-session' }),
      ),
    );
    expect(restored).toEqual(started);

    await page.getByRole('button', { name: 'Stop session' }).click();
    await expect(
      page.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session stopped');
    const stoppedDuration = await page
      .getByLabel('Session duration')
      .textContent();
    await page.reload();
    await expect(
      page.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session stopped');
    await expect(page.getByLabel('Session duration')).toHaveText(
      stoppedDuration ?? '',
    );

    // Starting a new session requires a fresh connection to the target page.
    await webpage.bringToFront();
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(
      page.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session active');
    await webpage.close();
    await expect(
      page.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session interrupted');
    await expect(page.getByText('Tab closed', { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: 'test-results/sidepanel.png',
      fullPage: true,
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
