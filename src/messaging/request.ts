import type { z } from 'zod';

type MessageFailure = 'no-response' | 'invalid-response' | 'transport-error';

export class ScopeMessageError extends Error {
  constructor(
    readonly reason: MessageFailure,
    operation: string,
    cause?: unknown,
  ) {
    const details = {
      'no-response': 'the background worker returned no response',
      'invalid-response':
        'the background worker returned an incompatible response',
      'transport-error': 'the background connection was interrupted',
    };
    super(
      `Scope could not ${operation}: ${details[reason]}. Reload Scope in chrome://extensions, close and reopen the side panel, then refresh the session before trying again.`,
      { cause },
    );
    this.name = 'ScopeMessageError';
  }
}

export async function requestValidated<T>(
  message: object,
  schema: z.ZodType<T>,
  operation: string,
): Promise<T> {
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    throw new ScopeMessageError('transport-error', operation, error);
  }
  if (response === undefined)
    throw new ScopeMessageError('no-response', operation);
  const parsed = schema.safeParse(response);
  if (!parsed.success)
    throw new ScopeMessageError('invalid-response', operation, parsed.error);
  // Never retry here: a recording mutation may have completed before its reply
  // was lost. A manual session refresh reconciles the authoritative state.
  return parsed.data;
}
