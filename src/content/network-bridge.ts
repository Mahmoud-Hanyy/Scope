import {
  capturedNetworkSchema,
  type CapturedNetworkEvent,
} from '../types/network';
import {
  capturedRuntimeSchema,
  type CapturedRuntimeEvent,
} from '../types/runtime';
import {
  PAGE_NETWORK_EVENT,
  PAGE_NETWORK_FAILED,
  PAGE_NETWORK_STOPPED,
  PAGE_RUNTIME_EVENT,
} from '../messaging/page-bridge';

export function observePageNetwork(
  sessionId: string,
  onEvent: (event: CapturedNetworkEvent | CapturedRuntimeEvent) => void,
  onFailure: () => void,
) {
  let stopped = false;
  let warned = false;
  let stopPromise: Promise<void> | null = null;
  let waiter: {
    resolve: () => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const listener = (message: MessageEvent<unknown>) => {
    if (message.source !== window || message.origin !== location.origin) return;
    const data = message.data;
    if (
      typeof data !== 'object' ||
      data === null ||
      !('sessionId' in data) ||
      data.sessionId !== sessionId ||
      !('type' in data)
    )
      return;
    if (data.type === PAGE_NETWORK_STOPPED) {
      stopped = true;
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve();
        waiter = null;
      }
      return;
    }
    if (data.type === PAGE_NETWORK_FAILED) {
      onFailure();
      return;
    }
    if (
      (data.type !== PAGE_NETWORK_EVENT && data.type !== PAGE_RUNTIME_EVENT) ||
      !('event' in data) ||
      stopped
    )
      return;
    const event =
      data.type === PAGE_RUNTIME_EVENT
        ? capturedRuntimeSchema.safeParse(data.event)
        : capturedNetworkSchema.safeParse(data.event);
    if (event.success) onEvent(event.data);
    else if (!warned) {
      warned = true;
      console.warn('[Scope] Rejected invalid page-network metadata.');
    }
  };
  window.addEventListener('message', listener);
  return {
    waitForStop(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (stopPromise) return stopPromise;
      stopPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error('[Scope] Network stop barrier timed out.'));
        }, 1000);
        waiter = { resolve, reject, timer };
      });
      return stopPromise;
    },
    dispose() {
      window.removeEventListener('message', listener);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(
          new Error(
            '[Scope] Network bridge closed before stop acknowledgement.',
          ),
        );
        waiter = null;
      }
    },
  };
}
