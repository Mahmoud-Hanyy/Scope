import { useEffect, useState } from 'react';
import { useSession } from '../hooks/use-session';
import { sessionDuration } from '../session-duration';
import { RecentEvents } from './RecentEvents';
import { IncidentAnalysis } from './IncidentAnalysis';
import type { SessionEndReason } from '../../types/session';

const endReasons: Record<SessionEndReason, string> = {
  user: 'Stop button',
  'tab-closed': 'Tab closed',
  'browser-restart': 'Browser restarted',
  'page-navigation': 'Page navigated or reloaded',
  'capture-error': 'Capture failed — check Scope’s service worker console',
  'event-limit': '1,000-event limit reached',
};

export function SessionControls() {
  const { session, pending, error, start, stop, refresh, recordAndReload } =
    useSession();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (session?.status !== 'active') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.status]);

  return (
    <section
      aria-labelledby="session-heading"
      className="space-y-4 border-t border-slate-800 pt-6"
    >
      <h2 id="session-heading" className="font-semibold">
        Debugging session
      </h2>
      <p className="text-sm leading-6 text-slate-400">
        Record interactions, Fetch/XHR metadata, and runtime error categories in
        the current tab. Headers, bodies, error messages/stacks, and form values
        are omitted; URLs are redacted. Use Record and reload for startup
        capture. Once recording, in-page navigation continues; later reloads and
        full page changes end the session.
      </p>
      <div className="rounded-md border border-slate-700 bg-slate-900 p-4 text-sm leading-6">
        <p role="status" aria-label="Session status">
          {session?.status === 'active' && session.reload
            ? 'Preparing reload recording…'
            : session
              ? `Session ${session.status}`
              : 'No session started'}
        </p>
        {session && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 text-slate-300">
            <dt>Tab</dt>
            <dd>{session.tabId}</dd>
            <dt>Duration</dt>
            <dd
              aria-label="Session duration"
              className="font-mono tabular-nums"
            >
              {sessionDuration(session, now)}
            </dd>
            {session.endReason && (
              <>
                <dt>Ended by</dt>
                <dd>{endReasons[session.endReason]}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending || !!error || session?.status === 'active'}
          onClick={() => void recordAndReload()}
          className="rounded-md border border-teal-300 px-3 py-2 text-sm text-teal-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-200 disabled:opacity-60"
        >
          Record and reload
        </button>
        <button
          type="button"
          disabled={pending || !!error}
          onClick={() => void (session?.status === 'active' ? stop() : start())}
          className="rounded-md bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-200 disabled:opacity-60"
        >
          {pending
            ? 'Updating session…'
            : session?.status === 'active'
              ? 'Stop session'
              : 'Start session'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void refresh()}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-200 disabled:opacity-60"
        >
          Refresh session
        </button>
      </div>
      {session && (
        <RecentEvents sessionId={session.id} startedAt={session.startedAt} />
      )}
      {session && <IncidentAnalysis session={session} />}
      {error && (
        <p role="alert" className="text-sm leading-6 text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
