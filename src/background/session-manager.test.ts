import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { activeSession } from '../test/session-fixture';
import { sessionsRepository } from '../storage/repositories/sessions';
import { checkTabConnection } from './page-connection';
import {
  getCurrentSession,
  startSession,
  stopSession,
  PageUnavailableError,
  registerSessionLifecycle,
} from './session-manager';
import { setCapture } from './capture-control';
import { currentDocumentId } from './document-identity';
import { prepareReloadScripts, removeReloadScripts } from './reload-scripts';
import { recordAndReload, claimReload } from './session-manager';

vi.mock('../storage/repositories/sessions', () => ({
  sessionsRepository: {
    getCurrent: vi.fn(),
    start: vi.fn(),
    interrupt: vi.fn(),
    stop: vi.fn(),
    claimReload: vi.fn(),
  },
}));
vi.mock('./page-connection', () => ({ checkTabConnection: vi.fn() }));
vi.mock('./document-identity', () => ({ currentDocumentId: vi.fn() }));
vi.mock('./reload-scripts', () => ({
  prepareReloadScripts: vi.fn(),
  removeReloadScripts: vi.fn(),
}));
vi.mock('./capture-control', () => ({
  setCapture: vi.fn().mockResolvedValue(undefined),
}));

const tabs = {
  get: vi.fn(),
  query: vi.fn(),
  reload: vi.fn(),
  onRemoved: { addListener: vi.fn() },
  onUpdated: { addListener: vi.fn() },
};
const runtime = { sendMessage: vi.fn(), onStartup: { addListener: vi.fn() } };
beforeEach(() => {
  vi.mocked(setCapture).mockResolvedValue(undefined);
  vi.mocked(prepareReloadScripts).mockResolvedValue(undefined);
  vi.mocked(removeReloadScripts).mockResolvedValue(undefined);
  tabs.reload.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { tabs, runtime });
  tabs.get.mockResolvedValue({ id: 7 });
  tabs.query.mockResolvedValue([{ id: 7 }]);
  runtime.sendMessage.mockResolvedValue(undefined);
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(null);
  vi.mocked(sessionsRepository.start).mockResolvedValue(activeSession);
  vi.mocked(checkTabConnection).mockResolvedValue({
    status: 'connected',
    documentId: 'test-document',
  });
  vi.mocked(currentDocumentId).mockResolvedValue('test-document');
});

it('prepares scripts before reloading and does not activate capture in the outgoing document', async () => {
  tabs.query.mockResolvedValue([
    { id: 7, url: 'https://example.com/private?secret=value' },
  ]);
  const preparing = {
    ...activeSession,
    documentId: 'test-document',
    reload: { expiresAt: Date.now() + 15000 },
  };
  vi.mocked(sessionsRepository.start).mockResolvedValue(preparing);
  tabs.reload.mockImplementationOnce(async () => {
    expect(prepareReloadScripts).toHaveBeenCalledWith(
      'https://example.com/private?secret=value',
    );
    expect(setCapture).not.toHaveBeenCalled();
  });
  expect(await recordAndReload()).toEqual(preparing);
  expect(tabs.reload).toHaveBeenCalledWith(7);
});

it('rejects a reload claim from a document that is no longer current', async () => {
  expect(await claimReload(7, 'old-document')).toBeNull();
  expect(sessionsRepository.claimReload).not.toHaveBeenCalled();
});

it('expires a pending reload on recovery instead of recording late', async () => {
  const preparing = {
    ...activeSession,
    documentId: 'test-document',
    reload: { expiresAt: 0 },
  };
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(preparing);
  await getCurrentSession();
  expect(removeReloadScripts).toHaveBeenCalled();
  expect(sessionsRepository.interrupt).toHaveBeenCalledWith(
    'capture-error',
    7,
    expect.any(Number),
    activeSession.id,
  );
  expect(setCapture).not.toHaveBeenCalled();
});

it('waits for content-script draining before persisting Stop', async () => {
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(activeSession);
  const stopped = {
    ...activeSession,
    status: 'stopped' as const,
    endedAt: 2000,
    endReason: 'user' as const,
  };
  vi.mocked(sessionsRepository.stop).mockResolvedValue(stopped);
  vi.mocked(setCapture).mockImplementationOnce(async (_, enabled) => {
    expect(enabled).toBe(false);
    expect(sessionsRepository.stop).not.toHaveBeenCalled();
  });
  expect(await stopSession(activeSession.id)).toEqual(stopped);
  expect(sessionsRepository.stop).toHaveBeenCalledWith(activeSession.id);
});

it('reports capture activation failures as interrupted sessions', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(activeSession);
  vi.mocked(setCapture).mockRejectedValueOnce(
    new Error('Content script unavailable'),
  );
  const interrupted = {
    ...activeSession,
    status: 'interrupted' as const,
    endedAt: 2000,
    endReason: 'capture-error' as const,
  };
  vi.mocked(sessionsRepository.interrupt).mockResolvedValue(interrupted);
  expect(await startSession()).toEqual(interrupted);
});

it('keeps a bound session active when loading/complete signals refer to the same document', async () => {
  const bound = { ...activeSession, documentId: 'test-document' };
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(bound);
  registerSessionLifecycle();
  const listener = tabs.onUpdated.addListener.mock.calls[0]?.[0];
  if (!listener) throw new Error('Navigation listener missing');
  listener(8, { status: 'loading' });
  listener(7, { status: 'loading' });
  listener(7, { status: 'complete' });
  expect(await getCurrentSession()).toEqual(bound);
  expect(sessionsRepository.interrupt).not.toHaveBeenCalled();
});

it('classifies a reattachment failure during reload as navigation', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const bound = { ...activeSession, documentId: 'test-document' };
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(bound);
  tabs.get.mockResolvedValue({ id: 7, status: 'loading' });
  vi.mocked(setCapture).mockRejectedValueOnce(new Error('Document detached'));
  await getCurrentSession();
  expect(sessionsRepository.interrupt).toHaveBeenCalledWith(
    'page-navigation',
    7,
    expect.any(Number),
    activeSession.id,
  );
});

it('classifies an identity read interrupted by reload as navigation', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue({
    ...activeSession,
    documentId: 'test-document',
  });
  tabs.get.mockResolvedValue({ id: 7, status: 'loading' });
  vi.mocked(currentDocumentId).mockRejectedValueOnce(
    new Error('Document detached'),
  );
  await getCurrentSession();
  expect(sessionsRepository.interrupt).toHaveBeenCalledWith(
    'page-navigation',
    7,
    expect.any(Number),
    activeSession.id,
  );
  expect(setCapture).not.toHaveBeenCalled();
});

it('interrupts on a changed document and does not reactivate capture there', async () => {
  const bound = { ...activeSession, documentId: 'test-document' };
  const interrupted = {
    ...bound,
    status: 'interrupted' as const,
    endedAt: 2000,
    endReason: 'page-navigation' as const,
  };
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(bound);
  vi.mocked(sessionsRepository.interrupt).mockResolvedValue(interrupted);
  vi.mocked(currentDocumentId).mockResolvedValue('new-document');
  expect(await getCurrentSession()).toEqual(interrupted);
  expect(sessionsRepository.interrupt).toHaveBeenCalledWith(
    'page-navigation',
    7,
    expect.any(Number),
    activeSession.id,
  );
  expect(setCapture).not.toHaveBeenCalled();
});

it('ends a bound session when a navigation makes its document inaccessible', async () => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue({
    ...activeSession,
    documentId: 'test-document',
  });
  vi.mocked(sessionsRepository.interrupt).mockResolvedValue(null);
  vi.mocked(currentDocumentId).mockRejectedValue(
    new Error('Host access revoked'),
  );
  registerSessionLifecycle();
  const listener = tabs.onUpdated.addListener.mock.calls[0]?.[0];
  if (!listener) throw new Error('Navigation listener missing');
  listener(7, { status: 'loading' });
  await vi.waitFor(() => expect(runtime.sendMessage).toHaveBeenCalled());
  expect(sessionsRepository.interrupt).toHaveBeenCalledWith(
    'page-navigation',
    7,
    expect.any(Number),
    activeSession.id,
  );
});
afterEach(() => vi.unstubAllGlobals());

it('checks the exact tab before persisting a new session', async () => {
  vi.mocked(sessionsRepository.getCurrent)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(activeSession);
  expect(await startSession()).toEqual(activeSession);
  expect(checkTabConnection).toHaveBeenCalledWith(7);
  expect(sessionsRepository.start).toHaveBeenCalledWith(
    7,
    expect.any(Number),
    'test-document',
  );
});

it('does not persist a session when page access is unavailable', async () => {
  vi.mocked(checkTabConnection).mockResolvedValue({
    status: 'unavailable',
    reason: 'page-unavailable',
  });
  await expect(startSession()).rejects.toBeInstanceOf(PageUnavailableError);
  expect(sessionsRepository.start).not.toHaveBeenCalled();
});

it('returns an existing active session without changing its target tab', async () => {
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(activeSession);
  expect(await startSession()).toEqual(activeSession);
  expect(tabs.query).not.toHaveBeenCalled();
  expect(sessionsRepository.start).not.toHaveBeenCalled();
});

it('reconciles a session whose tab no longer exists', async () => {
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(activeSession);
  tabs.get.mockRejectedValue(new Error('No tab with id'));
  const interrupted = {
    ...activeSession,
    status: 'interrupted' as const,
    endedAt: 2000,
    endReason: 'tab-closed' as const,
  };
  vi.mocked(sessionsRepository.interrupt).mockResolvedValue(interrupted);
  expect(await getCurrentSession()).toEqual(interrupted);
});

it('registers close and browser-startup handlers that commit before notifying panels', async () => {
  vi.mocked(sessionsRepository.interrupt).mockResolvedValue(null);
  registerSessionLifecycle();
  const onClose = tabs.onRemoved.addListener.mock.calls[0]?.[0];
  const onStartup = runtime.onStartup.addListener.mock.calls[0]?.[0];
  if (!onClose || !onStartup) throw new Error('Lifecycle listener missing');
  onClose(7);
  await vi.waitFor(() => expect(runtime.sendMessage).toHaveBeenCalled());
  expect(sessionsRepository.interrupt).toHaveBeenCalledWith('tab-closed', 7);
  onStartup();
  await vi.waitFor(() => expect(runtime.sendMessage).toHaveBeenCalledTimes(2));
  expect(sessionsRepository.interrupt).toHaveBeenCalledWith('browser-restart');
});
