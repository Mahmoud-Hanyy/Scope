import { useCallback, useEffect, useRef, useState } from 'react';
import { requestSession } from '../../messaging/client';
import {
  sessionChangedSchema,
  type SessionRequest,
} from '../../messaging/contracts';
import type { Session } from '../../types/session';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const latestRequest = useRef<object | null>(null);
  const mutating = useRef(false);
  const refreshQueued = useRef(false);

  const run = useCallback(async function runRequest(
    request: SessionRequest,
  ): Promise<void> {
    const mutation = request.type !== 'scope/get-session';
    if (mutating.current) {
      if (!mutation) refreshQueued.current = true;
      return;
    }
    if (mutation) mutating.current = true;
    const token = {};
    latestRequest.current = token;
    setPending(true);
    setError(null);
    try {
      const result = await requestSession(request);
      if (mounted.current && latestRequest.current === token)
        setSession(result);
    } catch (failure) {
      console.error('[Scope] Session operation failed.', failure);
      if (mounted.current && latestRequest.current === token) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Scope could not update the session.',
        );
      }
    } finally {
      if (mutation) mutating.current = false;
      if (mounted.current && latestRequest.current === token) setPending(false);
      if (mutation && refreshQueued.current && mounted.current) {
        refreshQueued.current = false;
        void runRequest({ type: 'scope/get-session' });
      }
    }
  }, []);

  const refresh = useCallback(() => run({ type: 'scope/get-session' }), [run]);

  useEffect(() => {
    mounted.current = true;
    const onChanged = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
    ) => {
      if (
        sender.id === chrome.runtime.id &&
        sessionChangedSchema.safeParse(message).success
      )
        void refresh();
    };
    const onFocus = () => void refresh();
    const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
    runtime?.onMessage.addListener(onChanged);
    window.addEventListener('focus', onFocus);
    let disposed = false;
    // Defer the initial read so StrictMode's discarded effect sends no request.
    queueMicrotask(() => {
      if (!disposed) void refresh();
    });
    return () => {
      mounted.current = false;
      disposed = true;
      latestRequest.current = null;
      runtime?.onMessage.removeListener(onChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return {
    session,
    pending,
    error,
    refresh,
    start: () => run({ type: 'scope/start-session' }),
    stop: () =>
      session
        ? run({ type: 'scope/stop-session', sessionId: session.id })
        : Promise.resolve(),
  };
}
