import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installNetworkCapture, MAX_PENDING_REQUESTS } from './network';
import type { CapturedNetworkEvent } from '../types/network';

let detach: (() => void) | undefined;
const nativeFetch = vi.fn<typeof fetch>();
let events: CapturedNetworkEvent[];
beforeEach(() => {
  events = [];
  nativeFetch
    .mockReset()
    .mockResolvedValue(new Response('private-response-body', { status: 503 }));
  vi.stubGlobal('fetch', nativeFetch);
});
afterEach(() => {
  detach?.();
  detach = undefined;
  vi.unstubAllGlobals();
});

it('pairs Fetch events, preserves arguments/receiver and response identity, and never consumes the body', async () => {
  const response = new Response('private-response-body', { status: 503 });
  nativeFetch.mockResolvedValue(response);
  const receiver = { page: true };
  const init = {
    method: 'POST',
    headers: { Authorization: 'private-token' },
    body: 'private-request-body',
  };
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  const result = await window.fetch.call(
    receiver,
    '/api/orders/private-id?token=private-query',
    init,
  );
  expect(result).toBe(response);
  expect(nativeFetch).toHaveBeenCalledWith(
    '/api/orders/private-id?token=private-query',
    init,
  );
  expect(nativeFetch.mock.contexts[0]).toBe(receiver);
  expect(response.bodyUsed).toBe(false);
  expect(events).toHaveLength(2);
  expect(events[0]?.data.requestId).toBe(events[1]?.data.requestId);
  expect(events[1]).toMatchObject({
    type: 'response',
    data: {
      status: 503,
      outcome: 'response',
      method: 'POST',
      durationMs: expect.any(Number),
    },
  });
  expect(JSON.stringify(events)).not.toContain('private-');
  expect(await response.text()).toBe('private-response-body');
  detach();
  expect(window.fetch).toBe(nativeFetch);
});

it('preserves Fetch rejection identity without persisting error messages', async () => {
  const failure = new TypeError('private-failure-message');
  nativeFetch.mockRejectedValue(failure);
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  await expect(window.fetch('/api/health')).rejects.toBe(failure);
  expect(events[1]).toMatchObject({
    type: 'response',
    data: { status: null, outcome: 'network-error' },
  });
  expect(JSON.stringify(events)).not.toContain('private-');
});

it('does not read init getters twice and supports Request inputs', async () => {
  let reads = 0;
  nativeFetch.mockImplementation(async (_, init) => {
    void init?.method;
    return new Response();
  });
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  await window.fetch('/api/health', {
    get method() {
      reads++;
      return 'POST';
    },
  });
  expect(reads).toBe(1);
  expect(events[0]?.data.method).toBe('OTHER');
  await window.fetch(
    new Request('https://private-host.test/api/orders?token=private-token', {
      method: 'PUT',
    }),
  );
  expect(events[2]?.data.method).toBe('PUT');
  expect(JSON.stringify(events)).not.toContain('private-');
});

it('stops observing in-flight Fetch completions without aborting the application request', async () => {
  let complete: (value: Response) => void = () => {
    throw new Error('No pending request');
  };
  nativeFetch.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  const promise = window.fetch('/api/health');
  detach();
  const response = new Response('still available');
  complete(response);
  expect(await promise).toBe(response);
  expect(events).toHaveLength(1);
});

it('never turns telemetry failure into an application failure and preserves newer page patches on cleanup', async () => {
  const failure = vi.fn();
  detach = installNetworkCapture(() => {
    throw new Error('Telemetry failure');
  }, failure);
  expect((await window.fetch('/api/health')).status).toBe(503);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(window.fetch).toBe(nativeFetch);
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  const newer = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  window.fetch = newer;
  detach();
  expect(window.fetch).toBe(newer);
});

it('bounds pending request bookkeeping and restores wrappers when the limit is exceeded', () => {
  nativeFetch.mockReturnValue(new Promise(() => {}));
  const failure = vi.fn();
  detach = installNetworkCapture((event) => events.push(event), failure);
  for (let index = 0; index <= MAX_PENDING_REQUESTS; index++)
    void window.fetch('/api/health');
  expect(events).toHaveLength(MAX_PENDING_REQUESTS);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(window.fetch).toBe(nativeFetch);
});

it('observes XHR without replacing the constructor or interfering with page callbacks', () => {
  const body = 'private-request-body';
  class TestXHR extends XMLHttpRequest {
    override get status() {
      return 201;
    }
    override open() {
      /* test transport */
    }
    override send(value?: Document | XMLHttpRequestBodyInit | null) {
      expect(value).toBe(body);
      this.dispatchEvent(new ProgressEvent('load'));
    }
  }
  vi.stubGlobal('XMLHttpRequest', TestXHR);
  const originalOpen = TestXHR.prototype.open;
  const originalSend = TestXHR.prototype.send;
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  expect(window.XMLHttpRequest).toBe(TestXHR);
  const xhr = new XMLHttpRequest();
  const onLoad = vi.fn();
  xhr.onload = onLoad;
  xhr.open('POST', '/api/orders/private-id?token=private-token');
  xhr.send(body);
  expect(onLoad).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({
    type: 'response',
    data: { transport: 'xhr', status: 201, outcome: 'response' },
  });
  expect(JSON.stringify(events)).not.toContain('private-');
  detach();
  expect(TestXHR.prototype.open).toBe(originalOpen);
  expect(TestXHR.prototype.send).toBe(originalSend);
});

it('preserves synchronous transport throws and classifies native Fetch aborts', async () => {
  const failure = new TypeError('private-sync-failure');
  nativeFetch.mockImplementationOnce(() => {
    throw failure;
  });
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  expect(() => window.fetch('/api/health')).toThrow(failure);
  const abort = new DOMException('private-abort-message', 'AbortError');
  nativeFetch.mockRejectedValueOnce(abort);
  await expect(window.fetch('/api/health')).rejects.toBe(abort);
  expect(events[3]).toMatchObject({
    type: 'response',
    data: { outcome: 'aborted', status: null },
  });
  expect(JSON.stringify(events)).not.toContain('private-');
});

it('records an XHR opened before recording with unavailable metadata marked explicitly', () => {
  class TestXHR extends XMLHttpRequest {
    override open() {
      /* test transport */
    }
    override get status() {
      return 200;
    }
    override send() {
      this.dispatchEvent(new ProgressEvent('load'));
    }
  }
  vi.stubGlobal('XMLHttpRequest', TestXHR);
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/health');
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  xhr.send();
  expect(events[0]).toMatchObject({
    type: 'request',
    data: { method: 'OTHER', endpoint: { scope: 'unknown' } },
  });
  expect(events[1]).toMatchObject({ type: 'response', data: { status: 200 } });
});

it('records XHR timeout once and removes terminal listeners before instance reuse', () => {
  class TestXHR extends XMLHttpRequest {
    override open() {
      /* test transport */
    }
    override send() {
      this.dispatchEvent(new ProgressEvent('timeout'));
      this.dispatchEvent(new ProgressEvent('error'));
    }
  }
  vi.stubGlobal('XMLHttpRequest', TestXHR);
  detach = installNetworkCapture((event) => events.push(event), vi.fn());
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/health');
  xhr.send();
  xhr.open('GET', '/api/health');
  xhr.send();
  expect(events).toHaveLength(4);
  expect(events[1]).toMatchObject({
    type: 'response',
    data: { outcome: 'timeout', status: null },
  });
  expect(events[0]?.data.requestId).not.toBe(events[2]?.data.requestId);
});
