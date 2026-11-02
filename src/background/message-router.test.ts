import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkConnection, registerMessageRouter } from './message-router';

const browser = {
  tabs: { query: vi.fn(), sendMessage: vi.fn() },
  scripting: { executeScript: vi.fn() },
  runtime: {
    id: 'scope-test',
    getURL: (path: string) => `chrome-extension://scope-test/${path}`,
    onMessage: { addListener: vi.fn() },
  },
};

beforeEach(() => {
  vi.stubGlobal('chrome', browser);
  browser.tabs.query.mockResolvedValue([{ id: 7 }]);
  browser.scripting.executeScript.mockResolvedValue([
    { documentId: 'test-document' },
  ]);
  browser.tabs.sendMessage.mockResolvedValue({ type: 'scope/page-ready' });
});
afterEach(() => vi.unstubAllGlobals());

describe('background connection check', () => {
  it('injects into the active tab and validates the top-frame reply', async () => {
    expect(await checkConnection()).toEqual({ status: 'connected' });
    expect(browser.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['content.js'],
    });
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { type: 'scope/page-ping' },
      { frameId: 0 },
    );
  });

  it('does not inject when no active tab exists', async () => {
    browser.tabs.query.mockResolvedValue([]);
    expect(await checkConnection()).toEqual({
      status: 'unavailable',
      reason: 'no-active-tab',
    });
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('reports a restricted page without marking it connected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    browser.scripting.executeScript.mockRejectedValue(
      new Error('Cannot access chrome:// URL'),
    );
    expect(await checkConnection()).toEqual({
      status: 'unavailable',
      reason: 'page-unavailable',
    });
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a malformed content-script response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    browser.tabs.sendMessage.mockResolvedValue({ type: 'unexpected' });
    expect(await checkConnection()).toEqual({
      status: 'unavailable',
      reason: 'handshake-failed',
    });
  });

  it('only accepts privileged requests from our Side Panel', async () => {
    registerMessageRouter();
    const listener = browser.runtime.onMessage.addListener.mock.calls[0]?.[0];
    if (!listener) throw new Error('Router listener missing');
    const reply = vi.fn();
    const message = { type: 'scope/check-connection' };
    expect(
      listener(
        message,
        { id: 'scope-test', url: 'https://example.com' },
        reply,
      ),
    ).toBe(false);
    expect(
      listener(
        { type: 'unknown' },
        { id: 'scope-test', url: browser.runtime.getURL('sidepanel.html') },
        reply,
      ),
    ).toBe(false);
    expect(browser.tabs.query).not.toHaveBeenCalled();
    expect(
      listener(
        message,
        { id: 'scope-test', url: browser.runtime.getURL('sidepanel.html') },
        reply,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(reply).toHaveBeenCalledWith({ status: 'connected' }),
    );
  });
});
