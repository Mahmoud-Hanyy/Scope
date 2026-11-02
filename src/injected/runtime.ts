import type { CapturedRuntimeEvent } from '../types/runtime';
import { sanitizeEndpoint } from '../core/privacy/network';
import { classifyErrorReason } from '../core/privacy/runtime';

export function observeRuntime(
  publish: (event: CapturedRuntimeEvent) => void,
  onFailure: () => void,
): () => void {
  let sequence = 0;
  const emit = (
    type: CapturedRuntimeEvent['type'],
    value: unknown,
    error?: ErrorEvent,
  ) => {
    try {
      publish({
        id: crypto.randomUUID(),
        type,
        timestamp: performance.timeOrigin + performance.now(),
        sequence: sequence++,
        data: {
          name: error && !value ? 'unknown' : classifyErrorReason(value),
          location: error
            ? {
                endpoint: sanitizeEndpoint(
                  error.filename,
                  document.baseURI,
                  location.origin,
                ),
                line: Math.max(0, error.lineno),
                column: Math.max(0, error.colno),
              }
            : null,
          detailsOmitted: true,
        },
      });
    } catch {
      try {
        onFailure();
      } catch {
        console.warn('[Scope] Could not report runtime capture failure.');
      }
    }
  };
  const onError = (event: ErrorEvent) => {
    // Resource load errors are plain Events and are not JavaScript exceptions.
    if (
      event instanceof ErrorEvent &&
      event.isTrusted &&
      !event.filename.startsWith('chrome-extension:')
    )
      emit('exception', event.error, event);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (event.isTrusted) emit('promise-rejection', event.reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
