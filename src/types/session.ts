import { z } from 'zod';

export const documentIdSchema = z.string().min(1).max(64);

const metadata = {
  id: z.uuid(),
  tabId: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  // Optional for existing saved sessions; new recordings bind to one document.
  documentId: documentIdSchema.optional(),
  reload: z
    .object({ expiresAt: z.number().int().nonnegative() })
    .strict()
    .optional(),
};

export const sessionSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        ...metadata,
        status: z.literal('active'),
        endedAt: z.null(),
        endReason: z.null(),
      })
      .strict(),
    z
      .object({
        ...metadata,
        status: z.literal('stopped'),
        endedAt: z.number().int().nonnegative(),
        endReason: z.literal('user'),
      })
      .strict(),
    z
      .object({
        ...metadata,
        status: z.literal('interrupted'),
        endedAt: z.number().int().nonnegative(),
        endReason: z.enum([
          'tab-closed',
          'browser-restart',
          'page-navigation',
          'capture-error',
          'event-limit',
        ]),
      })
      .strict(),
  ])
  .refine(
    (session) =>
      session.endedAt === null || session.endedAt >= session.startedAt,
    {
      message: 'A session cannot end before it starts.',
    },
  );

export type Session = z.infer<typeof sessionSchema>;
export type SessionEndReason = Exclude<Session['endReason'], null>;

export class SessionChangedError extends Error {
  constructor() {
    super('The current session changed.');
  }
}
