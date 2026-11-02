import { describe, expect, it } from 'vitest';
import { correlateIncidents } from './incidents';
import {
  incidentChain,
  incidentAction,
  incidentRequest,
  incidentResponse,
  incidentException,
} from '../../test/incident-fixture';

describe('deterministic incident correlation', () => {
  it('builds one ordered incident with explicit request and temporal evidence from unsorted input', () => {
    const input = [...incidentChain].reverse();
    const originalIds = input.map((event) => event.id);
    const result = correlateIncidents(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.events.map((event) => event.id)).toEqual(
      incidentChain.map((event) => event.id),
    );
    expect(result[0]?.links.map((link) => link.kind)).toEqual([
      'request-id',
      'nearby-action',
      'nearby-runtime',
    ]);
    expect(
      result[0]?.links.find((link) => link.kind === 'nearby-runtime')?.deltaMs,
    ).toBe(20);
    expect(correlateIncidents(incidentChain)).toEqual(result);
    expect(input.map((event) => event.id)).toEqual(originalIds);
  });

  it.each(['tabId', 'documentId', 'sessionId'] as const)(
    'never groups runtime evidence across %s',
    (key) => {
      const changed = {
        ...incidentException,
        [key]:
          key === 'tabId'
            ? 8
            : key === 'sessionId'
              ? crypto.randomUUID()
              : 'other-document',
      };
      const incidents = correlateIncidents([
        incidentAction,
        incidentRequest,
        incidentResponse,
        changed,
      ]);
      expect(incidents).toHaveLength(2);
      expect(
        incidents.find((incident) => incident.kind === 'http-error')?.events,
      ).toHaveLength(3);
      expect(
        incidents.find((incident) => incident.kind === 'runtime-error')?.links,
      ).toHaveLength(0);
    },
  );

  it('honors the inclusive time windows and leaves out-of-window evidence separate', () => {
    const request = { ...incidentRequest, timestamp: 2000 };
    const response = { ...incidentResponse, timestamp: 2400 };
    const error = { ...incidentException, timestamp: 3400 };
    expect(
      correlateIncidents([incidentAction, request, response, error]),
    ).toHaveLength(1);
    const result = correlateIncidents([
      { ...incidentAction, timestamp: 999 },
      request,
      response,
      { ...error, timestamp: 3401 },
    ]);
    expect(result).toHaveLength(2);
    expect(
      result
        .flatMap((incident) => incident.links)
        .some((link) => link.kind === 'nearby-action'),
    ).toBe(false);
  });

  it('does not assign a runtime error when multiple failures are candidates', () => {
    const second = {
      ...incidentResponse,
      id: crypto.randomUUID(),
      timestamp: 1410,
      data: { ...incidentResponse.data, requestId: crypto.randomUUID() },
    };
    const result = correlateIncidents([...incidentChain, second]);
    expect(result).toHaveLength(3);
    expect(
      result.find((incident) => incident.kind === 'runtime-error')?.caveats,
    ).toContain('ambiguous-runtime');
    expect(
      result
        .flatMap((incident) => incident.links)
        .some((link) => link.kind === 'nearby-runtime'),
    ).toBe(false);
  });

  it('does not turn standalone errors into anchors for later runtime errors', () => {
    const other = {
      ...incidentException,
      id: crypto.randomUUID(),
      timestamp: 1430,
    };
    const result = correlateIncidents([incidentException, other]);
    expect(result).toHaveLength(2);
    expect(result.every((incident) => incident.links.length === 0)).toBe(true);
  });

  it('keeps a later action’s runtime error separate from an earlier failed request', () => {
    const laterAction = {
      ...incidentAction,
      id: crypto.randomUUID(),
      timestamp: 1410,
      sequence: 3,
    };
    const result = correlateIncidents([...incidentChain, laterAction]);
    expect(result).toHaveLength(2);
    expect(
      result.find((incident) => incident.kind === 'runtime-error')?.caveats,
    ).toContain('intervening-action');
  });

  it('marks duplicate request identifiers ambiguous and exposes alternate actions', () => {
    const duplicate = { ...incidentRequest, id: crypto.randomUUID() };
    const ambiguous = correlateIncidents([
      incidentAction,
      incidentRequest,
      duplicate,
      incidentResponse,
    ]);
    expect(ambiguous[0]?.caveats).toContain('ambiguous-request');
    expect(ambiguous[0]?.links).toHaveLength(0);
    const closer = {
      ...incidentAction,
      id: crypto.randomUUID(),
      timestamp: 1010,
    };
    const result = correlateIncidents([...incidentChain, closer]);
    expect(
      result[0]?.links.find((link) => link.kind === 'nearby-action'),
    ).toMatchObject({ fromId: closer.id, alternatives: 1, deltaMs: 10 });
    expect(result[0]?.caveats).toContain('multiple-actions');
  });

  it('does not infer an exact pairing from inconsistent transport metadata', () => {
    const mismatch = {
      ...incidentResponse,
      data: { ...incidentResponse.data, method: 'GET' as const },
    };
    expect(
      correlateIncidents([incidentRequest, mismatch])[0]?.caveats,
    ).toContain('missing-request');
  });

  it('does not downgrade an observed runtime failure when grouped with a low-severity HTTP 4xx', () => {
    const response = {
      ...incidentResponse,
      data: { ...incidentResponse.data, status: 404 },
    };
    expect(
      correlateIncidents([
        incidentAction,
        incidentRequest,
        response,
        incidentException,
      ])[0]?.severity,
    ).toBe('medium');
  });
});
