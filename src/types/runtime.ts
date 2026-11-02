import { z } from 'zod';
import { networkEndpointSchema } from './network';

export const runtimeDataSchema = z
  .object({
    name: z.enum([
      'Error',
      'TypeError',
      'ReferenceError',
      'SyntaxError',
      'RangeError',
      'URIError',
      'EvalError',
      'AggregateError',
      'non-error',
      'unknown',
    ]),
    location: z
      .object({
        endpoint: networkEndpointSchema,
        line: z.number().int().nonnegative(),
        column: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    detailsOmitted: z.literal(true),
  })
  .strict();
export const capturedExceptionSchema = z
  .object({
    id: z.uuid(),
    timestamp: z.number().finite().nonnegative(),
    sequence: z.number().int().nonnegative(),
    type: z.literal('exception'),
    data: runtimeDataSchema,
  })
  .strict();
export const capturedRejectionSchema = capturedExceptionSchema
  .extend({ type: z.literal('promise-rejection') })
  .strict();
export const capturedRuntimeSchema = z.discriminatedUnion('type', [
  capturedExceptionSchema,
  capturedRejectionSchema,
]);
export type CapturedRuntimeEvent = z.infer<typeof capturedRuntimeSchema>;
