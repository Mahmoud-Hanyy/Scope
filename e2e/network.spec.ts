import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { sessionReplySchema } from '../src/messaging/contracts';
import { eventsReplySchema } from '../src/messaging/capture';

test('captures real Fetch/XHR metadata under strict CSP and restores APIs on Stop', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'scope-network-e2e-'));
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
    await webpage.route('https://scope-network.example/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/error') {
        await route.abort('failed');
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/slow')
          await new Promise((done) => setTimeout(done, 1200));
        if (url.pathname.startsWith('/api/orders')) {
          expect(request.method()).toBe('POST');
          expect(request.postData()).toBe('private-request-body');
          expect(request.headers()['authorization']).toBe(
            'Bearer private-token',
          );
        }
        await route.fulfill({
          status:
            url.pathname === '/api/status'
              ? 503
              : url.pathname.startsWith('/api/items')
                ? 201
                : 200,
          contentType: 'text/plain',
          body: 'private-response-body',
        });
        return;
      }
      await route.fulfill({
        contentType: 'text/html',
        body: '<h1>Network fixture</h1>',
        headers: {
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; connect-src 'self'",
        },
      });
    });
    await webpage.goto('https://scope-network.example/');
    const originals = await webpage.evaluateHandle(() => ({
      fetch: window.fetch,
      open: XMLHttpRequest.prototype.open,
      send: XMLHttpRequest.prototype.send,
    }));
    const preparedXHR = await webpage.evaluateHandle(() => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/health');
      return { xhr };
    });
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

    expect(
      await webpage.evaluate(async () => {
        const response = await fetch(
          '/api/orders/private-id?token=private-query#private-fragment',
          {
            method: 'POST',
            headers: { Authorization: 'Bearer private-token' },
            body: 'private-request-body',
          },
        );
        return { status: response.status, text: await response.text() };
      }),
    ).toEqual({ status: 200, text: 'private-response-body' });
    expect(
      await webpage.evaluate(async () => (await fetch('/api/status')).status),
    ).toBe(503);
    expect(
      await webpage.evaluate(async () => {
        try {
          await fetch('/api/error');
          return false;
        } catch (error) {
          return error instanceof TypeError;
        }
      }),
    ).toBe(true);
    expect(
      await webpage.evaluate(async () => {
        const controller = new AbortController();
        const promise = fetch('/api/health', { signal: controller.signal });
        controller.abort();
        try {
          await promise;
          return false;
        } catch (error) {
          return error instanceof DOMException && error.name === 'AbortError';
        }
      }),
    ).toBe(true);
    expect(
      await webpage.evaluate(
        () =>
          new Promise<{ status: number; text: string }>(
            (resolveResult, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', '/api/items/private-id?token=private-query');
              xhr.onload = () =>
                resolveResult({ status: xhr.status, text: xhr.responseText });
              xhr.onerror = () => reject(new Error('XHR unexpectedly failed'));
              xhr.send('private-xhr-body');
            },
          ),
      ),
    ).toEqual({ status: 201, text: 'private-response-body' });
    expect(
      await webpage.evaluate(
        () =>
          new Promise<boolean>((resolveResult) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/error');
            xhr.onerror = () => resolveResult(true);
            xhr.onload = () => resolveResult(false);
            xhr.send();
          }),
      ),
    ).toBe(true);
    expect(
      await webpage.evaluate(
        () =>
          new Promise<boolean>((resolveResult) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/health');
            xhr.onabort = () => resolveResult(true);
            xhr.send();
            xhr.abort();
          }),
      ),
    ).toBe(true);

    expect(
      await webpage.evaluate(
        async () =>
          (await fetch(new Request('/api/health', { method: 'HEAD' }))).status,
      ),
    ).toBe(200);
    expect(
      await webpage.evaluate(
        (holder) =>
          new Promise<number>((resolveResult) => {
            holder.xhr.onload = () => resolveResult(holder.xhr.status);
            holder.xhr.send();
          }),
        preparedXHR,
      ),
    ).toBe(200);
    await expect.poll(async () => (await snapshot()).count).toBe(18);
    const captured = await snapshot();
    const requests = captured.events.filter(
      (event) => event.type === 'request',
    );
    const responses = captured.events.filter(
      (event) => event.type === 'response',
    );
    expect(requests).toHaveLength(9);
    expect(responses).toHaveLength(9);
    expect(requests.some((event) => event.data.method === 'HEAD')).toBe(true);
    expect(
      requests.some(
        (event) =>
          event.data.method === 'OTHER' &&
          event.data.endpoint.scope === 'unknown',
      ),
    ).toBe(true);
    for (const request of requests)
      expect(
        responses.filter(
          (event) => event.data.requestId === request.data.requestId,
        ),
      ).toHaveLength(1);
    expect(
      responses.some(
        (event) =>
          event.data.status === 503 && event.data.outcome === 'response',
      ),
    ).toBe(true);
    expect(
      responses.some(
        (event) =>
          event.data.transport === 'xhr' && event.data.outcome === 'aborted',
      ),
    ).toBe(true);
    expect(JSON.stringify(captured)).not.toContain('private-');
    expect(JSON.stringify(captured)).not.toContain('scope-network.example');
    expect(
      await webpage.evaluate(() => document.querySelector('h1')?.textContent),
    ).toBe('Network fixture');
    await expect(panel.getByText(/Fetch GET → HTTP 503/)).toBeVisible();
    await panel.screenshot({
      path: 'test-results/network.png',
      fullPage: true,
    });

    const pending = await webpage.evaluateHandle(() => ({
      promise: fetch('/api/slow').then((response) => response.text()),
    }));
    await expect.poll(async () => (await snapshot()).count).toBe(19);
    await panel.getByRole('button', { name: 'Stop session' }).click();
    await expect(
      panel.getByRole('status', { name: 'Session status' }),
    ).toHaveText('Session stopped');
    expect(
      await webpage.evaluate(
        (original) =>
          original.fetch === fetch &&
          original.open === XMLHttpRequest.prototype.open &&
          original.send === XMLHttpRequest.prototype.send,
        originals,
      ),
    ).toBe(true);
    expect(
      await webpage.evaluate(async (holder) => holder.promise, pending),
    ).toBe('private-response-body');
    expect((await snapshot()).count).toBe(19);
    await webpage.evaluate(() =>
      fetch('/api/health').then((response) => response.text()),
    );
    expect((await snapshot()).count).toBe(19);
    const stored: unknown = await panel.evaluate(
      () =>
        new Promise((resolveResult, reject) => {
          const request = indexedDB.open('scope');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction('events', 'readonly');
            const events = transaction.objectStore('events').getAll();
            events.onsuccess = () => resolveResult(events.result);
            events.onerror = () => reject(events.error);
            transaction.oncomplete = () => database.close();
          };
        }),
    );
    expect(JSON.stringify(stored)).not.toContain('private-');
    expect(JSON.stringify(stored)).not.toContain('authorization');
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
