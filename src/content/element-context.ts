import { elementContextSchema, type ElementContext } from '../types/event';

export function elementContext(element: Element): ElementContext | null {
  let kind: ElementContext['element'];
  if (element instanceof HTMLInputElement) kind = 'input';
  else if (element instanceof HTMLTextAreaElement) kind = 'textarea';
  else if (element instanceof HTMLSelectElement) kind = 'select';
  else if (element instanceof HTMLFormElement) kind = 'form';
  else if (
    element instanceof HTMLButtonElement ||
    element.getAttribute('role') === 'button'
  )
    kind = 'button';
  else if (
    element instanceof HTMLAnchorElement ||
    element.getAttribute('role') === 'link'
  )
    kind = 'link';
  else return null;
  const controlType = element instanceof HTMLInputElement ? element.type : null;
  const safeType =
    elementContextSchema.shape.controlType.safeParse(controlType);
  return {
    element: kind,
    controlType: safeType.success ? safeType.data : 'other',
    valueOmitted: true,
  };
}

export function interactionContext(event: Event): ElementContext | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    const context = elementContext(node);
    if (!context) continue;
    if (event.type === 'submit')
      return context.element === 'form' ? context : null;
    if (event.type === 'change')
      return ['input', 'textarea', 'select'].includes(context.element)
        ? context
        : null;
    // A form container alone is not a useful click target.
    if (context.element !== 'form') return context;
  }
  return null;
}
