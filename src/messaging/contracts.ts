import { z } from 'zod';
import { sessionSchema } from '../types/session';

export const connectionRequestSchema = z
  .object({
    type: z.literal('scope/check-connection'),
  })
  .strict();

export const pagePingSchema = z
  .object({
    type: z.literal('scope/page-ping'),
  })
  .strict();

export const pageReplySchema = z
  .object({
    type: z.literal('scope/page-ready'),
  })
  .strict();

export const connectionReplySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('connected') }).strict(),
  z
    .object({
      status: z.literal('unavailable'),
      reason: z.enum([
        'no-active-tab',
        'page-unavailable',
        'handshake-failed',
        'scope-error',
      ]),
    })
    .strict(),
]);

export type ConnectionRequest = z.infer<typeof connectionRequestSchema>;
export type ConnectionReply = z.infer<typeof connectionReplySchema>;

export const sessionRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scope/get-session') }).strict(),
  z.object({ type: z.literal('scope/start-session') }).strict(),
  z.object({ type: z.literal('scope/record-and-reload') }).strict(),
  z
    .object({ type: z.literal('scope/stop-session'), sessionId: z.uuid() })
    .strict(),
]);
export const sessionChangedSchema = z
  .object({ type: z.literal('scope/session-changed') })
  .strict();
export const sessionReplySchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('ok'), session: sessionSchema.nullable() })
    .strict(),
  z
    .object({
      status: z.literal('error'),
      reason: z.enum(['page-unavailable', 'session-changed', 'scope-error']),
    })
    .strict(),
]);
export const scopeRequestSchema = z.union([
  connectionRequestSchema,
  sessionRequestSchema,
]);
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
export type SessionReply = z.infer<typeof sessionReplySchema>;
