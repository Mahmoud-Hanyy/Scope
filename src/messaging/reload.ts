import { z } from 'zod';

export const reloadClaimSchema = z
  .object({ type: z.literal('scope/claim-reload') })
  .strict();
export const reloadReplySchema = z
  .object({ sessionId: z.uuid().nullable() })
  .strict();
