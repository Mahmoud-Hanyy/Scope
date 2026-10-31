import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { requestSession } from '../../messaging/client';
import { activeSession } from '../../test/session-fixture';
import type { Session } from '../../types/session';
import { useSession } from './use-session';

vi.mock('../../messaging/client', () => ({ requestSession: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('refreshes after a notification during an in-flight mutation, instead of losing it', async () => {
  const addListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'scope-test',
      onMessage: { addListener, removeListener: vi.fn() },
    },
  });
  let completeStart: (value: Session | null) => void = () => {
    throw new Error('Start not pending');
  };
  const pendingStart = new Promise<Session | null>((resolve) => {
    completeStart = resolve;
  });
  const stopped: Session = {
    ...activeSession,
    status: 'stopped',
    endedAt: 2000,
    endReason: 'user',
  };
  vi.mocked(requestSession)
    .mockResolvedValueOnce(null)
    .mockReturnValueOnce(pendingStart)
    .mockResolvedValueOnce(stopped);
  const { result } = renderHook(() => useSession());
  await act(async () => {});
  act(() => {
    void result.current.start();
  });
  const listener = addListener.mock.calls[0]?.[0];
  if (!listener) throw new Error('Change listener missing');
  act(() => {
    listener({ type: 'scope/session-changed' }, { id: 'scope-test' });
  });
  expect(requestSession).toHaveBeenCalledTimes(2);
  await act(async () => {
    completeStart(activeSession);
  });
  expect(requestSession).toHaveBeenCalledTimes(3);
  expect(result.current.session).toEqual(stopped);
  expect(result.current.pending).toBe(false);
});
