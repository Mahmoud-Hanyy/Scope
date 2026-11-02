import { useState } from 'react';
import type { Session } from '../../types/session';
import { useSessionAnalysis } from '../hooks/use-session-analysis';
import {
  incidentTitle,
  explainLink,
  caveatDescriptions,
} from '../../core/reporting/incidents';
import { describeEvent } from '../../core/reporting/event-description';
import { severityReason } from '../../core/detection/problems';
import { copyReport, downloadReport } from '../report-actions';

export function IncidentAnalysis({ session }: { session: Session }) {
  const { analysis, selected, report, pending, error, refresh, select } =
    useSessionAnalysis(session.id, session.endedAt);
  const [feedback, setFeedback] = useState<{ id: string; text: string } | null>(
    null,
  );
  const references = new Map(
    selected?.events.map((event, index) => [event.id, index + 1]),
  );
  return (
    <section
      aria-labelledby="incidents-heading"
      className="space-y-4 border-t border-slate-800 pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="incidents-heading" className="font-semibold">
          Incidents
        </h3>
        <button
          type="button"
          disabled={pending}
          onClick={refresh}
          className="rounded border border-slate-700 px-3 py-2 text-sm text-teal-200 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60"
        >
          {pending ? 'Analyzing…' : 'Analyze session'}
        </button>
      </div>
      <p className="text-sm leading-6 text-slate-400">
        Review observed failures and possible relationships. Timing links do not
        prove a cause. Analyze again after reproducing a bug.
      </p>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      {analysis && (
        <>
          <p aria-label="Analysis snapshot" className="text-sm text-slate-400">
            {analysis.incidents.length} incident(s) from {analysis.eventCount}{' '}
            events · snapshot
          </p>
          {analysis.incidents.length === 0 ? (
            <p className="text-sm text-slate-400">
              No supported failures detected in this snapshot. This does not
              establish that the page is error-free.
            </p>
          ) : (
            <>
              {analysis.incidents.length > 20 && (
                <p className="text-xs text-slate-500">
                  Showing the latest 20 incidents.
                </p>
              )}
              <ul className="space-y-2" aria-label="Detected incidents">
                {analysis.incidents
                  .slice(-20)
                  .reverse()
                  .map((incident) => (
                    <li key={incident.id}>
                      <button
                        type="button"
                        aria-pressed={selected?.id === incident.id}
                        onClick={() => select(incident.id)}
                        className="w-full rounded border border-slate-700 p-3 text-left text-sm text-slate-200 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 aria-pressed:border-teal-300"
                      >
                        <span className="block break-words font-medium">
                          {incidentTitle(incident)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {incident.severity.toUpperCase()} ·{' '}
                          {incident.events.length} related record(s)
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
              {selected && (
                <article
                  aria-label="Selected incident"
                  className="space-y-4 rounded border border-slate-700 bg-slate-900 p-4"
                >
                  <h4 className="break-words text-sm font-semibold">
                    {incidentTitle(selected)}
                  </h4>
                  <p className="text-xs leading-5 text-slate-400">
                    {severityReason(selected)}
                  </p>
                  <ol
                    aria-label="Incident sequence"
                    className="space-y-3 text-sm"
                  >
                    {selected.events.map((event, index) => (
                      <li key={event.id}>
                        <span className="font-mono text-xs text-slate-500">
                          {index + 1}. +
                          {Math.max(
                            0,
                            (event.timestamp - analysis.session.startedAt) /
                              1000,
                          ).toFixed(3)}
                          s
                        </span>
                        <span className="block break-words text-slate-300">
                          {describeEvent(event)}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <h5 className="text-sm font-semibold">
                    Relationship evidence
                  </h5>
                  <ul className="space-y-3 text-xs leading-5 text-slate-400">
                    {selected.links.map((link) => (
                      <li key={`${link.kind}:${link.fromId}:${link.toId}`}>
                        Event {references.get(link.fromId)} →{' '}
                        {references.get(link.toId)}: {explainLink(link)}
                      </li>
                    ))}
                    {selected.links.length === 0 && (
                      <li>
                        No relationship was inferred for this standalone
                        problem.
                      </li>
                    )}
                    {selected.caveats.map((caveat) => (
                      <li key={caveat} className="text-amber-200">
                        {caveatDescriptions[caveat]}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="rounded bg-teal-300 px-3 py-2 text-sm font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4"
                      onClick={() => {
                        void copyReport(report)
                          .then(() =>
                            setFeedback({
                              id: selected.id,
                              text: 'Report copied.',
                            }),
                          )
                          .catch((error: unknown) => {
                            console.error(
                              '[Scope] Could not copy report.',
                              error,
                            );
                            setFeedback({
                              id: selected.id,
                              text: 'Copy failed. Use Download Markdown instead.',
                            });
                          });
                      }}
                    >
                      Copy report
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-4"
                      onClick={() => {
                        try {
                          downloadReport(report, selected.id);
                          setFeedback({
                            id: selected.id,
                            text: 'Report download requested.',
                          });
                        } catch (error) {
                          console.error(
                            '[Scope] Could not download report.',
                            error,
                          );
                          setFeedback({
                            id: selected.id,
                            text: 'Download failed. Try copying the report.',
                          });
                        }
                      }}
                    >
                      Download Markdown
                    </button>
                  </div>
                  {feedback?.id === selected.id && (
                    <p
                      role="status"
                      aria-label="Report action"
                      className="text-xs text-slate-300"
                    >
                      {feedback.text}
                    </p>
                  )}
                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer">
                      Preview sanitized report
                    </summary>
                    <pre className="mt-3 whitespace-pre-wrap break-words leading-5">
                      {report}
                    </pre>
                  </details>
                </article>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
