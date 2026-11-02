import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptureController } from './capture-controller';
import { observeInteractions } from './interactions';
import { capturedClick, normalizedClick } from '../test/interaction-fixture';
import type { CapturedInteraction } from '../types/event';

vi.mock('./interactions', () => ({ observeInteractions: vi.fn() }));
const sendMessage = vi.fn();
const detach = vi.fn();
let emit: (event: CapturedInteraction) => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  sendMessage.mockResolvedValue({ type: 'scope/capture-ack', recording: true });
  vi.mocked(observeInteractions).mockImplementation((sink) => {
    emit = sink;
    return detach;
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('batches low-frequency events and does not duplicate observers on repeated activation', async () => {
  const controller = new CaptureController();
  controller.start(normalizedClick.sessionId);
  controller.start(normalizedClick.sessionId);
  emit(capturedClick);
  emit({ ...capturedClick, id: crypto.randomUUID() });
  expect(sendMessage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage.mock.calls[0]?.[0].events).toHaveLength(2);
  expect(observeInteractions).toHaveBeenCalledTimes(1);
  await controller.stop(normalizedClick.sessionId);
  expect(detach).toHaveBeenCalledTimes(1);
});

it('detaches and flushes immediately on Stop, and retries with identical IDs after a transport failure', async () => {
  sendMessage.mockRejectedValueOnce(new Error('Worker stopped'));
  const controller = new CaptureController();
  controller.start(normalizedClick.sessionId);
  emit(capturedClick);
  await controller.stop(normalizedClick.sessionId);
  expect(detach).toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(sendMessage.mock.calls[0]?.[0]).toEqual(
    sendMessage.mock.calls[1]?.[0],
  );
});

it('fails closed when the worker refuses further recording', async () => {
  sendMessage.mockResolvedValueOnce({
    type: 'scope/capture-ack',
    recording: false,
  });
  const controller = new CaptureController();
  controller.start(normalizedClick.sessionId);
  emit(capturedClick);
  await vi.advanceTimersByTimeAsync(200);
  expect(detach).toHaveBeenCalled();
});

it('bounds its pending queue and reports overflow instead of silently dropping events', async () => {
  sendMessage.mockImplementation((message) =>
    message.type === 'scope/capture-failed'
      ? Promise.resolve()
      : new Promise(() => {}),
  );
  const controller = new CaptureController();
  controller.start(normalizedClick.sessionId);
  for (let index = 0; index < 121; index++)
    emit({ ...capturedClick, id: crypto.randomUUID() });
  await Promise.resolve();
  expect(detach).toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'scope/capture-failed',
    sessionId: normalizedClick.sessionId,
  });
});
