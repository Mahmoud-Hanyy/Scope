import { afterEach, expect, it, vi } from 'vitest';
import { registerEventIngestion } from './event-ingestion';
import { eventsRepository } from '../storage/repositories/events';
import { capturedClick, normalizedClick } from '../test/interaction-fixture';
import { sessionsRepository } from '../storage/repositories/sessions';
import { setCapture } from './capture-control';
import { activeSession } from '../test/session-fixture';

vi.mock('../storage/repositories/events', () => ({
  eventsRepository: { append: vi.fn() },
}));
vi.mock('./session-manager', () => ({ notifySessionChanged: vi.fn() }));
vi.mock('../storage/repositories/sessions', () => ({
  sessionsRepository: { getCurrent: vi.fn() },
}));
vi.mock('./capture-control', () => ({ setCapture: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('only ingests validated batches from this extension’s top-frame content script', async () => {
  const addListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'scope-test',
      onMessage: { addListener },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  });
  vi.mocked(eventsRepository.append).mockResolvedValue({
    recording: true,
    changed: true,
  });
  registerEventIngestion();
  const listener = addListener.mock.calls[0]?.[0];
  if (!listener) throw new Error('Ingestion listener missing');
  const message = {
    type: 'scope/captured-events',
    sessionId: normalizedClick.sessionId,
    events: [capturedClick],
  };
  const sender = {
    id: 'scope-test',
    tab: { id: 7 },
    frameId: 0,
    documentId: 'document-from-chrome',
  };
  const reply = vi.fn();
  expect(listener(message, { ...sender, id: 'other' }, reply)).toBe(false);
  expect(listener(message, { ...sender, frameId: 1 }, reply)).toBe(false);
  expect(listener(message, { ...sender, tab: undefined }, reply)).toBe(false);
  expect(
    listener(
      { ...message, events: [{ ...capturedClick, value: 'secret' }] },
      sender,
      reply,
    ),
  ).toBe(false);
  expect(eventsRepository.append).not.toHaveBeenCalled();
  expect(listener(message, sender, reply)).toBe(true);
  await vi.waitFor(() =>
    expect(reply).toHaveBeenCalledWith({
      type: 'scope/capture-ack',
      recording: true,
    }),
  );
  expect(eventsRepository.append).toHaveBeenCalledWith([
    expect.objectContaining({
      sessionId: normalizedClick.sessionId,
      tabId: 7,
      documentId: 'document-from-chrome',
      data: capturedClick.data,
    }),
  ]);
});

it('acknowledges a capped batch before cleanup so Stop cannot deadlock on the content flush', async () => {
  const addListener = vi.fn();
  const reply = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'scope-test',
      onMessage: { addListener },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  });
  vi.mocked(eventsRepository.append).mockResolvedValue({
    recording: false,
    changed: true,
  });
  vi.mocked(sessionsRepository.getCurrent).mockResolvedValue({
    ...activeSession,
    status: 'interrupted',
    endedAt: 2000,
    endReason: 'event-limit',
  });
  vi.mocked(setCapture).mockImplementation(async () => {
    expect(reply).toHaveBeenCalledWith({
      type: 'scope/capture-ack',
      recording: false,
    });
  });
  registerEventIngestion();
  const listener = addListener.mock.calls[0]?.[0];
  if (!listener) throw new Error('Ingestion listener missing');
  listener(
    {
      type: 'scope/captured-events',
      sessionId: activeSession.id,
      events: [capturedClick],
    },
    {
      id: 'scope-test',
      tab: { id: 7 },
      frameId: 0,
      documentId: 'document-from-chrome',
    },
    reply,
  );
  await vi.waitFor(() => expect(setCapture).toHaveBeenCalled());
});
