import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installNetworkCapture } from './network';
import { observeRuntime } from './runtime';
import { capturedRequest } from '../test/network-fixture';
import { activeSession } from '../test/session-fixture';
import type { CapturedNetworkEvent } from '../types/network';
import {
  PAGE_NETWORK_EVENT,
  PAGE_NETWORK_FAILED,
} from '../messaging/page-bridge';

vi.mock('./network', () => ({ installNetworkCapture: vi.fn() }));
vi.mock('./runtime', () => ({ observeRuntime: vi.fn() }));
let collect: (event: CapturedNetworkEvent) => void;
const restoreNetwork = vi.fn();
const restoreRuntime = vi.fn();
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  delete window.__scopeNetworkCaptureV1;
  vi.mocked(installNetworkCapture).mockImplementation((publish) => {
    collect = publish;
    return restoreNetwork;
  });
  vi.mocked(observeRuntime).mockReturnValue(restoreRuntime);
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  await import('./index');
});
afterEach(() => {
  window.__scopeNetworkCaptureV1?.stop(activeSession.id);
  delete window.__scopeNetworkCaptureV1;
  vi.useRealTimers();
});

it('buffers early metadata privately and publishes it only when a session claims it', () => {
  const handle = window.__scopeNetworkCaptureV1!;
  handle.prepare();
  collect(capturedRequest);
  expect(window.postMessage).not.toHaveBeenCalled();
  expect(handle.start(activeSession.id)).toBe(true);
  expect(window.postMessage).toHaveBeenCalledWith(
    {
      type: PAGE_NETWORK_EVENT,
      sessionId: activeSession.id,
      event: capturedRequest,
    },
    '*',
  );
  handle.stop(activeSession.id);
  expect(restoreNetwork).toHaveBeenCalled();
  expect(restoreRuntime).toHaveBeenCalled();
  expect(handle.start(activeSession.id)).toBe(false);
});

it('discards unclaimed metadata and restores APIs after five seconds', () => {
  window.__scopeNetworkCaptureV1!.prepare();
  collect(capturedRequest);
  vi.advanceTimersByTime(5000);
  expect(restoreNetwork).toHaveBeenCalledOnce();
  expect(restoreRuntime).toHaveBeenCalledOnce();
  expect(window.postMessage).not.toHaveBeenCalled();
});

it('reports overflow instead of replaying a partial startup history', () => {
  const handle = window.__scopeNetworkCaptureV1!;
  handle.prepare();
  for (let i = 0; i < 101; i++) collect(capturedRequest);
  expect(handle.start(activeSession.id)).toBe(false);
  expect(window.postMessage).toHaveBeenCalledWith(
    { type: PAGE_NETWORK_FAILED, sessionId: activeSession.id },
    '*',
  );
  expect(window.postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: PAGE_NETWORK_EVENT }),
    '*',
  );
});
