// These are routing labels, not authentication secrets. The page world is untrusted.
export const PAGE_NETWORK_EVENT = 'scope/page-network-event-v1';
export const PAGE_NETWORK_STOPPED = 'scope/page-network-stopped-v1';
export const PAGE_NETWORK_FAILED = 'scope/page-network-failed-v1';
export const PAGE_RUNTIME_EVENT = 'scope/page-runtime-event-v1';
export const PAGE_RELOAD_CLAIM = 'scope/page-reload-claim-v1';

export interface NetworkCaptureHandle {
  start(sessionId: string): boolean;
  stop(sessionId: string): boolean;
  prepare(): void;
  discard(): void;
}

declare global {
  interface Window {
    __scopeNetworkCaptureV1?: NetworkCaptureHandle;
  }
}
