import type { CapturedInteraction, ScopeEvent } from '../types/event';
import { activeSession } from './session-fixture';

export const capturedClick: CapturedInteraction = {
  id: '223e4567-e89b-42d3-a456-426614174000',
  type: 'click',
  timestamp: 1500,
  sequence: 0,
  data: { element: 'button', controlType: null, valueOmitted: true },
};
export const normalizedClick: ScopeEvent = {
  ...capturedClick,
  sessionId: activeSession.id,
  source: 'content',
  severity: 'info',
  tabId: activeSession.tabId,
  documentId: 'test-document',
  receivedAt: 1600,
};
