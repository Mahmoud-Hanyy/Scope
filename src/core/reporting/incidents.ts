import type {
  Incident,
  CorrelationLink,
  SessionAnalysis,
} from '../../types/incident';
import { describeEvent } from './event-description';
import { severityReason } from '../detection/problems';

export function incidentTitle(incident: Incident): string {
  const anchor = incident.events.find(
    (event) => event.id === incident.anchorId,
  );
  if (!anchor) return 'Observed problem';
  if (anchor.type === 'response') {
    const route = `/${anchor.data.endpoint.path.join('/')}`;
    return anchor.data.outcome === 'response'
      ? `HTTP ${anchor.data.status} · ${anchor.data.method} ${route}`
      : `${anchor.data.outcome === 'timeout' ? 'Request timed out' : 'Network failure'} · ${anchor.data.method} ${route}`;
  }
  return anchor.type === 'exception'
    ? `Uncaught ${anchor.data.name}`
    : anchor.type === 'promise-rejection'
      ? `Unhandled rejection · ${anchor.data.name}`
      : 'Observed problem';
}

export function explainLink(link: CorrelationLink): string {
  if (link.kind === 'request-id')
    return 'Exact pairing: matching request ID, transport, method, endpoint, session, tab, and document.';
  const time = `${link.deltaMs.toFixed(1)} ms`;
  if (link.kind === 'nearby-runtime')
    return `Possible relationship: runtime error followed this failure by ${time}; it was the only failed response in the preceding 1,000 ms in this document, with no captured interaction in between. Timing does not prove causation.`;
  return `Possible relationship: nearest preceding action was ${time} before this request in the same document (1,000 ms window).${link.alternatives ? ` ${link.alternatives} other action(s) were also in that window.` : ''} Timing does not prove causation.`;
}

export const caveatDescriptions: Record<Incident['caveats'][number], string> = {
  'missing-request':
    'The matching request start was not captured; no preceding action was inferred.',
  'ambiguous-request':
    'Multiple matching request starts were present; no exact request pairing was chosen.',
  'multiple-actions':
    'Several actions preceded this request. The displayed action is the nearest candidate, not a proven trigger.',
  'ambiguous-runtime':
    'Several failed responses preceded this runtime error. It remains separate rather than choosing a cause.',
  'intervening-action':
    'Another captured interaction occurred between the failure and this runtime error. The error remains separate.',
};

export function buildIncidentReport(
  analysis: SessionAnalysis,
  incident: Incident,
): string {
  const references = new Map(
    incident.events.map((event, index) => [event.id, index + 1]),
  );
  const lines = [
    `# Scope incident: ${incidentTitle(incident)}`,
    '',
    `Severity: ${incident.severity.toUpperCase()}`,
    severityReason(incident),
    '',
    `Session: ${analysis.session.id}`,
    `Incident: ${incident.id}`,
    `Analysis snapshot: ${analysis.eventCount} captured events; session ${analysis.session.status}.`,
    ...(analysis.session.endReason
      ? [`Session ended by: ${analysis.session.endReason}.`]
      : []),
    '',
    '## Observed sequence',
    '',
    ...incident.events.map(
      (event, index) =>
        `${index + 1}. +${Math.max(0, (event.timestamp - analysis.session.startedAt) / 1000).toFixed(3)}s — ${describeEvent(event)} [event ${event.id}]`,
    ),
    '',
    '## Relationship evidence',
    '',
    ...(incident.links.length
      ? incident.links.map(
          (link) =>
            `- Event ${references.get(link.fromId)} → ${references.get(link.toId)}: ${explainLink(link)}`,
        )
      : ['- No relationship was inferred for this standalone problem.']),
    ...incident.caveats.map((caveat) => `- ${caveatDescriptions[caveat]}`),
    '',
    '## Limits and privacy',
    '',
    '- Temporal links are hypotheses, not proof of root cause. Page-context metadata is not authenticated evidence.',
    '- Messages, stacks, rejection values, form values, page text, headers, bodies, actual origins, query strings, and private path segments are omitted.',
    '- Capture covers the top document during recording. Navigation, teardown, and storage limits can leave gaps. Pending requests may lack a completion.',
    '- Fetch timing generally ends at response headers; XHR timing ends at its terminal event.',
    ...(analysis.session.status === 'active'
      ? [
          '- This report was generated during recording; analyze again for later events.',
        ]
      : []),
    ...(analysis.session.endReason === 'event-limit'
      ? [
          '- The session reached its event limit; later events were not captured.',
        ]
      : []),
    '',
  ];
  return lines.join('\n');
}
