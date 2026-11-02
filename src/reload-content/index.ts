import '../content/index';
import { reloadReplySchema } from '../messaging/reload';
import { PAGE_RELOAD_CLAIM } from '../messaging/page-bridge';

void (async () => {
  const deadline = performance.now() + 4500;
  let sessionId: string | null = null;
  try {
    const reply: unknown = await chrome.runtime.sendMessage({
      type: 'scope/claim-reload',
    });
    sessionId = reloadReplySchema.parse(reply).sessionId;
    if (sessionId && performance.now() >= deadline) {
      await chrome.runtime.sendMessage({
        type: 'scope/capture-failed',
        sessionId,
      });
      sessionId = null;
    }
    if (sessionId) window.__scopeContentCaptureV1?.start(sessionId);
  } catch (error) {
    console.warn('[Scope] Could not claim startup recording.', error);
  }
  window.postMessage({ type: PAGE_RELOAD_CLAIM, sessionId }, '*');
})();
