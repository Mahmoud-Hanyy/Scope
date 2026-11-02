import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

test('handles a worker that ignores a newer recording command without retrying or claiming success', async () => {
  const temporary = await mkdtemp('/tmp/scope-message-recovery-');
  const extension = join(temporary, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const backgroundPath = join(extension, 'background.js');
  const background = await readFile(backgroundPath, 'utf8');
  expect(background).toContain('scope/record-and-reload');
  // Emulate a stale worker that still supports the older session operations.
  // Only this temporary copy changes; the production build stays untouched.
  await writeFile(
    backgroundPath,
    background.replaceAll(
      'scope/record-and-reload',
      'scope/unsupported-test-command',
    ),
  );
  const context = await chromium.launchPersistentContext(
    join(temporary, 'profile'),
    {
      channel: 'chromium',
      headless: true,
      args: [
        '--enable-unsafe-extension-debugging',
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
      ],
    },
  );
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const page = await context.newPage();
    await page.route('https://scope-message.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<script>window.bootMarker = Math.random()</script><button>Action</button>',
      }),
    );
    await page.goto('https://scope-message.example/');
    const browser = context.browser();
    if (!browser) throw new Error('Browser unavailable');
    const cdp = await browser.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((target) => target.url === page.url());
    if (!target) throw new Error('Application tab unavailable');
    await cdp.send('Extensions.triggerAction', {
      id,
      targetId: target.targetId,
    });
    await panel
      .getByRole('button', { name: 'Start session', exact: true })
      .click();
    await panel
      .getByRole('button', { name: 'Stop session', exact: true })
      .click();
    await expect(
      panel.getByText(/No supported failures detected/),
    ).toBeVisible();
    const bootMarker = await page.evaluate(() =>
      Reflect.get(window, 'bootMarker'),
    );
    await worker.evaluate(() => {
      let count = 0;
      Object.defineProperty(globalThis, 'reloadCommandCount', {
        get: () => count,
      });
      chrome.runtime.onMessage.addListener((message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'scope/record-and-reload'
        )
          count++;
        return false;
      });
    });
    await panel
      .getByRole('button', { name: 'Record and reload', exact: true })
      .click();
    await expect(panel.getByRole('alert')).toContainText(
      'background worker returned no response',
    );
    await expect(panel.getByRole('alert')).toContainText(
      'Reload Scope in chrome://extensions',
    );
    await expect(panel.getByRole('alert')).not.toContainText('invalid_type');
    await expect(
      panel.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session stopped');
    expect(await page.evaluate(() => Reflect.get(window, 'bootMarker'))).toBe(
      bootMarker,
    );
    expect(
      await worker.evaluate(() =>
        Reflect.get(globalThis, 'reloadCommandCount'),
      ),
    ).toBe(1);
    await panel
      .getByRole('button', { name: 'Refresh session', exact: true })
      .click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(
      panel.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session stopped');
  } finally {
    await context.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
