import { afterEach, expect, it, vi } from 'vitest';
import { observePageNetwork } from './network-bridge';
import {
  PAGE_NETWORK_EVENT,
  PAGE_NETWORK_STOPPED,
} from '../messaging/page-bridge';
import { capturedRequest } from '../test/network-fixture';
import { activeSession } from '../test/session-fixture';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});
const send = (data: unknown, origin = location.origin) =>
  window.dispatchEvent(
    new MessageEvent('message', { source: window, origin, data }),
  );

it('validates origin, session and metadata, rejecting raw URLs or headers from the page', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sink = vi.fn();
  const bridge = observePageNetwork(activeSession.id, sink, vi.fn());
  dispose = bridge.dispose;
  const message = {
    type: PAGE_NETWORK_EVENT,
    sessionId: activeSession.id,
    event: capturedRequest,
  };
  send(message, 'https://unrelated.example');
  send({ ...message, sessionId: crypto.randomUUID() });
  send({ ...message, event: { ...capturedRequest, url: 'private-secret' } });
  expect(sink).not.toHaveBeenCalled();
  send(message);
  expect(sink).toHaveBeenCalledWith(capturedRequest);
});

it('drains earlier events before the stop barrier and ignores later events', async () => {
  const sink = vi.fn();
  const bridge = observePageNetwork(activeSession.id, sink, vi.fn());
  dispose = bridge.dispose;
  const waiting = bridge.waitForStop();
  send({
    type: PAGE_NETWORK_EVENT,
    sessionId: activeSession.id,
    event: capturedRequest,
  });
  send({ type: PAGE_NETWORK_STOPPED, sessionId: activeSession.id });
  await waiting;
  send({
    type: PAGE_NETWORK_EVENT,
    sessionId: activeSession.id,
    event: capturedRequest,
  });
  expect(sink).toHaveBeenCalledTimes(1);
});

it('completes concurrent Stop waiters with one barrier instead of orphaning a timeout', async () => {
  const bridge = observePageNetwork(activeSession.id, vi.fn(), vi.fn());
  dispose = bridge.dispose;
  const waiting = Promise.all([bridge.waitForStop(), bridge.waitForStop()]);
  send({ type: PAGE_NETWORK_STOPPED, sessionId: activeSession.id });
  await waiting;
});
