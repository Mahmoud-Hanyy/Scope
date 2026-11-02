import { sanitizeEndpoint, sanitizeMethod } from '../core/privacy/network';
import type {
  NetworkObserver,
  NetworkTicket,
  RequestMetadata,
} from './observer';

type OpenArguments = [
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
];

function observeCompletion(
  xhr: XMLHttpRequest,
  ticket: NetworkTicket,
  observer: NetworkObserver,
): void {
  const types = ['load', 'error', 'abort', 'timeout'];
  const listener = (event: Event) => {
    const outcome =
      event.type === 'load'
        ? 'response'
        : event.type === 'abort'
          ? 'aborted'
          : event.type === 'timeout'
            ? 'timeout'
            : 'network-error';
    let status: number | null = null;
    if (outcome === 'response') {
      try {
        status = xhr.status;
      } catch {
        /* Some response states hide status. */
      }
    }
    observer.complete(ticket, outcome, status);
  };
  ticket.cancel = () => {
    for (const type of types) xhr.removeEventListener(type, listener, true);
  };
  for (const type of types) xhr.addEventListener(type, listener, true);
}

export function instrumentXHR(observer: NetworkObserver): () => void {
  const prototype = window.XMLHttpRequest.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const requests = new WeakMap<
    XMLHttpRequest,
    Omit<RequestMetadata, 'requestId'>
  >();
  const open = function (this: XMLHttpRequest, ...args: OpenArguments): void {
    Reflect.apply(originalOpen, this, args);
    let url: unknown;
    try {
      url =
        typeof args[1] === 'string'
          ? args[1]
          : Object.getOwnPropertyDescriptor(URL.prototype, 'href')?.get?.call(
              args[1],
            );
    } catch {
      url = undefined;
    }
    requests.set(this, {
      transport: 'xhr',
      method: sanitizeMethod(args[0]),
      endpoint: sanitizeEndpoint(url, document.baseURI, location.origin),
    });
  };
  const send = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest['send']>
  ): void {
    // open() may predate recording, so unavailable metadata remains explicit.
    const metadata: Omit<RequestMetadata, 'requestId'> = requests.get(this) ?? {
      transport: 'xhr',
      method: 'OTHER',
      endpoint: sanitizeEndpoint(undefined, document.baseURI, location.origin),
    };
    const ticket = observer.begin(metadata);
    if (ticket) observeCompletion(this, ticket, observer);
    try {
      Reflect.apply(originalSend, this, args);
    } catch (error) {
      if (ticket) observer.complete(ticket, 'network-error', null);
      throw error;
    }
  };
  prototype.open = open;
  prototype.send = send;
  return () => {
    if (prototype.open === open) prototype.open = originalOpen;
    if (prototype.send === send) prototype.send = originalSend;
  };
}
