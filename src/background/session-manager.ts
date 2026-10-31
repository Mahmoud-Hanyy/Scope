import { sessionsRepository } from '../storage/repositories/sessions';
import type { Session } from '../types/session';
import { checkTabConnection } from './page-connection';

export class PageUnavailableError extends Error {}

export async function getCurrentSession(): Promise<Session | null> {
  const current = await sessionsRepository.getCurrent();
  if (current?.status === 'active') {
    try {
      await chrome.tabs.get(current.tabId);
    } catch {
      // Reconcile a close missed while the extension was disabled or reloaded.
      return sessionsRepository.interrupt('tab-closed', current.tabId);
    }
  }
  return current;
}

export async function startSession(): Promise<Session> {
  const current = await getCurrentSession();
  if (current?.status === 'active') return current;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new PageUnavailableError();
  const connection = await checkTabConnection(tab.id);
  if (connection.status !== 'connected') throw new PageUnavailableError();
  const started = await sessionsRepository.start(tab.id);
  // A tab can close between its handshake and the database transaction.
  return (await getCurrentSession()) ?? started;
}

export async function notifySessionChanged(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'scope/session-changed' });
  } catch (error) {
    // No panel is a normal state; the committed database remains authoritative.
    console.debug(
      '[Scope] Session change notification had no receiver.',
      error,
    );
  }
}

export function registerSessionLifecycle(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void sessionsRepository
      .interrupt('tab-closed', tabId)
      .then(notifySessionChanged)
      .catch((error: unknown) =>
        console.error('[Scope] Could not end session for closed tab.', error),
      );
  });
  chrome.runtime.onStartup.addListener(() => {
    // Tab IDs belong to a browser run and may be reused after a browser restart.
    void sessionsRepository
      .interrupt('browser-restart')
      .then(notifySessionChanged)
      .catch((error: unknown) =>
        console.error(
          '[Scope] Could not recover session after browser restart.',
          error,
        ),
      );
  });
}
