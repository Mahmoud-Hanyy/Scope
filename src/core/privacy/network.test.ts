import { expect, it } from 'vitest';
import { sanitizeEndpoint, sanitizeMethod } from './network';
import { capturedNetworkSchema } from '../../types/network';
import { capturedRequest } from '../../test/network-fixture';
import { normalizeEvent } from '../normalization/events';
import { normalizedRequest } from '../../test/network-fixture';

it('omits credentials, hostnames, query/fragment data, and every unknown path segment', () => {
  const endpoint = sanitizeEndpoint(
    'https://private-user:private-password@private-host.test/api/orders/private-token?auth=private-secret#private-fragment',
    'https://app.example/',
  );
  expect(endpoint).toEqual({
    scope: 'cross-origin',
    path: ['api', 'orders', '[REDACTED]'],
    detailsOmitted: true,
  });
  expect(JSON.stringify(endpoint)).not.toContain('private-');
  expect(
    sanitizeEndpoint('/api/health?key=secret', 'https://app.example/').scope,
  ).toBe('same-origin');
});

it('bounds URL metadata and rejects unsupported/coercible inputs without calling toString', () => {
  const input = {
    toString() {
      throw new Error('Must not run');
    },
  };
  expect(sanitizeEndpoint(input, 'https://app.example/').scope).toBe('unknown');
  expect(
    sanitizeEndpoint('data:text/plain,secret', 'https://app.example/').path,
  ).toEqual(['[REDACTED]']);
  expect(
    sanitizeEndpoint('/' + 'x'.repeat(5000), 'https://app.example/').scope,
  ).toBe('unknown');
  expect(
    sanitizeEndpoint(
      '/api/api/api/api/api/api/api/api/private-secret',
      'https://app.example/',
    ).path,
  ).toHaveLength(8);
  expect(sanitizeMethod('CUSTOM-SECRET')).toBe('OTHER');
});

it('resolves relative URLs against the document base while comparing the actual page origin', () => {
  expect(
    sanitizeEndpoint(
      'orders/private-id',
      'https://private-api.test/api/',
      'https://app.example',
    ),
  ).toEqual({
    scope: 'cross-origin',
    path: ['api', 'orders', '[REDACTED]'],
    detailsOmitted: true,
  });
});

it('rejects forged metadata containing secrets, arbitrary routes, or headers at runtime boundaries', () => {
  expect(capturedNetworkSchema.safeParse(capturedRequest).success).toBe(true);
  expect(
    capturedNetworkSchema.safeParse({
      ...capturedRequest,
      data: { ...capturedRequest.data, headers: { authorization: 'secret' } },
    }).success,
  ).toBe(false);
  expect(
    capturedNetworkSchema.safeParse({
      ...capturedRequest,
      data: {
        ...capturedRequest.data,
        endpoint: { ...capturedRequest.data.endpoint, path: ['secret'] },
      },
    }).success,
  ).toBe(false);
  expect(
    normalizeEvent(capturedRequest, {
      sessionId: normalizedRequest.sessionId,
      tabId: 7,
      documentId: 'test-document',
      receivedAt: 1600,
    }),
  ).toEqual(normalizedRequest);
});
