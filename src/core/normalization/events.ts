import {
  scopeEventSchema,
  type CapturedEvent,
  type ScopeEvent,
} from '../../types/event';
import { sanitizeInteraction } from '../privacy/interactions';
import { copyEndpoint } from '../privacy/network';

interface EventContext {
  sessionId: string;
  tabId: number;
  documentId: string;
  receivedAt: number;
}

export function normalizeEvent(
  captured: CapturedEvent,
  context: EventContext,
): ScopeEvent {
  return scopeEventSchema.parse({
    id: captured.id,
    type: captured.type,
    timestamp: captured.timestamp,
    sequence: captured.sequence,
    ...context,
    source:
      captured.type === 'click' ||
      captured.type === 'submit' ||
      captured.type === 'input'
        ? 'content'
        : 'page',
    severity: 'info',
    data:
      captured.type === 'request' || captured.type === 'response'
        ? { ...captured.data, endpoint: copyEndpoint(captured.data.endpoint) }
        : captured.type === 'exception' || captured.type === 'promise-rejection'
          ? {
              name: captured.data.name,
              detailsOmitted: true,
              location: captured.data.location
                ? {
                    endpoint: copyEndpoint(captured.data.location.endpoint),
                    line: captured.data.location.line,
                    column: captured.data.location.column,
                  }
                : null,
            }
          : sanitizeInteraction(captured.data),
  });
}
