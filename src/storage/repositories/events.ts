import { database, type ScopeDatabase } from '../database';
import { sessionSchema } from '../../types/session';
import { scopeEventSchema, type ScopeEvent } from '../../types/event';
import {
  MAX_SESSION_EVENTS,
  RECENT_EVENTS_LIMIT,
  type EventsSnapshot,
} from '../../messaging/capture';

export class EventsRepository {
  constructor(private readonly db: ScopeDatabase = database) {}

  append(
    events: ScopeEvent[],
  ): Promise<{ recording: boolean; changed: boolean }> {
    return this.db.transaction(
      'rw',
      this.db.sessions,
      this.db.events,
      async () => {
        const first = events[0];
        if (!first) return { recording: false, changed: false };
        const raw = await this.db.sessions.get(first.sessionId);
        if (!raw) return { recording: false, changed: false };
        const session = sessionSchema.parse(raw);
        if (
          session.status !== 'active' ||
          session.reload !== undefined ||
          session.tabId !== first.tabId ||
          (session.documentId !== undefined &&
            session.documentId !== first.documentId)
        )
          return { recording: false, changed: false };
        const validated = events.map((event) => scopeEventSchema.parse(event));
        if (
          validated.some(
            (event) =>
              event.sessionId !== session.id ||
              event.tabId !== session.tabId ||
              (session.documentId !== undefined &&
                event.documentId !== session.documentId) ||
              event.timestamp < session.startedAt,
          )
        ) {
          throw new Error('[Scope] Event batch does not match its session.');
        }
        const existing = await this.db.events.bulkGet(
          validated.map((event) => event.id),
        );
        const seen = new Set<string>();
        const fresh = validated.filter((event, index) => {
          if (existing[index] || seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        });
        const count = await this.db.events
          .where('sessionId')
          .equals(session.id)
          .count();
        const accepted = fresh.slice(
          0,
          Math.max(0, MAX_SESSION_EVENTS - count),
        );
        if (accepted.length) await this.db.events.bulkAdd(accepted);
        const capped = count + accepted.length >= MAX_SESSION_EVENTS;
        if (capped)
          await this.db.sessions.put(
            sessionSchema.parse({
              ...session,
              status: 'interrupted',
              endedAt: Math.max(session.startedAt, Date.now()),
              endReason: 'event-limit',
            }),
          );
        return { recording: !capped, changed: accepted.length > 0 || capped };
      },
    );
  }

  snapshot(sessionId: string): Promise<EventsSnapshot> {
    return this.db.transaction('r', this.db.events, async () => {
      const count = await this.db.events
        .where('sessionId')
        .equals(sessionId)
        .count();
      const rows = await this.db.events
        .where('[sessionId+timestamp+sequence]')
        .between([sessionId, 0, 0], [sessionId, Infinity, Infinity])
        .reverse()
        .limit(RECENT_EVENTS_LIMIT)
        .toArray();
      return {
        count,
        events: rows.reverse().map((row) => scopeEventSchema.parse(row)),
      };
    });
  }

  analysisInput(sessionId: string) {
    return this.db.transaction(
      'r',
      this.db.sessions,
      this.db.events,
      async () => {
        const raw = await this.db.sessions.get(sessionId);
        if (!raw) throw new Error('[Scope] Session no longer exists.');
        const session = sessionSchema.parse(raw);
        const rows = await this.db.events
          .where('sessionId')
          .equals(sessionId)
          .limit(MAX_SESSION_EVENTS + 1)
          .toArray();
        if (rows.length > MAX_SESSION_EVENTS)
          throw new Error('[Scope] Session exceeds its analysis limit.');
        const events = rows.map((row) => scopeEventSchema.parse(row));
        if (events.some((event) => event.tabId !== session.tabId))
          throw new Error('[Scope] Session contains mismatched event context.');
        return { session, events };
      },
    );
  }
}

export const eventsRepository = new EventsRepository();
