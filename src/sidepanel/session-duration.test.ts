import { expect, it } from 'vitest';
import { activeSession } from '../test/session-fixture';
import { sessionDuration } from './session-duration';

it('derives elapsed time from timestamps, including throttled timers and clock rollback', () => {
  expect(sessionDuration(activeSession, 3662000)).toBe('01:01:01');
  expect(sessionDuration(activeSession, 500)).toBe('00:00:00');
});

it('freezes duration after stopping and avoids claiming a duration after browser downtime', () => {
  expect(
    sessionDuration(
      { ...activeSession, status: 'stopped', endedAt: 6000, endReason: 'user' },
      90000,
    ),
  ).toBe('00:00:05');
  expect(
    sessionDuration(
      {
        ...activeSession,
        status: 'interrupted',
        endedAt: 90000,
        endReason: 'browser-restart',
      },
      90000,
    ),
  ).toBe('Unavailable after browser restart');
});
