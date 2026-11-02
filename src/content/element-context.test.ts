import { expect, it, vi } from 'vitest';
import { elementContext, interactionContext } from './element-context';
import { observeInteractions } from './interactions';

it('records a password change without reading values, names, IDs, or labels', () => {
  const input = document.createElement('input');
  input.type = 'password';
  input.value = 'private-secret';
  input.id = 'private-secret';
  input.name = 'private-secret';
  const valueRead = vi.spyOn(input, 'value', 'get');
  expect(elementContext(input)).toEqual({
    element: 'input',
    controlType: 'password',
    valueOmitted: true,
  });
  expect(valueRead).not.toHaveBeenCalled();
  expect(JSON.stringify(elementContext(input))).not.toContain('private-secret');
});

it('finds an actionable ancestor on the composed path and ignores irrelevant changes', () => {
  const button = document.createElement('button');
  const span = button.appendChild(document.createElement('span'));
  const event = new Event('click');
  vi.spyOn(event, 'composedPath').mockReturnValue([span, button, document]);
  expect(interactionContext(event)?.element).toBe('button');
  const change = new Event('change');
  vi.spyOn(change, 'composedPath').mockReturnValue([button]);
  expect(interactionContext(change)).toBeNull();
});

it('ignores script-dispatched events and removes listeners without changing page behavior', () => {
  const input = document.body.appendChild(document.createElement('input'));
  const sink = vi.fn();
  const detach = observeInteractions(sink);
  const event = new Event('change', { bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  expect(sink).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
  detach();
  input.remove();
});
