import type { ScopeEvent } from '../../types/event';
import type { Incident, CorrelationLink } from '../../types/incident';
import { detectProblems } from '../detection/problems';

export const ACTION_WINDOW_MS = 1000;
export const RUNTIME_WINDOW_MS = 1000;

export function chronological(a: ScopeEvent, b: ScopeEvent): number {
  return (
    a.timestamp - b.timestamp ||
    a.sequence - b.sequence ||
    a.id.localeCompare(b.id)
  );
}
function sameContext(a: ScopeEvent, b: ScopeEvent): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.tabId === b.tabId &&
    a.documentId === b.documentId
  );
}
function beforeOrEqual(a: ScopeEvent, b: ScopeEvent): boolean {
  return chronological(a, b) <= 0;
}

export function correlateIncidents(input: readonly ScopeEvent[]): Incident[] {
  const events = [...input].sort(chronological);
  const byId = new Map(events.map((event) => [event.id, event]));
  const seeds = detectProblems(events);
  const failures = seeds.filter((seed) => seed.kind !== 'runtime-error');
  const incidents: Incident[] = failures.map((seed) => ({
    id: seed.event.id,
    anchorId: seed.event.id,
    kind: seed.kind,
    severity: seed.severity,
    events: [seed.event],
    links: [],
    caveats: [],
  }));
  const addLink = (
    incident: Incident,
    from: ScopeEvent,
    to: ScopeEvent,
    kind: CorrelationLink['kind'],
    alternatives = 0,
  ) => {
    if (!incident.events.some((event) => event.id === from.id))
      incident.events.push(from);
    if (!incident.events.some((event) => event.id === to.id))
      incident.events.push(to);
    incident.links.push({
      fromId: from.id,
      toId: to.id,
      kind,
      deltaMs: Math.max(0, to.timestamp - from.timestamp),
      alternatives,
    });
  };

  for (const incident of incidents) {
    const response = incident.events[0];
    if (!response || response.type !== 'response') continue;
    const requests = events.filter(
      (event) =>
        event.type === 'request' &&
        sameContext(event, response) &&
        event.data.requestId === response.data.requestId &&
        event.data.transport === response.data.transport &&
        event.data.method === response.data.method &&
        event.data.endpoint.scope === response.data.endpoint.scope &&
        event.data.endpoint.path.join('/') ===
          response.data.endpoint.path.join('/') &&
        beforeOrEqual(event, response),
    );
    if (requests.length !== 1) {
      incident.caveats.push(
        requests.length ? 'ambiguous-request' : 'missing-request',
      );
      continue;
    }
    const request = requests[0];
    if (!request) continue;
    addLink(incident, request, response, 'request-id');
    const actions = events.filter(
      (event) =>
        (event.type === 'click' || event.type === 'submit') &&
        sameContext(event, request) &&
        beforeOrEqual(event, request) &&
        request.timestamp - event.timestamp <= ACTION_WINDOW_MS,
    );
    const action = actions.at(-1);
    if (action) {
      addLink(incident, action, request, 'nearby-action', actions.length - 1);
      if (actions.length > 1) incident.caveats.push('multiple-actions');
    }
  }

  for (const seed of seeds.filter(
    (candidate) => candidate.kind === 'runtime-error',
  )) {
    const candidates = incidents.filter((incident) => {
      if (incident.kind === 'runtime-error') return false;
      const anchor = byId.get(incident.anchorId);
      return (
        anchor &&
        sameContext(anchor, seed.event) &&
        beforeOrEqual(anchor, seed.event) &&
        seed.event.timestamp - anchor.timestamp <= RUNTIME_WINDOW_MS
      );
    });
    const only = candidates.length === 1 ? candidates[0] : undefined;
    const anchor = only ? byId.get(only.anchorId) : undefined;
    const intervening =
      anchor &&
      events.some(
        (event) =>
          (event.type === 'click' ||
            event.type === 'submit' ||
            event.type === 'input') &&
          sameContext(event, anchor) &&
          chronological(anchor, event) < 0 &&
          beforeOrEqual(event, seed.event),
      );
    if (only && !intervening) {
      const anchor = byId.get(only.anchorId);
      if (anchor) {
        addLink(only, anchor, seed.event, 'nearby-runtime');
        // Keep the strongest observed problem severity when merging a runtime seed.
        if (seed.severity === 'medium') only.severity = 'medium';
      }
    } else {
      incidents.push({
        id: seed.event.id,
        anchorId: seed.event.id,
        kind: seed.kind,
        severity: seed.severity,
        events: [seed.event],
        links: [],
        caveats:
          candidates.length > 1
            ? ['ambiguous-runtime']
            : intervening
              ? ['intervening-action']
              : [],
      });
    }
  }
  return incidents
    .map((incident) => ({
      ...incident,
      events: incident.events.sort(chronological),
    }))
    .sort((a, b) => {
      const left = byId.get(a.anchorId);
      const right = byId.get(b.anchorId);
      return left && right
        ? chronological(left, right)
        : a.id.localeCompare(b.id);
    });
}
