import {
  scopeRequestSchema,
  type ConnectionReply,
  type SessionRequest,
  type SessionReply,
} from '../messaging/contracts';
import { checkTabConnection } from './page-connection';
import {
  getCurrentSession,
  startSession,
  PageUnavailableError,
  notifySessionChanged,
} from './session-manager';
import { sessionsRepository } from '../storage/repositories/sessions';
import { SessionChangedError } from '../types/session';

export async function checkConnection(): Promise<ConnectionReply> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return { status: 'unavailable', reason: 'no-active-tab' };
  }

  return checkTabConnection(tab.id);
}

async function handleSessionRequest(
  request: SessionRequest,
): Promise<SessionReply> {
  try {
    const session =
      request.type === 'scope/get-session'
        ? await getCurrentSession()
        : request.type === 'scope/start-session'
          ? await startSession()
          : await sessionsRepository.stop(request.sessionId);
    if (request.type !== 'scope/get-session') await notifySessionChanged();
    return { status: 'ok', session };
  } catch (error) {
    if (error instanceof PageUnavailableError)
      return { status: 'error', reason: 'page-unavailable' };
    if (error instanceof SessionChangedError)
      return { status: 'error', reason: 'session-changed' };
    console.error('[Scope] Session operation failed.', error);
    return { status: 'error', reason: 'scope-error' };
  }
}

export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      const request = scopeRequestSchema.safeParse(message);
      // Only our Side Panel may request page access or session operations.
      if (
        sender.id !== chrome.runtime.id ||
        sender.url !== chrome.runtime.getURL('sidepanel.html') ||
        !request.success
      ) {
        return false;
      }

      const operation =
        request.data.type === 'scope/check-connection'
          ? checkConnection()
          : handleSessionRequest(request.data);
      void operation.then(sendResponse).catch((error: unknown) => {
        console.error('[Scope] Connection check failed.', error);
        sendResponse({ status: 'unavailable', reason: 'scope-error' });
      });
      // Keep this one-time response channel open while Chrome APIs finish.
      return true;
    },
  );
}
