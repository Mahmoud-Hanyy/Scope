import {
  connectionReplySchema,
  type ConnectionReply,
  type ConnectionRequest,
  sessionReplySchema,
  type SessionRequest,
} from './contracts';
import type { Session } from '../types/session';
import { eventsReplySchema, type EventsSnapshot } from './capture';
import { analysisReplySchema } from './analysis';
import type { SessionAnalysis } from '../types/incident';
import { requestValidated } from './request';

export async function requestConnectionCheck(): Promise<ConnectionReply> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    throw new Error(
      'Load Scope as a Chrome extension to check a page connection.',
    );
  }
  const request: ConnectionRequest = { type: 'scope/check-connection' };
  return requestValidated(
    request,
    connectionReplySchema,
    'check the page connection',
  );
}

const sessionErrors = {
  'page-unavailable':
    'Cannot start a session. Open a regular webpage and click Scope’s toolbar icon to grant access, then try again.',
  'session-changed':
    'The session changed in another panel. Refresh the session state and try again.',
  'scope-error':
    'Scope could not save or load the session. Inspect its service worker console and try again.',
};

export async function requestSession(
  request: SessionRequest,
): Promise<Session | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    throw new Error('Load Scope as a Chrome extension to manage sessions.');
  }
  const reply = await requestValidated(
    request,
    sessionReplySchema,
    'update the session',
  );
  if (reply.status === 'error') throw new Error(sessionErrors[reply.reason]);
  return reply.session;
}

export async function requestEvents(
  sessionId: string,
): Promise<EventsSnapshot> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id)
    throw new Error('Load Scope as an extension to inspect events.');
  const reply = await requestValidated(
    { type: 'scope/get-events', sessionId },
    eventsReplySchema,
    'load captured events',
  );
  if (reply.status === 'error')
    throw new Error('Scope could not load captured events.');
  return reply.snapshot;
}

export async function requestAnalysis(
  sessionId: string,
): Promise<SessionAnalysis> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id)
    throw new Error('Load Scope as an extension to analyze a session.');
  const reply = await requestValidated(
    { type: 'scope/analyze-session', sessionId },
    analysisReplySchema,
    'analyze the session',
  );
  if (reply.status === 'error')
    throw new Error('Scope could not analyze this session.');
  if (reply.analysis.session.id !== sessionId)
    throw new Error('Scope received analysis for a different session.');
  return reply.analysis;
}
