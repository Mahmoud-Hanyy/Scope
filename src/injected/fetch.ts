import { sanitizeEndpoint, sanitizeMethod } from '../core/privacy/network';
import type {
  NetworkObserver,
  NetworkTicket,
  RequestMetadata,
} from './observer';

function requestField(input: Request, key: 'url' | 'method'): unknown {
  let prototype: object | null = Request.prototype;
  for (let depth = 0; prototype && depth < 8; depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor?.get) return descriptor.get.call(input);
    if (descriptor && 'value' in descriptor) return descriptor.value;
    prototype = Object.getPrototypeOf(prototype);
  }
  return undefined;
}

function metadata(
  input: RequestInfo | URL,
  init?: RequestInit,
): Omit<RequestMetadata, 'requestId'> {
  let url: unknown;
  let method: unknown = 'GET';
  try {
    if (typeof input === 'string') url = input;
    else if (input instanceof URL)
      url = Object.getOwnPropertyDescriptor(URL.prototype, 'href')?.get?.call(
        input,
      );
    else if (input instanceof Request) {
      url = requestField(input, 'url');
      method = requestField(input, 'method');
    }
    if (init && 'method' in init) {
      // Do not invoke user-defined getters a second time just for telemetry.
      const descriptor = Object.getOwnPropertyDescriptor(init, 'method');
      if (!descriptor || !('value' in descriptor)) method = 'OTHER';
      else if (descriptor.value !== undefined) method = descriptor.value;
    }
  } catch {
    method = 'OTHER';
    url = undefined;
  }
  return {
    transport: 'fetch',
    method: sanitizeMethod(method),
    endpoint: sanitizeEndpoint(url, document.baseURI, location.origin),
  };
}

function observePromise(
  promise: Promise<Response>,
  ticket: NetworkTicket | null,
  observer: NetworkObserver,
): Promise<Response> {
  if (!ticket) return promise;
  return promise.then(
    (response) => {
      let status: number | null = null;
      try {
        status = response.status;
      } catch {
        /* Metadata failure must not replace the response. */
      }
      observer.complete(ticket, 'response', status);
      return response;
    },
    (error: unknown) => {
      let aborted = false;
      try {
        aborted = error instanceof DOMException && error.name === 'AbortError';
      } catch {
        /* Preserve even unusual rejection objects. */
      }
      observer.complete(ticket, aborted ? 'aborted' : 'network-error', null);
      // Preserve the original rejection value and unhandled-rejection behavior.
      throw error;
    },
  );
}

export function instrumentFetch(observer: NetworkObserver): () => void {
  const original = window.fetch;
  const wrapped: typeof fetch = function (
    this: unknown,
    ...args: Parameters<typeof fetch>
  ) {
    const ticket = observer.begin(metadata(args[0], args[1]));
    let promise: Promise<Response>;
    try {
      promise = Reflect.apply(original, this, args);
    } catch (error) {
      if (ticket) observer.complete(ticket, 'network-error', null);
      throw error;
    }
    return observePromise(promise, ticket, observer);
  };
  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = original;
  };
}
