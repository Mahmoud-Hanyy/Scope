import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./message-router', () => ({ registerMessageRouter: vi.fn() }));
vi.mock('./session-manager', () => ({ registerSessionLifecycle: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

it('disables automatic panel opening and opens directly from the action gesture', async () => {
  const addListener = vi.fn();
  const open = vi.fn().mockResolvedValue(undefined);
  const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    action: { onClicked: { addListener } },
    sidePanel: { open, setPanelBehavior },
  });
  await import('./index');
  expect(setPanelBehavior).toHaveBeenCalledWith({
    openPanelOnActionClick: false,
  });
  const listener = addListener.mock.calls[0]?.[0];
  if (!listener) throw new Error('Toolbar listener missing');
  listener({ id: 7 });
  // open() must run before the listener returns, preserving the user gesture.
  expect(open).toHaveBeenCalledWith({ tabId: 7 });
});
