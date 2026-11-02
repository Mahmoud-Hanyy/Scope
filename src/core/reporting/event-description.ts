import type { ScopeEvent } from '../../types/event';

export function describeEvent(event: ScopeEvent): string {
  if (event.type === 'request' || event.type === 'response') {
    const { transport, method, endpoint, requestId } = event.data;
    const prefix = `${transport === 'fetch' ? 'Fetch' : 'XHR'} ${method}`;
    const route = `${endpoint.scope} /${endpoint.path.join('/')}`;
    if (event.type === 'request')
      return `${prefix} · ${route} · #${requestId.slice(0, 8)}`;
    const result =
      event.data.outcome === 'response'
        ? event.data.status === 0
          ? 'opaque / status unavailable'
          : `HTTP ${event.data.status ?? 'unavailable'}`
        : event.data.outcome === 'aborted'
          ? 'aborted'
          : event.data.outcome === 'timeout'
            ? 'timed out'
            : 'network error';
    return `${prefix} → ${result} · ${event.data.durationMs.toFixed(1)} ms · ${route} · #${requestId.slice(0, 8)}`;
  }
  if (event.type === 'exception' || event.type === 'promise-rejection') {
    const location = event.data.location;
    const source = location
      ? ` · ${location.endpoint.scope} /${location.endpoint.path.join('/')}:${location.line}:${location.column}`
      : '';
    return `${event.type === 'exception' ? 'Uncaught exception' : 'Unhandled rejection'} · ${event.data.name}${source} · message and stack omitted`;
  }
  const name =
    event.type === 'input'
      ? 'Input changed'
      : event.type === 'submit'
        ? 'Form submitted'
        : 'Click';
  return `${name} · ${event.data.element}${event.data.controlType ? ` (${event.data.controlType})` : ''}`;
}
