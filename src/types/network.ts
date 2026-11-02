import { z } from 'zod';
import { NETWORK_METHODS, SAFE_ROUTE_SEGMENTS } from '../core/privacy/network';

export const networkEndpointSchema = z
  .object({
    scope: z.enum(['same-origin', 'cross-origin', 'unknown']),
    path: z.array(z.enum(SAFE_ROUTE_SEGMENTS)).max(8),
    detailsOmitted: z.literal(true),
  })
  .strict();
const requestData = {
  requestId: z.uuid(),
  transport: z.enum(['fetch', 'xhr']),
  method: z.enum(NETWORK_METHODS),
  endpoint: networkEndpointSchema,
};
const metadata = {
  id: z.uuid(),
  timestamp: z.number().finite().nonnegative(),
  sequence: z.number().int().nonnegative(),
};
export const capturedRequestSchema = z
  .object({
    ...metadata,
    type: z.literal('request'),
    data: z.object(requestData).strict(),
  })
  .strict();
export const capturedResponseSchema = z
  .object({
    ...metadata,
    type: z.literal('response'),
    data: z
      .object({
        ...requestData,
        outcome: z.enum(['response', 'network-error', 'aborted', 'timeout']),
        status: z.number().int().min(0).max(599).nullable(),
        durationMs: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const capturedNetworkSchema = z.discriminatedUnion('type', [
  capturedRequestSchema,
  capturedResponseSchema,
]);
export type CapturedNetworkEvent = z.infer<typeof capturedNetworkSchema>;
export type NetworkEndpoint = z.infer<typeof networkEndpointSchema>;
export type NetworkMethod = (typeof NETWORK_METHODS)[number];
