import { expect, it } from 'vitest';
import { correlateIncidents } from '../correlation/incidents';
import { buildIncidentReport } from './incidents';
import { incidentChain } from '../../test/incident-fixture';
import { activeSession } from '../../test/session-fixture';

it('exports ordered evidence with uncertainty, measured timing, privacy limits, and a snapshot warning', () => {
  const incidents = correlateIncidents(incidentChain);
  const incident = incidents[0];
  if (!incident) throw new Error('Fixture incident missing');
  const report = buildIncidentReport(
    { session: activeSession, eventCount: 4, incidents },
    incident,
  );
  expect(report).toContain('HTTP 500');
  expect(report).toContain('POST /api/orders/[REDACTED]');
  expect(report).toContain('TypeError');
  expect(report).toContain('20.0 ms');
  expect(report).toContain('Timing does not prove causation');
  expect(report).toContain('Exact pairing');
  expect(report).toContain('generated during recording');
  expect(report).toContain('message and stack omitted');
  expect(report.indexOf('1. +0.000s')).toBeLessThan(
    report.indexOf('4. +0.420s'),
  );
  expect(report).not.toMatch(/confidence|caused by|private-secret/i);
});
