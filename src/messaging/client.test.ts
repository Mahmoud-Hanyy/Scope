import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  requestAnalysis,
  requestConnectionCheck,
  requestEvents,
  requestSession,
} from './client';
import { ScopeMessageError } from './request';
import { activeSession } from '../test/session-fixture';

const sendMessage = vi.fn();
beforeEach(() => {
  vi.stubGlobal('chrome', { runtime: { id: 'scope-test', sendMessage } });
});
afterEach(() => vi.unstubAllGlobals());
const operations = [
  ['connection', () => requestConnectionCheck()],
  ['session', () => requestSession({ type: 'scope/record-and-reload' })],
  ['events', () => requestEvents(activeSession.id)],
  ['analysis', () => requestAnalysis(activeSession.id)],
] as const;

it.each(operations)(
  'gives recovery instructions for a missing %s reply without retrying',
  async (_, request) => {
    sendMessage.mockResolvedValue(undefined);
    const failure = await request().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ScopeMessageError);
    expect(failure).toMatchObject({
      reason: 'no-response',
      message: expect.stringContaining('Reload Scope in chrome://extensions'),
    });
    expect(sendMessage).toHaveBeenCalledOnce();
  },
);

it.each(operations)(
  'rejects an incompatible %s reply without exposing a Zod diagnostic',
  async (_, request) => {
    sendMessage.mockResolvedValue({ status: 'ok' });
    const failure = await request().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ScopeMessageError);
    expect(failure).toMatchObject({ reason: 'invalid-response' });
    if (!(failure instanceof Error))
      throw new Error('Expected a message failure');
    expect(failure.message).not.toContain('invalid_type');
    expect(failure.message).toContain('incompatible response');
  },
);

it('does not retry a mutation when the response channel fails', async () => {
  const cause = new Error('Receiving end does not exist');
  sendMessage.mockRejectedValue(cause);
  await expect(
    requestSession({ type: 'scope/record-and-reload' }),
  ).rejects.toMatchObject({ reason: 'transport-error', cause });
  expect(sendMessage).toHaveBeenCalledOnce();
});

it('preserves successful replies and domain errors', async () => {
  sendMessage.mockResolvedValueOnce({ status: 'ok', session: activeSession });
  expect(await requestSession({ type: 'scope/get-session' })).toEqual(
    activeSession,
  );
  sendMessage.mockResolvedValueOnce({
    status: 'error',
    reason: 'page-unavailable',
  });
  await expect(requestSession({ type: 'scope/start-session' })).rejects.toThrow(
    'Open a regular webpage',
  );
});
