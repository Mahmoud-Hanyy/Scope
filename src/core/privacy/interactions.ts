import type { ElementContext } from '../../types/event';

export function sanitizeInteraction(data: ElementContext): ElementContext {
  // Reconstruct the allowlist; never spread DOM-derived data into persisted events.
  return {
    element: data.element,
    controlType: data.controlType,
    valueOmitted: true,
  };
}
