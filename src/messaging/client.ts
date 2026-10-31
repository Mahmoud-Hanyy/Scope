import {
  connectionReplySchema,
  type ConnectionReply,
  type ConnectionRequest,
  sessionReplySchema,
  type SessionRequest,
} from './contracts';
import type { Session } from '../types/session';

export async function requestConnectionCheck(): Promise<ConnectionReply> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    throw new Error(
      'Load Scope as a Chrome extension to check a page connection.',
    );
  }
  const request: ConnectionRequest = { type: 'scope/check-connection' };
  const response: unknown = await chrome.runtime.sendMessage(request);
  return connectionReplySchema.parse(response);
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
  const response: unknown = await chrome.runtime.sendMessage(request);
  const reply = sessionReplySchema.parse(response);
  if (reply.status === 'error') throw new Error(sessionErrors[reply.reason]);
  return reply.session;
}
