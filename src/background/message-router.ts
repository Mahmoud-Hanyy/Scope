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
  stopSession,
  PageUnavailableError,
  notifySessionChanged,
  recordAndReload,
  claimReload,
} from './session-manager';
import { SessionChangedError } from '../types/session';
import { eventsRequestSchema } from '../messaging/capture';
import { eventsRepository } from '../storage/repositories/events';
import { analysisRequestSchema } from '../messaging/analysis';
import { analyzeSession } from './analyze-session';
import { reloadClaimSchema } from '../messaging/reload';

export async function checkConnection(): Promise<ConnectionReply> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return { status: 'unavailable', reason: 'no-active-tab' };
  }

  const connection = await checkTabConnection(tab.id);
  return connection.status === 'connected'
    ? { status: 'connected' }
    : connection;
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
          : request.type === 'scope/record-and-reload'
            ? await recordAndReload()
            : await stopSession(request.sessionId);
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
      if (reloadClaimSchema.safeParse(message).success) {
        if (
          sender.id !== chrome.runtime.id ||
          sender.tab?.id === undefined ||
          sender.frameId !== 0 ||
          !sender.documentId
        )
          return false;
        void claimReload(sender.tab.id, sender.documentId)
          .then((session) => sendResponse({ sessionId: session?.id ?? null }))
          .catch((error: unknown) => {
            console.warn('[Scope] Startup capture claim failed.', error);
            sendResponse({ sessionId: null });
          });
        return true;
      }
      const eventsRequest = eventsRequestSchema.safeParse(message);
      const analysisRequest = analysisRequestSchema.safeParse(message);
      const request = scopeRequestSchema.safeParse(message);
      // Only our Side Panel may request page access or session operations.
      if (
        sender.id !== chrome.runtime.id ||
        sender.url !== chrome.runtime.getURL('sidepanel.html') ||
        (!request.success && !eventsRequest.success && !analysisRequest.success)
      ) {
        return false;
      }

      if (analysisRequest.success) {
        void analyzeSession(analysisRequest.data.sessionId)
          .then((analysis) => sendResponse({ status: 'ok', analysis }))
          .catch((error: unknown) => {
            console.error('[Scope] Could not analyze session.', error);
            sendResponse({ status: 'error' });
          });
        return true;
      }

      if (eventsRequest.success) {
        void eventsRepository
          .snapshot(eventsRequest.data.sessionId)
          .then((snapshot) => sendResponse({ status: 'ok', snapshot }))
          .catch((error: unknown) => {
            console.error('[Scope] Could not read interactions.', error);
            sendResponse({ status: 'error' });
          });
        return true;
      }
      if (!request.success) return false;

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
