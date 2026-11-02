import { z } from 'zod';
import { capturedEventSchema, scopeEventSchema } from '../types/event';

export const MAX_BATCH_SIZE = 20;
export const MAX_SESSION_EVENTS = 1000;
export const RECENT_EVENTS_LIMIT = 20;

export const captureCommandSchema = z
  .object({
    type: z.literal('scope/set-capture'),
    sessionId: z.uuid(),
    enabled: z.boolean(),
    waitForNetwork: z.boolean().optional(),
  })
  .strict();
export const captureReadySchema = z
  .object({
    type: z.literal('scope/capture-ready'),
    sessionId: z.uuid(),
  })
  .strict();
export const captureBatchSchema = z
  .object({
    type: z.literal('scope/captured-events'),
    sessionId: z.uuid(),
    events: z.array(capturedEventSchema).min(1).max(MAX_BATCH_SIZE),
  })
  .strict();
export const captureFailureSchema = z
  .object({
    type: z.literal('scope/capture-failed'),
    sessionId: z.uuid(),
  })
  .strict();
export const captureAckSchema = z
  .object({
    type: z.literal('scope/capture-ack'),
    recording: z.boolean(),
  })
  .strict();
export const eventsRequestSchema = z
  .object({
    type: z.literal('scope/get-events'),
    sessionId: z.uuid(),
  })
  .strict();
export const eventsChangedSchema = z
  .object({
    type: z.literal('scope/events-changed'),
    sessionId: z.uuid(),
  })
  .strict();
export const eventsSnapshotSchema = z
  .object({
    count: z.number().int().min(0).max(MAX_SESSION_EVENTS),
    events: z.array(scopeEventSchema).max(RECENT_EVENTS_LIMIT),
  })
  .strict();
export const eventsReplySchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('ok'), snapshot: eventsSnapshotSchema })
    .strict(),
  z.object({ status: z.literal('error') }).strict(),
]);
export type CaptureBatch = z.infer<typeof captureBatchSchema>;
export type EventsSnapshot = z.infer<typeof eventsSnapshotSchema>;
