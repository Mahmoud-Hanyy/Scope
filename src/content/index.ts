import { pagePingSchema } from '../messaging/contracts';

declare global {
  interface Window {
    __scopeContentLoaded?: boolean;
  }
}

// The button can inject this script repeatedly into the same isolated world.
if (!window.__scopeContentLoaded) {
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
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
