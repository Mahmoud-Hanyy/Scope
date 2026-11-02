import { expect, it } from 'vitest';
import { capturedClick, normalizedClick } from '../../test/interaction-fixture';
import { normalizeEvent } from './events';
import { sanitizeInteraction } from '../privacy/interactions';
import { captureBatchSchema } from '../../messaging/capture';

it('normalizes stable IDs and authoritative browser/session context into ScopeEvent', () => {
  expect(
    normalizeEvent(capturedClick, {
      sessionId: normalizedClick.sessionId,
      tabId: 7,
      documentId: 'test-document',
      receivedAt: 1600,
    }),
  ).toEqual(normalizedClick);
});

it('reconstructs only approved metadata even if an internal object has extra fields', () => {
  const unsafe = {
    ...capturedClick.data,
    value: 'private-secret',
    textContent: 'private-secret',
    url: 'private-secret',
  };
  expect(sanitizeInteraction(unsafe)).toEqual(capturedClick.data);
  expect(JSON.stringify(sanitizeInteraction(unsafe))).not.toContain(
    'private-secret',
  );
});

it('rejects sensitive extras, unknown element categories, and oversized batches at the boundary', () => {
  const batch = {
    type: 'scope/captured-events',
    sessionId: normalizedClick.sessionId,
    events: [capturedClick],
  };
  expect(captureBatchSchema.safeParse(batch).success).toBe(true);
  expect(
    captureBatchSchema.safeParse({
      ...batch,
      events: [
        { ...capturedClick, data: { ...capturedClick.data, value: 'secret' } },
      ],
    }).success,
  ).toBe(false);
  expect(
    captureBatchSchema.safeParse({
      ...batch,
      events: [
        {
          ...capturedClick,
          data: { ...capturedClick.data, element: 'secret' },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    captureBatchSchema.safeParse({
      ...batch,
      events: Array.from({ length: 21 }, () => capturedClick),
    }).success,
  ).toBe(false);
});
