import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  delete window.__scopeContentLoaded;
  vi.unstubAllGlobals();
});

it('repeated injection registers one listener and ignores other senders', async () => {
  const addListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id: 'scope-test', onMessage: { addListener } },
  });
  vi.resetModules();
  await import('./index');
  vi.resetModules();
  await import('./index');
  expect(addListener).toHaveBeenCalledTimes(1);
  const listener = addListener.mock.calls[0]?.[0];
  const reply = vi.fn();
  listener({ type: 'scope/page-ping' }, { id: 'other-extension' }, reply);
  expect(reply).not.toHaveBeenCalled();
  listener({ type: 'scope/page-ping' }, { id: 'scope-test' }, reply);
  expect(reply).toHaveBeenCalledWith({ type: 'scope/page-ready' });
});
