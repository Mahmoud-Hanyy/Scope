import { z } from 'zod';
import { scopeEventSchema } from './event';
import { sessionSchema } from './session';

export const correlationLinkSchema = z
  .object({
    fromId: z.uuid(),
    toId: z.uuid(),
    kind: z.enum(['request-id', 'nearby-action', 'nearby-runtime']),
    deltaMs: z.number().finite().nonnegative(),
    alternatives: z.number().int().nonnegative(),
  })
  .strict();
export const incidentSchema = z
  .object({
    id: z.uuid(),
    anchorId: z.uuid(),
    kind: z.enum(['http-error', 'network-failure', 'runtime-error']),
    severity: z.enum(['low', 'medium']),
    events: z.array(scopeEventSchema).min(1).max(1000),
    links: z.array(correlationLinkSchema).max(1000),
    caveats: z.array(
      z.enum([
        'missing-request',
        'ambiguous-request',
        'multiple-actions',
        'ambiguous-runtime',
        'intervening-action',
      ]),
    ),
  })
  .strict()
  .refine(
    (incident) =>
      incident.events.some((event) => event.id === incident.anchorId),
    { message: 'The incident anchor must be included.' },
  );
export const sessionAnalysisSchema = z
  .object({
    session: sessionSchema,
    eventCount: z.number().int().min(0).max(1000),
    incidents: z.array(incidentSchema).max(1000),
  })
  .strict();
export type CorrelationLink = z.infer<typeof correlationLinkSchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type SessionAnalysis = z.infer<typeof sessionAnalysisSchema>;
