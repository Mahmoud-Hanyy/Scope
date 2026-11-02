import type { ScopeEvent } from '../types/event';
import { normalizedClick } from './interaction-fixture';
import { capturedRequest, normalizedRequest } from './network-fixture';

export const incidentAction: ScopeEvent = {
  ...normalizedClick,
  timestamp: 1000,
  sequence: 0,
};
export const incidentRequest: ScopeEvent = {
  ...normalizedRequest,
  timestamp: 1020,
  sequence: 1,
};
export const incidentResponse: Extract<ScopeEvent, { type: 'response' }> = {
  id: '523e4567-e89b-42d3-a456-426614174000',
  timestamp: 1400,
  sequence: 2,
  sessionId: normalizedRequest.sessionId,
  tabId: 7,
  documentId: 'test-document',
  receivedAt: 1500,
  type: 'response',
  source: 'page',
  severity: 'info',
  data: {
    ...capturedRequest.data,
    status: 500,
    durationMs: 380,
    outcome: 'response',
  },
};
export const incidentException: Extract<ScopeEvent, { type: 'exception' }> = {
  id: '623e4567-e89b-42d3-a456-426614174000',
  timestamp: 1420,
  sequence: 3,
  sessionId: normalizedRequest.sessionId,
  tabId: 7,
  documentId: 'test-document',
  receivedAt: 1500,
  type: 'exception',
  source: 'page',
  severity: 'info',
  data: { name: 'TypeError', detailsOmitted: true, location: null },
};
export const incidentChain = [
  incidentAction,
  incidentRequest,
  incidentResponse,
  incidentException,
];
