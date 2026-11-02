import { installNetworkCapture } from './network';
import { observeRuntime } from './runtime';
import type { CapturedEvent } from '../types/event';
import {
  PAGE_RUNTIME_EVENT,
  PAGE_NETWORK_EVENT,
  PAGE_NETWORK_FAILED,
  PAGE_NETWORK_STOPPED,
} from '../messaging/page-bridge';

interface CaptureState {
  id: string | null;
  detach: () => void;
  pending: CapturedEvent[];
  failed: boolean;
}

if (!window.__scopeNetworkCaptureV1) {
  let current: CaptureState | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let lastStopped: string | null = null;
  const publish = (sessionId: string, event: CapturedEvent) =>
    window.postMessage(
      {
        type:
          event.type === 'exception' || event.type === 'promise-rejection'
            ? PAGE_RUNTIME_EVENT
            : PAGE_NETWORK_EVENT,
        sessionId,
        event,
      },
      '*',
    );
  const discard = () => {
    clearTimeout(expiry);
    current?.detach();
    current = null;
  };
  const install = (id: string | null) => {
    const state: CaptureState = {
      id,
      detach: () => {},
      pending: [],
      failed: false,
    };
    const fail = () => {
      state.failed = true;
      state.detach();
      if (state.id)
        window.postMessage(
          { type: PAGE_NETWORK_FAILED, sessionId: state.id },
          '*',
        );
      state.pending = [];
    };
    const collect = (event: CapturedEvent) => {
      if (state.failed) return;
      if (state.id) publish(state.id, event);
      else if (state.pending.length < 100) state.pending.push(event);
      else fail();
    };
    const detachNetwork = installNetworkCapture(collect, fail);
    let detachRuntime: () => void;
    try {
      detachRuntime = observeRuntime(collect, fail);
    } catch (error) {
      detachNetwork();
      throw error;
    }
    state.detach = () => {
      detachRuntime();
      detachNetwork();
    };
    current = state;
    if (state.failed) state.detach();
  };
  window.__scopeNetworkCaptureV1 = {
    start(sessionId) {
      if (sessionId === lastStopped) return false;
      if (current?.id === sessionId) return !current.failed;
      if (current && current.id === null) {
        clearTimeout(expiry);
        current.id = sessionId;
        if (current.failed)
          window.postMessage({ type: PAGE_NETWORK_FAILED, sessionId }, '*');
        else for (const event of current.pending) publish(sessionId, event);
        current.pending = [];
        return !current.failed;
      }
      discard();
      install(sessionId);
      return true;
    },
    prepare() {
      if (current) return;
      install(null);
      expiry = setTimeout(discard, 5000);
    },
    discard() {
      if (current?.id === null) discard();
    },
    stop(sessionId) {
      lastStopped = sessionId;
      if (current?.id === sessionId || current?.id === null) discard();
      window.postMessage({ type: PAGE_NETWORK_STOPPED, sessionId }, '*');
      return true;
    },
  };
}
