import { describe, expect, it } from 'vitest';
import {
  connectionReplySchema,
  connectionRequestSchema,
  pageReplySchema,
  sessionRequestSchema,
  sessionReplySchema,
} from './contracts';
import { activeSession } from '../test/session-fixture';

describe('messaging boundary', () => {
  it('accepts the known request and rejects malformed or extra data', () => {
    expect(
      connectionRequestSchema.safeParse({ type: 'scope/check-connection' })
        .success,
    ).toBe(true);
    for (const value of [
      null,
      'scope/check-connection',
      { type: 'unknown' },
      { type: 'scope/check-connection', url: 'secret' },
    ]) {
      expect(connectionRequestSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects unknown responses rather than treating them as connected', () => {
    expect(
      pageReplySchema.safeParse({ type: 'scope/page-ready' }).success,
    ).toBe(true);
    expect(pageReplySchema.safeParse({ status: 'connected' }).success).toBe(
      false,
    );
    expect(
      connectionReplySchema.safeParse({
        status: 'unavailable',
        reason: 'unknown',
      }).success,
    ).toBe(false);
  });

  it('requires a valid session ID for stop and rejects sensitive extra metadata', () => {
    expect(
      sessionRequestSchema.safeParse({ type: 'scope/stop-session' }).success,
    ).toBe(false);
    expect(
      sessionRequestSchema.safeParse({
        type: 'scope/stop-session',
        sessionId: activeSession.id,
      }).success,
    ).toBe(true);
    expect(
      sessionReplySchema.safeParse({
        status: 'ok',
        session: { ...activeSession, url: 'https://private.example/token' },
      }).success,
    ).toBe(false);
    expect(
      sessionReplySchema.safeParse({
        status: 'ok',
        session: { ...activeSession, endedAt: 2000 },
      }).success,
    ).toBe(false);
  });
});
