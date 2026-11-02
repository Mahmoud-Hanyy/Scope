import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { eventsReplySchema } from '../src/messaging/capture';
import { sessionReplySchema } from '../src/messaging/contracts';
import { analysisReplySchema } from '../src/messaging/analysis';

test('turns a failed form action and runtime error into an explainable downloadable incident', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'scope-incidents-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 380, height: 820 },
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const webpage = await context.newPage();
    const nativeErrors: string[] = [];
    webpage.on('pageerror', (error) => nativeErrors.push(error.name));
    await webpage.route('https://scope-incidents.example/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/')) {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'private-response-body',
        });
      } else if (path === '/fixture.js') {
        await route.fulfill({
          contentType: 'application/javascript',
          body: `
          window.addEventListener('unhandledrejection', () => { document.documentElement.dataset.rejectionSeen = 'true'; });
          window.onerror = () => { document.documentElement.dataset.exceptionSeen = 'true'; };
          document.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            void fetch('/api/orders/private-id?token=private-query', { method: 'POST', headers: { Authorization: 'Bearer private-token' }, body: 'private-request-body' })
              .then(response => { document.querySelector('#result').textContent = 'HTTP ' + response.status; throw new TypeError('private-error-message'); });
          });
          document.querySelector('#exception').onclick = () => { setTimeout(() => { throw new ReferenceError('private-exception-message'); }, 0); };
          document.querySelector('#rejection').onclick = () => { void Promise.reject('private-rejection-value'); };
        `,
        });
      } else {
        await route.fulfill({
          contentType: 'text/html',
          headers: {
            'Content-Security-Policy':
              "default-src 'none'; script-src 'self'; connect-src 'self'",
          },
          body: '<form><button type="submit">Reproduce failed action</button></form><button id="exception">Throw exception</button><button id="rejection">Reject value</button><p id="result"></p><script src="/fixture.js"></script>',
        });
      }
    });
    await webpage.goto('https://scope-incidents.example/');
    await expect
      .poll(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()))
      .toEqual({ openPanelOnActionClick: false });
    const browser = context.browser();
    if (!browser) throw new Error('Browser missing');
    const session = await browser.newBrowserCDPSession();
    const { targetInfos } = await session.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((entry) => entry.url === webpage.url());
    if (!target) throw new Error('Webpage target missing');
    await session.send('Extensions.triggerAction', {
      id,
      targetId: target.targetId,
    });
    await panel.getByRole('button', { name: 'Start session' }).click();
    await expect(
      panel.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session active');
    const started = sessionReplySchema.parse(
      await panel.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'scope/get-session' }),
      ),
    );
    if (started.status !== 'ok' || !started.session)
      throw new Error('Session missing');
    const sessionId = started.session.id;
    const snapshot = async () => {
      const reply = eventsReplySchema.parse(
        await panel.evaluate(
          (sessionId) =>
            chrome.runtime.sendMessage({ type: 'scope/get-events', sessionId }),
          sessionId,
        ),
      );
      if (reply.status !== 'ok') throw new Error('Snapshot failed');
      return reply.snapshot;
    };
    const analyze = async () => {
      const reply = analysisReplySchema.parse(
        await panel.evaluate(
          (sessionId) =>
            chrome.runtime.sendMessage({
              type: 'scope/analyze-session',
              sessionId,
            }),
          sessionId,
        ),
      );
      if (reply.status !== 'ok') throw new Error('Analysis failed');
      return reply.analysis;
    };

    await webpage
      .getByRole('button', { name: 'Reproduce failed action' })
      .click();
    await expect(webpage.locator('#result')).toHaveText('HTTP 500');
    await expect
      .poll(
        async () =>
          (await snapshot()).events.filter(
            (event) => event.type === 'promise-rejection',
          ).length,
      )
      .toBe(1);
    expect(
      await webpage.evaluate(
        () => document.documentElement.dataset.rejectionSeen,
      ),
    ).toBe('true');
    const initial = await analyze();
    expect(initial.incidents).toHaveLength(1);
    expect(initial.incidents[0]?.events.map((event) => event.type)).toEqual([
      'submit',
      'request',
      'response',
      'promise-rejection',
    ]);
    expect(initial.incidents[0]?.links.map((link) => link.kind)).toEqual([
      'request-id',
      'nearby-action',
      'nearby-runtime',
    ]);
    expect(JSON.stringify(initial)).not.toContain('private-');

    await panel.getByRole('button', { name: 'Analyze session' }).click();
    await expect(panel.getByLabel('Analysis snapshot')).toContainText(
      '1 incident(s)',
    );
    const selected = panel.getByRole('article', { name: 'Selected incident' });
    await expect(selected).toContainText('TypeError');
    await expect(selected).toContainText('Timing does not prove causation');
    await expect(selected).toContainText('Exact pairing');
    await panel.screenshot({
      path: 'test-results/incident.png',
      fullPage: true,
    });
    const downloading = panel.waitForEvent('download');
    await panel.getByRole('button', { name: 'Download Markdown' }).click();
    const download = await downloading;
    const output = test.info().outputPath('incident.md');
    await download.saveAs(output);
    const report = await readFile(output, 'utf8');
    expect(report).toContain('HTTP 500');
    expect(report).toContain('POST /api/orders/[REDACTED]');
    expect(report).toContain('TypeError');
    expect(report).toContain('Timing does not prove causation');
    expect(report).toContain('Messages, stacks, rejection values');
    expect(report).not.toContain('private-');
    expect(report).not.toContain('scope-incidents.example');
    await panel.getByRole('button', { name: 'Copy report' }).click();
    await expect(
      panel.getByRole('status', { name: 'Report action' }),
    ).toHaveText('Report copied.');

    await webpage.getByRole('button', { name: 'Throw exception' }).click();
    await expect
      .poll(
        async () =>
          (await snapshot()).events.filter(
            (event) => event.type === 'exception',
          ).length,
      )
      .toBe(1);
    expect(
      await webpage.evaluate(
        () => document.documentElement.dataset.exceptionSeen,
      ),
    ).toBe('true');
    await webpage.getByRole('button', { name: 'Reject value' }).click();
    await expect
      .poll(
        async () =>
          (await snapshot()).events.filter(
            (event) => event.type === 'promise-rejection',
          ).length,
      )
      .toBe(2);
    const final = await analyze();
    expect(final.incidents).toHaveLength(3);
    expect(
      final.incidents.filter((incident) => incident.kind === 'runtime-error'),
    ).toHaveLength(2);
    expect(JSON.stringify(final)).not.toContain('private-');
    expect(nativeErrors.length).toBeGreaterThanOrEqual(2);
    await panel.getByRole('button', { name: 'Stop session' }).click();
    await expect(
      panel.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session stopped');
    const stoppedCount = (await snapshot()).count;
    await webpage.getByRole('button', { name: 'Throw exception' }).click();
    // Observe beyond the batch delay so an accidental post-Stop listener cannot
    // evade this assertion by leaving its event buffered.
    await webpage.evaluate(() => new Promise((done) => setTimeout(done, 350)));
    expect((await snapshot()).count).toBe(stoppedCount);
    const stored: unknown = await panel.evaluate(
      () =>
        new Promise((resolveResult, reject) => {
          const request = indexedDB.open('scope');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction('events', 'readonly');
            const rows = transaction.objectStore('events').getAll();
            rows.onsuccess = () => resolveResult(rows.result);
            rows.onerror = () => reject(rows.error);
            transaction.oncomplete = () => database.close();
          };
        }),
    );
    expect(JSON.stringify(stored)).not.toContain('private-');
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
