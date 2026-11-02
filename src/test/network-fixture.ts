import type { CapturedNetworkEvent } from '../types/network';
import { activeSession } from './session-fixture';
import type { ScopeEvent } from '../types/event';

export const capturedRequest: Extract<
  CapturedNetworkEvent,
  { type: 'request' }
> = {
  id: '323e4567-e89b-42d3-a456-426614174000',
  timestamp: 1500,
  sequence: 1,
  type: 'request',
  data: {
    requestId: '423e4567-e89b-42d3-a456-426614174000',
    transport: 'fetch',
    method: 'POST',
    endpoint: {
      scope: 'same-origin',
      path: ['api', 'orders', '[REDACTED]'],
      detailsOmitted: true,
    },
  },
};
export const normalizedRequest: ScopeEvent = {
  ...capturedRequest,
  source: 'page',
  severity: 'info',
  sessionId: activeSession.id,
  tabId: 7,
  documentId: 'test-document',
  receivedAt: 1600,
};
