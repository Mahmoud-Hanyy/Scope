import { expect, it } from 'vitest';
import { detectProblems, severityReason } from './problems';
import {
  incidentException,
  incidentResponse,
} from '../../test/incident-fixture';
import type { ScopeEvent } from '../../types/event';

it('distinguishes successful/opaque/aborted responses from HTTP and network failures', () => {
  const response = (
    status: number | null,
    outcome: Extract<
      ScopeEvent,
      { type: 'response' }
    >['data']['outcome'] = 'response',
  ) => ({
    ...incidentResponse,
    id: crypto.randomUUID(),
    data: { ...incidentResponse.data, status, outcome },
  });
  expect(
    detectProblems([
      response(200),
      response(0),
      response(null),
      response(null, 'aborted'),
    ]),
  ).toEqual([]);
  const detected = detectProblems([
    response(404),
    response(500),
    response(null, 'network-error'),
    response(null, 'timeout'),
    incidentException,
  ]);
  expect(detected.map((seed) => [seed.kind, seed.severity])).toEqual([
    ['http-error', 'low'],
    ['http-error', 'medium'],
    ['network-failure', 'medium'],
    ['network-failure', 'medium'],
    ['runtime-error', 'medium'],
  ]);
  expect(
    severityReason(detected[0] ?? { kind: 'http-error', severity: 'low' }),
  ).toContain('expected validation');
});
