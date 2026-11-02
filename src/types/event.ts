import { z } from 'zod';
import { capturedRequestSchema, capturedResponseSchema } from './network';
import { capturedExceptionSchema, capturedRejectionSchema } from './runtime';

export const elementContextSchema = z
  .object({
    element: z.enum(['button', 'link', 'input', 'textarea', 'select', 'form']),
    controlType: z
      .enum([
        'text',
        'password',
        'email',
        'tel',
        'search',
        'url',
        'number',
        'checkbox',
        'radio',
        'file',
        'date',
        'time',
        'range',
        'color',
        'other',
      ])
      .nullable(),
    valueOmitted: z.literal(true),
  })
  .strict();

export const capturedInteractionSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(['click', 'submit', 'input']),
    timestamp: z.number().finite().nonnegative(),
    sequence: z.number().int().nonnegative(),
    data: elementContextSchema,
  })
  .strict();

const eventContext = {
  sessionId: z.uuid(),
  severity: z.literal('info'),
  tabId: z.number().int().nonnegative(),
  documentId: z.string().min(1).max(64),
  receivedAt: z.number().int().nonnegative(),
};
export const capturedEventSchema = z.discriminatedUnion('type', [
  capturedInteractionSchema,
  capturedRequestSchema,
  capturedResponseSchema,
  capturedExceptionSchema,
  capturedRejectionSchema,
]);
export const scopeEventSchema = z.discriminatedUnion('type', [
  capturedInteractionSchema
    .extend({ ...eventContext, source: z.literal('content') })
    .strict(),
  capturedRequestSchema
    .extend({ ...eventContext, source: z.literal('page') })
    .strict(),
  capturedResponseSchema
    .extend({ ...eventContext, source: z.literal('page') })
    .strict(),
  capturedExceptionSchema
    .extend({ ...eventContext, source: z.literal('page') })
    .strict(),
  capturedRejectionSchema
    .extend({ ...eventContext, source: z.literal('page') })
    .strict(),
]);

export type ElementContext = z.infer<typeof elementContextSchema>;
export type CapturedInteraction = z.infer<typeof capturedInteractionSchema>;
export type CapturedEvent = z.infer<typeof capturedEventSchema>;
export type ScopeEvent = z.infer<typeof scopeEventSchema>;
