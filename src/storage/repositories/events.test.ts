// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ScopeDatabase } from '../database';
import { SessionsRepository } from './sessions';
import { EventsRepository } from './events';
import { normalizedClick } from '../../test/interaction-fixture';
import { activeSession } from '../../test/session-fixture';
import type { Session } from '../../types/session';
import { MAX_SESSION_EVENTS } from '../../messaging/capture';

let db: ScopeDatabase;
let events: EventsRepository;
beforeEach(async () => {
  db = new ScopeDatabase(`scope-events-${crypto.randomUUID()}`);
  events = new EventsRepository(db);
  await db.sessions.add(activeSession);
  await db.sessionState.put({ key: 'current', sessionId: activeSession.id });
});
afterEach(() => db.delete());

it('deduplicates retries without overwriting evidence and reads a bounded chronological preview', async () => {
  await events.append([normalizedClick, normalizedClick]);
  await events.append([{ ...normalizedClick, timestamp: 1700 }]);
  expect((await events.snapshot(activeSession.id)).events).toEqual([
    normalizedClick,
  ]);
  const extra = Array.from({ length: 30 }, (_, index) => ({
    ...normalizedClick,
    id: crypto.randomUUID(),
    timestamp: 2000 + index,
  }));
  await events.append(extra);
  const snapshot = await events.snapshot(activeSession.id);
  expect(snapshot.count).toBe(31);
  expect(snapshot.events).toHaveLength(20);
  expect(snapshot.events[0]?.timestamp).toBe(2010);
  expect(snapshot.events[19]?.timestamp).toBe(2029);
});

it('rejects events from other tabs and events arriving after Stop', async () => {
  expect(await events.append([{ ...normalizedClick, tabId: 8 }])).toEqual({
    recording: false,
    changed: false,
  });
  await new SessionsRepository(db).stop(activeSession.id, 2000);
  expect(await events.append([normalizedClick])).toEqual({
    recording: false,
    changed: false,
  });
  expect((await events.snapshot(activeSession.id)).count).toBe(0);
});

it('rejects a different document in the same tab when the recording is document-bound', async () => {
  await db.sessions.put({ ...activeSession, documentId: 'original-document' });
  expect(await events.append([normalizedClick])).toEqual({
    recording: false,
    changed: false,
  });
  expect(await db.events.count()).toBe(0);
  expect(
    await events.append([
      { ...normalizedClick, documentId: 'original-document' },
    ]),
  ).toEqual({ recording: true, changed: true });
});

it('does not persist events while a reload is still awaiting its document claim', async () => {
  await db.sessions.put({
    ...activeSession,
    documentId: normalizedClick.documentId,
    reload: { expiresAt: Date.now() + 15000 },
  });
  expect(await events.append([normalizedClick])).toEqual({
    recording: false,
    changed: false,
  });
  expect(await db.events.count()).toBe(0);
});

it('preserves capture order when the browser gives events the same timestamp', async () => {
  await events.append([
    { ...normalizedClick, id: crypto.randomUUID(), sequence: 2 },
    { ...normalizedClick, id: crypto.randomUUID(), sequence: 1 },
  ]);
  expect(
    (await events.snapshot(activeSession.id)).events.map(
      (event) => event.sequence,
    ),
  ).toEqual([1, 2]);
});

it('rejects mixed-session batches and rolls back without storing partial data', async () => {
  await expect(
    events.append([
      normalizedClick,
      {
        ...normalizedClick,
        id: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
      },
    ]),
  ).rejects.toThrow();
  expect(await db.events.count()).toBe(0);
});

it('caps session growth atomically and marks the interruption reason', async () => {
  await db.events.bulkAdd(
    Array.from({ length: MAX_SESSION_EVENTS - 1 }, () => ({
      ...normalizedClick,
      id: crypto.randomUUID(),
    })),
  );
  expect(
    await events.append([
      normalizedClick,
      { ...normalizedClick, id: crypto.randomUUID() },
    ]),
  ).toEqual({ recording: false, changed: true });
  expect(await db.events.count()).toBe(MAX_SESSION_EVENTS);
  expect(await new SessionsRepository(db).getCurrent()).toMatchObject({
    status: 'interrupted',
    endReason: 'event-limit',
  });
});

it('upgrades v1 metadata without losing the existing session', async () => {
  const name = `scope-upgrade-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy
    .version(1)
    .stores({ sessions: '&id, startedAt, status', sessionState: '&key' });
  await legacy.table<Session, string>('sessions').add(activeSession);
  await legacy
    .table('sessionState')
    .put({ key: 'current', sessionId: activeSession.id });
  legacy.close();
  const upgraded = new ScopeDatabase(name);
  try {
    expect(await new SessionsRepository(upgraded).getCurrent()).toEqual(
      activeSession,
    );
    expect(await upgraded.events.count()).toBe(0);
  } finally {
    await upgraded.delete();
  }
});
