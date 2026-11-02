import { useEffect, useState } from 'react';
import { requestEvents } from '../../messaging/client';
import { describeEvent } from '../../core/reporting/event-description';
import { ScopeMessageError } from '../../messaging/request';
import {
  eventsChangedSchema,
  MAX_SESSION_EVENTS,
  RECENT_EVENTS_LIMIT,
  type EventsSnapshot,
} from '../../messaging/capture';

interface Props {
  sessionId: string;
  startedAt: number;
}

export function RecentEvents({ sessionId, startedAt }: Props) {
  const [state, setState] = useState<{
    sessionId: string;
    snapshot?: EventsSnapshot;
    error?: string;
  } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    let disposed = false;
    let request = 0;
    const load = async () => {
      const sequence = ++request;
      try {
        const snapshot = await requestEvents(sessionId);
        if (!disposed && sequence === request)
          setState({ sessionId, snapshot });
      } catch (error) {
        console.error('[Scope] Event preview failed.', error);
        if (!disposed && sequence === request)
          setState({
            sessionId,
            error:
              error instanceof ScopeMessageError
                ? error.message
                : 'Could not load events. Use Refresh events to retry.',
          });
      }
    };
    const onChanged = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
    ) => {
      const changed = eventsChangedSchema.safeParse(message);
      if (
        sender.id === chrome.runtime.id &&
        changed.success &&
        changed.data.sessionId === sessionId
      )
        void load();
    };
    const refresh = () => void load();
    const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
    runtime?.onMessage.addListener(onChanged);
    window.addEventListener('focus', refresh);
    void load();
    return () => {
      disposed = true;
      runtime?.onMessage.removeListener(onChanged);
      window.removeEventListener('focus', refresh);
    };
  }, [sessionId, refreshVersion]);
  const current = state?.sessionId === sessionId ? state : null;
  return (
    <section aria-labelledby="interactions-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="interactions-heading" className="text-sm font-semibold">
          Recent events
        </h3>
        <button
          type="button"
          className="text-xs text-teal-200 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          Refresh events
        </button>
      </div>
      {current?.error ? (
        <p role="alert" className="text-sm text-amber-200">
          {current.error}
        </p>
      ) : !current?.snapshot ? (
        <p className="text-sm text-slate-400">Loading events…</p>
      ) : (
        <>
          <p
            aria-label="Captured event count"
            className="text-sm text-slate-400"
          >
            {current.snapshot.count} / {MAX_SESSION_EVENTS} captured · latest{' '}
            {RECENT_EVENTS_LIMIT}
          </p>
          {current.snapshot.events.length === 0 ? (
            <p className="text-sm text-slate-400">
              No events captured yet. Interact with the recorded tab while the
              session is active.
            </p>
          ) : (
            <ol className="divide-y divide-slate-800 rounded-md border border-slate-700 px-3 text-sm">
              {current.snapshot.events.map((event) => (
                <li key={event.id} className="flex gap-3 py-2">
                  <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
                    +
                    {Math.max(0, (event.timestamp - startedAt) / 1000).toFixed(
                      3,
                    )}
                    s
                  </span>
                  <span className="min-w-0 break-words text-slate-300">
                    {describeEvent(event)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
