import Dexie, { type Table } from 'dexie';
import type { Session } from '../types/session';

export interface SessionHead {
  key: 'current';
  sessionId: string;
}

export class ScopeDatabase extends Dexie {
  sessions!: Table<Session, string>;
  sessionState!: Table<SessionHead, string>;

  constructor(name = 'scope') {
    super(name);
    this.version(1).stores({
      sessions: '&id, startedAt, status',
      sessionState: '&key',
    });
  }
}

export const database = new ScopeDatabase();
