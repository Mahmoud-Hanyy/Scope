import { z } from 'zod';
import { sessionAnalysisSchema } from '../types/incident';

export const analysisRequestSchema = z
  .object({ type: z.literal('scope/analyze-session'), sessionId: z.uuid() })
  .strict();
export const analysisReplySchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('ok'), analysis: sessionAnalysisSchema })
    .strict(),
  z.object({ status: z.literal('error') }).strict(),
]);
