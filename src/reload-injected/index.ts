import '../injected/index';
import { PAGE_RELOAD_CLAIM } from '../messaging/page-bridge';

// Pending metadata is sanitized by the existing capture adapters. No session
// owns it until an isolated-world handshake verifies this tab/document.
window.__scopeNetworkCaptureV1?.prepare();
const claim = (message: MessageEvent<unknown>) => {
  if (message.source !== window || message.origin !== location.origin) return;
  const data = message.data;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('type' in data) ||
    data.type !== PAGE_RELOAD_CLAIM ||
    !('sessionId' in data)
  )
    return;
  if (
    typeof data.sessionId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(data.sessionId)
  )
    window.__scopeNetworkCaptureV1?.start(data.sessionId);
  else window.__scopeNetworkCaptureV1?.discard();
  window.removeEventListener('message', claim);
  clearTimeout(timer);
};
window.addEventListener('message', claim);
const timer = setTimeout(() => {
  window.removeEventListener('message', claim);
  window.__scopeNetworkCaptureV1?.discard();
}, 5000);
