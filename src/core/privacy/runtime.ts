import type { CapturedRuntimeEvent } from '../../types/runtime';

export function classifyErrorReason(
  value: unknown,
): CapturedRuntimeEvent['data']['name'] {
  // Read no custom properties: error messages/stacks/reasons can contain secrets.
  try {
    if (value instanceof TypeError) return 'TypeError';
    if (value instanceof ReferenceError) return 'ReferenceError';
    if (value instanceof SyntaxError) return 'SyntaxError';
    if (value instanceof RangeError) return 'RangeError';
    if (value instanceof URIError) return 'URIError';
    if (value instanceof EvalError) return 'EvalError';
    if (value instanceof AggregateError) return 'AggregateError';
    if (value instanceof Error) return 'Error';
    return 'non-error';
  } catch {
    return 'unknown';
  }
}
