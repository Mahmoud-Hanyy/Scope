import type { ScopeEvent } from '../../types/event';
import type { Incident } from '../../types/incident';

export interface ProblemSeed {
  event: ScopeEvent;
  kind: Incident['kind'];
  severity: Incident['severity'];
}

export function detectProblems(events: readonly ScopeEvent[]): ProblemSeed[] {
  const problems: ProblemSeed[] = [];
  for (const event of events) {
    if (event.type === 'exception' || event.type === 'promise-rejection') {
      problems.push({ event, kind: 'runtime-error', severity: 'medium' });
    } else if (event.type === 'response') {
      if (
        event.data.outcome === 'network-error' ||
        event.data.outcome === 'timeout'
      ) {
        problems.push({ event, kind: 'network-failure', severity: 'medium' });
      } else if (
        event.data.outcome === 'response' &&
        event.data.status !== null &&
        event.data.status >= 400
      ) {
        problems.push({
          event,
          kind: 'http-error',
          severity: event.data.status >= 500 ? 'medium' : 'low',
        });
      }
    }
  }
  return problems;
}

export function severityReason(
  incident: Pick<Incident, 'severity' | 'kind'> & {
    events?: readonly ScopeEvent[];
  },
): string {
  if (incident.kind === 'runtime-error')
    return 'Medium: an uncaught exception or unhandled rejection was observed; user impact is unknown.';
  if (incident.kind === 'network-failure')
    return 'Medium: the request failed to complete normally or timed out; user impact is unknown.';
  if (
    incident.events?.some(
      (event) =>
        event.type === 'exception' || event.type === 'promise-rejection',
    )
  )
    return 'Medium: a runtime failure was also observed in this proposed group. The timing-based relationship and user impact remain uncertain.';
  return incident.severity === 'low'
    ? 'Low: HTTP 4xx may indicate expected validation or access control; review the action context.'
    : 'Medium: HTTP 5xx indicates a server error response; user impact is unknown.';
}
