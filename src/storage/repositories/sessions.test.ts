// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScopeDatabase } from '../database';
import { MAX_RETAINED_SESSIONS, SessionsRepository } from './sessions';
import { SessionChangedError } from '../../types/session';

let db: ScopeDatabase;
let repository: SessionsRepository;
beforeEach(() => {
  db = new ScopeDatabase(`scope-test-${crypto.randomUUID()}`);
  repository = new SessionsRepository(db);
});
afterEach(() => db.delete());

describe('persistent session lifecycle', () => {
  it('starts empty, persists one active session, and restores after reopening IndexedDB', async () => {
    expect(await repository.getCurrent()).toBeNull();
    const started = await repository.start(7, 1000);
    const name = db.name;
    db.close();
    db = new ScopeDatabase(name);
    repository = new SessionsRepository(db);
    expect(await repository.getCurrent()).toEqual(started);
    expect(Object.keys(started).sort()).toEqual(
      ['endedAt', 'endReason', 'id', 'startedAt', 'status', 'tabId'].sort(),
    );
  });

  it('serializes competing starts into one active session across database connections', async () => {
    const otherDb = new ScopeDatabase(db.name);
    try {
      const [first, second] = await Promise.all([
        repository.start(7, 1000),
        new SessionsRepository(otherDb).start(8, 1000),
      ]);
      expect(first.id).toBe(second.id);
      expect(await db.sessions.count()).toBe(1);
    } finally {
      otherDb.close();
    }
  });

  it('stops idempotently, freezes its end time, and rejects stale stops', async () => {
    const first = await repository.start(7, 1000);
    const stopped = await repository.stop(first.id, 2000);
    expect(stopped).toMatchObject({
      status: 'stopped',
      endedAt: 2000,
      endReason: 'user',
    });
    expect(await repository.stop(first.id, 9000)).toEqual(stopped);
    const second = await repository.start(7, 3000);
    await expect(repository.stop(first.id, 4000)).rejects.toBeInstanceOf(
      SessionChangedError,
    );
    expect(await repository.getCurrent()).toEqual(second);
  });

  it('only interrupts the matching tab and marks browser restart distinctly', async () => {
    const started = await repository.start(7, 1000);
    expect(await repository.interrupt('tab-closed', 8, 1500)).toEqual(started);
    expect(await repository.interrupt('tab-closed', 7, 2000)).toMatchObject({
      status: 'interrupted',
      endedAt: 2000,
      endReason: 'tab-closed',
    });
    await repository.start(8, 3000);
    expect(
      await repository.interrupt('browser-restart', undefined, 4000),
    ).toMatchObject({ status: 'interrupted', endReason: 'browser-restart' });
  });

  it('bounds metadata retention and keeps the current session', async () => {
    for (let index = 0; index < MAX_RETAINED_SESSIONS + 2; index++) {
      const session = await repository.start(7, index * 1000);
      await repository.stop(session.id, index * 1000 + 500);
    }
    expect(await db.sessions.count()).toBe(MAX_RETAINED_SESSIONS);
    const current = await repository.getCurrent();
    expect(current?.startedAt).toBe((MAX_RETAINED_SESSIONS + 1) * 1000);
  });

  it('rolls back invalid data and clamps an end time after clock rollback', async () => {
    await expect(repository.start(-1, 1000)).rejects.toThrow();
    expect(await repository.getCurrent()).toBeNull();
    const started = await repository.start(7, 1000);
    expect(await repository.stop(started.id, 500)).toMatchObject({
      endedAt: 1000,
    });
  });
});
