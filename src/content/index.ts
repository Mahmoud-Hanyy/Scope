import { pagePingSchema } from '../messaging/contracts';
import { captureCommandSchema } from '../messaging/capture';
import { CaptureController } from './capture-controller';

declare global {
  interface Window {
    __scopeContentLoaded?: boolean;
    __scopeContentCaptureV1?: CaptureController;
  }
}

// The button can inject this script repeatedly into the same isolated world.
if (!window.__scopeContentLoaded) {
  const capture = new CaptureController();
  window.__scopeContentCaptureV1 = capture;
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return false;
      const command = captureCommandSchema.safeParse(message);
      if (command.success) {
        const { sessionId, enabled, waitForNetwork } = command.data;
        const operation = enabled
          ? Promise.resolve(capture.start(sessionId))
          : capture.stop(sessionId, waitForNetwork);
        void operation
          .then(() => sendResponse({ type: 'scope/capture-ready', sessionId }))
          .catch((error: unknown) => {
            console.error('[Scope] Capture command failed.', error);
            sendResponse({ type: 'scope/capture-error' });
          });
        return true;
      }
      if (
        sender.id === chrome.runtime.id &&
        pagePingSchema.safeParse(message).success
      ) {
        sendResponse({ type: 'scope/page-ready' });
      }
      return false;
    },
  );
  window.__scopeContentLoaded = true;
}
