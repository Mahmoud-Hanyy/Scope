import { expect, it, vi } from 'vitest';
import { classifyErrorReason } from './runtime';
import { capturedRuntimeSchema } from '../../types/runtime';
import { incidentException } from '../../test/incident-fixture';
import { observeRuntime } from '../../injected/runtime';

it('classifies built-in errors without reading messages, stacks, or arbitrary rejection properties', () => {
  const error = new TypeError('private-secret');
  const read = vi.fn(() => {
    throw new Error('Property must not be read');
  });
  for (const property of ['name', 'message', 'stack'])
    Object.defineProperty(error, property, { get: read });
  expect(classifyErrorReason(error)).toBe('TypeError');
  expect(classifyErrorReason({ value: 'private-secret', toString: read })).toBe(
    'non-error',
  );
  expect(classifyErrorReason('private-secret')).toBe('non-error');
  expect(read).not.toHaveBeenCalled();
});

it('rejects raw error details and synthetic page errors without suppressing browser behavior', () => {
  const sink = vi.fn();
  const detach = observeRuntime(sink, vi.fn());
  const event = new ErrorEvent('error', {
    error: new TypeError('private-secret'),
    message: 'private-secret',
    cancelable: true,
  });
  window.dispatchEvent(event);
  expect(sink).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
  detach();
  const captured = {
    id: incidentException.id,
    timestamp: 1,
    sequence: 0,
    type: 'exception',
    data: incidentException.data,
  };
  expect(capturedRuntimeSchema.safeParse(captured).success).toBe(true);
  expect(
    capturedRuntimeSchema.safeParse({
      ...captured,
      data: { ...captured.data, message: 'private-secret' },
    }).success,
  ).toBe(false);
});
