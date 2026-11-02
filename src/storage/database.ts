import Dexie, { type Table } from 'dexie';
import type { Session } from '../types/session';
import type { ScopeEvent } from '../types/event';

export interface SessionHead {
  key: 'current';
  sessionId: string;
}

export class ScopeDatabase extends Dexie {
  sessions!: Table<Session, string>;
  sessionState!: Table<SessionHead, string>;
  events!: Table<ScopeEvent, string>;

  constructor(name = 'scope') {
    super(name);
    this.version(1).stores({
      sessions: '&id, startedAt, status',
      sessionState: '&key',
    });
    this.version(2).stores({
      events: '&id, sessionId, [sessionId+timestamp+sequence]',
    });
  }
}

export const database = new ScopeDatabase();
