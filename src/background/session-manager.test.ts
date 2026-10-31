import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { activeSession } from '../test/session-fixture';
import { sessionsRepository } from '../storage/repositories/sessions';
import { checkTabConnection } from './page-connection';
import {
  getCurrentSession,
  startSession,
  PageUnavailableError,
  registerSessionLifecycle,
} from './session-manager';

vi.mock('../storage/repositories/sessions', () => ({
  sessionsRepository: {
    getCurrent: vi.fn(),
    start: vi.fn(),
    interrupt: vi.fn(),
  },
}));
vi.mock('./page-connection', () => ({ checkTabConnection: vi.fn() }));

const tabs = {
  get: vi.fn(),
  query: vi.fn(),
  onRemoved: { addListener: vi.fn() },
};
const runtime = { sendMessage: vi.fn(), onStartup: { addListener: vi.fn() } };
beforeEach(() => {
  vi.stubGlobal('chrome', { tabs, runtime });
  tabs.get.mockResolvedValue({ id: 7 });
  tabs.query.mockResolvedValue([{ id: 7 }]);
  runtime.sendMessage.mockResolvedValue(undefined);
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue(null);
  vi.mocked(sessionsRepository.start).mockResolvedValue(activeSession);
  vi.mocked(checkTabConnection).mockResolvedValue({ status: 'connected' });
});
afterEach(() => vi.unstubAllGlobals());

it('checks the exact tab before persisting a new session', async () => {
  vi.mocked(sessionsRepository.getCurrent)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(activeSession);
  expect(await startSession()).toEqual(activeSession);
  expect(checkTabConnection).toHaveBeenCalledWith(7);
  expect(sessionsRepository.start).toHaveBeenCalledWith(7);
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
