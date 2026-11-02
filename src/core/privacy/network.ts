import type { NetworkEndpoint, NetworkMethod } from '../../types/network';

export const SAFE_ROUTE_SEGMENTS = [
  'api',
  'v1',
  'v2',
  'v3',
  'graphql',
  'rest',
  'auth',
  'login',
  'logout',
  'users',
  'user',
  'orders',
  'order',
  'products',
  'product',
  'items',
  'item',
  'search',
  'health',
  'status',
  '[REDACTED]',
] as const;
export const NETWORK_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'OTHER',
] as const;

export function sanitizeMethod(value: unknown): NetworkMethod {
  const method = typeof value === 'string' ? value.toUpperCase() : 'OTHER';
  return NETWORK_METHODS.find((allowed) => allowed === method) ?? 'OTHER';
}

export function sanitizeEndpoint(
  value: unknown,
  base: string,
  pageOrigin?: string,
): NetworkEndpoint {
  try {
    if (typeof value !== 'string' || value.length > 4096)
      throw new Error('Unsupported URL metadata');
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error('Unsupported protocol');
    const segments = url.pathname.split('/').filter(Boolean);
    const path = segments
      .slice(0, 8)
      .map(
        (segment) =>
          SAFE_ROUTE_SEGMENTS.find((safe) => safe === segment) ?? '[REDACTED]',
      );
    if (segments.length > 8) path[7] = '[REDACTED]';
    return {
      scope:
        url.origin === (pageOrigin ?? new URL(base).origin)
          ? 'same-origin'
          : 'cross-origin',
      path,
      detailsOmitted: true,
    };
  } catch {
    return { scope: 'unknown', path: ['[REDACTED]'], detailsOmitted: true };
  }
}

export function copyEndpoint(endpoint: NetworkEndpoint): NetworkEndpoint {
  return {
    scope: endpoint.scope,
    path: [...endpoint.path],
    detailsOmitted: true,
  };
}
