import type { CapturedNetworkEvent } from '../types/network';
import type { NetworkObserver, NetworkTicket } from './observer';
import { instrumentFetch } from './fetch';
import { instrumentXHR } from './xhr';

export const MAX_PENDING_REQUESTS = 200;

export function installNetworkCapture(
  publish: (event: CapturedNetworkEvent) => void,
  onFailure: () => void,
): () => void {
  let active = true;
  let sequence = 0;
  let restoreFetch: (() => void) | undefined;
  let restoreXHR: (() => void) | undefined;
  const pending = new Set<NetworkTicket>();
  const stop = () => {
    active = false;
    restoreFetch?.();
    restoreXHR?.();
    for (const ticket of pending) ticket.cancel?.();
    pending.clear();
  };
  const fail = () => {
    if (!active) return;
    stop();
    try {
      onFailure();
    } catch {
      console.warn('[Scope] Could not report network capture failure.');
    }
  };
  const emit = (event: CapturedNetworkEvent) => {
    if (!active) return;
    try {
      publish(event);
    } catch {
      fail();
    }
  };
  const observer: NetworkObserver = {
    begin(data) {
      if (!active) return null;
      if (pending.size >= MAX_PENDING_REQUESTS) {
        fail();
        return null;
      }
      try {
        const ticket: NetworkTicket = {
          data: { ...data, requestId: crypto.randomUUID() },
          started: performance.now(),
          finished: false,
        };
        pending.add(ticket);
        emit({
          id: crypto.randomUUID(),
          type: 'request',
          timestamp: performance.timeOrigin + ticket.started,
          sequence: sequence++,
          data: ticket.data,
        });
        return ticket;
      } catch {
        fail();
        return null;
      }
    },
    complete(ticket, outcome, status) {
      if (ticket.finished) return;
      ticket.finished = true;
      ticket.cancel?.();
      pending.delete(ticket);
      if (!active) return;
      try {
        const end = performance.now();
        emit({
          id: crypto.randomUUID(),
          type: 'response',
          timestamp: performance.timeOrigin + end,
          sequence: sequence++,
          data: {
            ...ticket.data,
            outcome,
            status,
            durationMs: Math.max(0, end - ticket.started),
          },
        });
      } catch {
        fail();
      }
    },
  };
  try {
    restoreFetch = instrumentFetch(observer);
    restoreXHR = instrumentXHR(observer);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
