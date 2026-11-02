import { z } from 'zod';
import { database, type ScopeDatabase } from '../database';
import {
  sessionSchema,
  SessionChangedError,
  type Session,
  type SessionEndReason,
} from '../../types/session';

export const MAX_RETAINED_SESSIONS = 100;
const headSchema = z
  .object({ key: z.literal('current'), sessionId: z.uuid() })
  .strict();

export class SessionsRepository {
  constructor(private readonly db: ScopeDatabase = database) {}

  private async readCurrent(): Promise<Session | null> {
    const head = await this.db.sessionState.get('current');
    if (!head) return null;
    const { sessionId } = headSchema.parse(head);
    return sessionSchema.parse(await this.db.sessions.get(sessionId));
  }

  getCurrent(): Promise<Session | null> {
    return this.db.transaction(
      'r',
      this.db.sessions,
      this.db.sessionState,
      () => this.readCurrent(),
    );
  }

  start(
    tabId: number,
    now = Date.now(),
    documentId?: string,
    reload?: { expiresAt: number },
  ): Promise<Session> {
    return this.db.transaction(
      'rw',
      this.db.sessions,
      this.db.sessionState,
      this.db.events,
      async () => {
        const current = await this.readCurrent();
        // Read and write in one transaction so competing panels cannot start two sessions.
        if (current?.status === 'active') return current;
        const session = sessionSchema.parse({
          id: crypto.randomUUID(),
          tabId,
          startedAt: now,
          ...(documentId !== undefined ? { documentId } : {}),
          ...(reload ? { reload } : {}),
          status: 'active',
          endedAt: null,
          endReason: null,
        });
        await this.db.sessions.add(session);
        await this.db.sessionState.put({
          key: 'current',
          sessionId: session.id,
        });
        // Bound metadata retention until the history/deletion UI is introduced.
        const previous = (
          await this.db.sessions.orderBy('startedAt').reverse().toArray()
        ).filter((row) => row.id !== session.id);
        const removed = previous
          .slice(MAX_RETAINED_SESSIONS - 1)
          .map((row) => row.id);
        await this.db.events.where('sessionId').anyOf(removed).delete();
        await this.db.sessions.bulkDelete(removed);
        return session;
      },
    );
  }

  stop(sessionId: string, now = Date.now()): Promise<Session> {
    return this.db.transaction(
      'rw',
      this.db.sessions,
      this.db.sessionState,
      async () => {
        const current = await this.readCurrent();
        // A stale panel must never stop a newer session.
        if (!current || current.id !== sessionId)
          throw new SessionChangedError();
        if (current.status !== 'active') return current;
        return this.finish(current, 'user', now);
      },
    );
  }

  claimReload(
    tabId: number,
    documentId: string,
    now = Date.now(),
  ): Promise<Session | null> {
    return this.db.transaction(
      'rw',
      this.db.sessions,
      this.db.sessionState,
      async () => {
        const current = await this.readCurrent();
        if (
          current?.status !== 'active' ||
          current.tabId !== tabId ||
          !current.reload ||
          current.reload.expiresAt <= now ||
          current.documentId === documentId
        )
          return null;
        const session = sessionSchema.parse({
          ...current,
          documentId,
          reload: undefined,
        });
        await this.db.sessions.put(session);
        return session;
      },
    );
  }

  interrupt(
    reason: Exclude<SessionEndReason, 'user'>,
    tabId?: number,
    now = Date.now(),
    expectedSessionId?: string,
  ): Promise<Session | null> {
    return this.db.transaction(
      'rw',
      this.db.sessions,
      this.db.sessionState,
      async () => {
        const current = await this.readCurrent();
        if (
          current?.status !== 'active' ||
          (expectedSessionId !== undefined &&
            current.id !== expectedSessionId) ||
          (tabId !== undefined && current.tabId !== tabId)
        )
          return current;
        return this.finish(current, reason, now);
      },
    );
  }

  private async finish(
    current: Session,
    endReason: SessionEndReason,
    now: number,
  ): Promise<Session> {
    const session = sessionSchema.parse({
      ...current,
      reload: undefined,
      status: endReason === 'user' ? 'stopped' : 'interrupted',
      endedAt: Math.max(current.startedAt, now),
      endReason,
    });
    await this.db.sessions.put(session);
    return session;
  }
}

export const sessionsRepository = new SessionsRepository();
