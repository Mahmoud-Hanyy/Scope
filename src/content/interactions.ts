import type { CapturedInteraction } from '../types/event';
import { interactionContext } from './element-context';

export function observeInteractions(
  onInteraction: (event: CapturedInteraction) => void,
): () => void {
  let sequence = 0;
  const listener = (event: Event) => {
    if (!event.isTrusted) return;
    const data = interactionContext(event);
    if (!data) return;
    onInteraction({
      id: crypto.randomUUID(),
      type:
        event.type === 'change'
          ? 'input'
          : event.type === 'submit'
            ? 'submit'
            : 'click',
      timestamp: performance.timeOrigin + performance.now(),
      sequence: sequence++,
      data,
    });
  };
  const types = ['click', 'submit', 'change'];
  // Capture phase observes actions before page handlers can stop propagation.
  for (const type of types)
    document.addEventListener(type, listener, { capture: true, passive: true });
  return () => {
    for (const type of types)
      document.removeEventListener(type, listener, true);
  };
}
