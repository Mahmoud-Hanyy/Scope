import { sessionsRepository } from '../storage/repositories/sessions';
import type { Session } from '../types/session';
import { checkTabConnection } from './page-connection';
import { setCapture } from './capture-control';
import { SessionChangedError } from '../types/session';
import { currentDocumentId } from './document-identity';
import { prepareReloadScripts, removeReloadScripts } from './reload-scripts';

export class PageUnavailableError extends Error {}

// This queue orders browser side effects, not session state. IndexedDB remains
// authoritative after worker suspension; ingestion never waits on this queue.
let transition: Promise<unknown> = Promise.resolve();
function inOrder<T>(operation: () => Promise<T>): Promise<T> {
  const next = transition.then(operation);
  transition = next.catch(() => undefined);
  return next;
}

async function readCurrentSession(): Promise<Session | null> {
  const current = await sessionsRepository.getCurrent();
  if (current?.status === 'active') {
    if (current.reload) {
      if (current.reload.expiresAt > Date.now()) return current;
      await removeReloadScripts();
      return sessionsRepository.interrupt(
        'capture-error',
        current.tabId,
        Date.now(),
        current.id,
      );
    }
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(current.tabId);
    } catch {
      // Reconcile a close missed while the extension was disabled or reloaded.
      return sessionsRepository.interrupt('tab-closed', current.tabId);
    }
    if (current.documentId !== undefined) {
      try {
        if ((await currentDocumentId(current.tabId)) !== current.documentId) {
          return sessionsRepository.interrupt(
            'page-navigation',
            current.tabId,
            Date.now(),
            current.id,
          );
        }
      } catch (error) {
        console.warn('[Scope] Could not verify the recording document.', error);
        return sessionsRepository.interrupt(
          tab.status === 'loading' ? 'page-navigation' : 'capture-error',
          current.tabId,
          Date.now(),
          current.id,
        );
      }
    }
  }
  return current;
}

async function activationFailureReason(
  session: Session,
): Promise<'page-navigation' | 'capture-error'> {
  if (session.documentId === undefined) return 'capture-error';
  try {
    const tab = await chrome.tabs.get(session.tabId);
    // Reattachment can race document teardown before onUpdated runs in our queue.
    if (tab.status === 'loading') return 'page-navigation';
    if ((await currentDocumentId(session.tabId)) !== session.documentId)
      return 'page-navigation';
  } catch {
    // Without positive navigation evidence, retain the capture-failure reason.
  }
  return 'capture-error';
}

async function activateCapture(session: Session): Promise<Session> {
  if (session.status !== 'active' || session.reload) return session;
  try {
    await setCapture(session, true);
    return session;
  } catch (error) {
    console.error('[Scope] Could not activate capture.', error);
    return (
      (await sessionsRepository.interrupt(
        await activationFailureReason(session),
        session.tabId,
        Date.now(),
        session.id,
      )) ?? session
    );
  }
}

export function getCurrentSession(): Promise<Session | null> {
  return inOrder(async () => {
    const session = await readCurrentSession();
    return session ? activateCapture(session) : null;
  });
}

export function startSession(): Promise<Session> {
  return inOrder(async () => {
    const current = await readCurrentSession();
    if (current?.status === 'active') return activateCapture(current);
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) throw new PageUnavailableError();
    const connection = await checkTabConnection(tab.id);
    if (connection.status !== 'connected') throw new PageUnavailableError();
    const started = await sessionsRepository.start(
      tab.id,
      Date.now(),
      connection.documentId,
    );
    // A tab can close between its handshake and the database transaction.
    return activateCapture((await readCurrentSession()) ?? started);
  });
}

export function recordAndReload(): Promise<Session> {
  return inOrder(async () => {
    const current = await readCurrentSession();
    if (current?.status === 'active') throw new SessionChangedError();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined || !tab.url) throw new PageUnavailableError();
    const connection = await checkTabConnection(tab.id);
    if (connection.status !== 'connected') throw new PageUnavailableError();
    const session = await sessionsRepository.start(
      tab.id,
      Date.now(),
      connection.documentId,
      { expiresAt: Date.now() + 15000 },
    );
    try {
      await prepareReloadScripts(tab.url);
      await chrome.tabs.reload(tab.id);
      return session;
    } catch (error) {
      console.error('[Scope] Could not prepare reload recording.', error);
      await removeReloadScripts();
      return (
        (await sessionsRepository.interrupt(
          'capture-error',
          tab.id,
          Date.now(),
          session.id,
        )) ?? session
      );
    }
  });
}

export function claimReload(
  tabId: number,
  documentId: string,
): Promise<Session | null> {
  return inOrder(async () => {
    const current = await readCurrentSession();
    if (current?.status !== 'active' || !current.reload) {
      await removeReloadScripts();
      return null;
    }
    // Chrome sender metadata identifies the caller; verify it is still current.
    if ((await currentDocumentId(tabId)) !== documentId) return null;
    const session = await sessionsRepository.claimReload(tabId, documentId);
    if (session) {
      try {
        await removeReloadScripts();
      } catch (error) {
        await sessionsRepository.interrupt(
          'capture-error',
          tabId,
          Date.now(),
          session.id,
        );
        throw error;
      }
      await notifySessionChanged();
    }
    return session;
  });
}

export function stopSession(sessionId: string): Promise<Session> {
  return inOrder(async () => {
    const current = await sessionsRepository.getCurrent();
    if (!current || current.id !== sessionId) throw new SessionChangedError();
    if (current.status !== 'active') return current;
    if (current.reload) {
      await removeReloadScripts();
      return sessionsRepository.stop(sessionId);
    }
    try {
      // Detach first, then drain acknowledged batches while the session is active.
      await setCapture(current, false);
    } catch (error) {
      console.error('[Scope] Could not drain capture.', error);
      return (
        (await sessionsRepository.interrupt(
          'capture-error',
          current.tabId,
          Date.now(),
          current.id,
        )) ?? current
      );
    }
    return sessionsRepository.stop(sessionId);
  });
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
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading' && change.status !== 'complete') return;
    void inOrder(async () => {
      const current = await sessionsRepository.getCurrent();
      if (current?.status !== 'active' || current.tabId !== tabId) return;
      if (current.reload) {
        await readCurrentSession();
        return;
      }
      if (current.documentId !== undefined) {
        try {
          if ((await currentDocumentId(tabId)) === current.documentId) return;
        } catch (error) {
          // A cross-origin navigation can revoke activeTab before identity is readable.
          console.debug(
            '[Scope] Navigating document is no longer accessible.',
            error,
          );
        }
      }
      await sessionsRepository.interrupt(
        'page-navigation',
        tabId,
        Date.now(),
        current.id,
      );
      try {
        await setCapture(current, false);
      } catch (error) {
        console.debug('[Scope] Navigating document already detached.', error);
      }
      await notifySessionChanged();
    }).catch((error: unknown) =>
      console.error(
        '[Scope] Could not interrupt capture on navigation.',
        error,
      ),
    );
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void sessionsRepository
      .interrupt('tab-closed', tabId)
      .then(async () => {
        const current = await sessionsRepository.getCurrent();
        if (current?.tabId === tabId) await removeReloadScripts();
      })
      .then(notifySessionChanged)
      .catch((error: unknown) =>
        console.error('[Scope] Could not end session for closed tab.', error),
      );
  });
  chrome.runtime.onStartup.addListener(() => {
    // Tab IDs belong to a browser run and may be reused after a browser restart.
    void sessionsRepository
      .interrupt('browser-restart')
      .then(removeReloadScripts)
      .then(notifySessionChanged)
      .catch((error: unknown) =>
        console.error(
          '[Scope] Could not recover session after browser restart.',
          error,
        ),
      );
  });
}
