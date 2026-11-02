import { normalizeEvent } from '../core/normalization/events';
import {
  captureBatchSchema,
  captureFailureSchema,
  type CaptureBatch,
} from '../messaging/capture';
import { eventsRepository } from '../storage/repositories/events';
import { sessionsRepository } from '../storage/repositories/sessions';
import { notifySessionChanged } from './session-manager';
import { setCapture } from './capture-control';

export async function notifyEventsChanged(sessionId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'scope/events-changed',
      sessionId,
    });
  } catch (error) {
    console.debug('[Scope] Event notification had no receiver.', error);
  }
}

async function ingest(
  batch: CaptureBatch,
  tabId: number,
  documentId: string,
): Promise<boolean> {
  const receivedAt = Date.now();
  const events = batch.events.map((event) =>
    normalizeEvent(event, {
      sessionId: batch.sessionId,
      tabId,
      documentId,
      receivedAt,
    }),
  );
  const result = await eventsRepository.append(events);
  if (result.changed) await notifyEventsChanged(batch.sessionId);
  if (!result.recording && result.changed) await notifySessionChanged();
  return result.recording;
}

export function registerEventIngestion(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (
        sender.id !== chrome.runtime.id ||
        sender.tab?.id === undefined ||
        sender.frameId !== 0 ||
        !sender.documentId
      )
        return false;
      const batch = captureBatchSchema.safeParse(message);
      const failure = captureFailureSchema.safeParse(message);
      const submission = batch.success
        ? batch.data
        : failure.success
          ? failure.data
          : null;
      if (!submission) return false;
      const sessionId = submission.sessionId;
      const operation =
        submission.type === 'scope/captured-events'
          ? ingest(submission, sender.tab.id, sender.documentId)
          : sessionsRepository
              .interrupt('capture-error', sender.tab.id, Date.now(), sessionId)
              .then(notifySessionChanged)
              .then(() => false);
      void operation
        .then((recording) => {
          sendResponse({ type: 'scope/capture-ack', recording });
          if (!recording) void cleanupCapture(sessionId);
        })
        .catch(async (error: unknown) => {
          console.error('[Scope] Could not persist events.', error);
          try {
            await sessionsRepository.interrupt(
              'capture-error',
              sender.tab?.id,
              Date.now(),
              sessionId,
            );
            await notifySessionChanged();
          } catch (recoveryError) {
            console.error(
              '[Scope] Could not persist capture interruption.',
              recoveryError,
            );
          }
          sendResponse({ type: 'scope/capture-ack', recording: false });
          void cleanupCapture(sessionId);
        });
      return true;
    },
  );
}

async function cleanupCapture(sessionId: string): Promise<void> {
  try {
    const session = await sessionsRepository.getCurrent();
    if (session?.id === sessionId) await setCapture(session, false);
  } catch (error) {
    console.warn(
      '[Scope] Could not restore page instrumentation after capture ended.',
      error,
    );
  }
}
