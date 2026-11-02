const IDS = ['scope-reload-page', 'scope-reload-content'];

export async function removeReloadScripts(): Promise<void> {
  // These IDs belong exclusively to Scope's one pending reload operation.
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: IDS,
  });
  if (existing.length)
    await chrome.scripting.unregisterContentScripts({
      ids: existing.map((script) => script.id),
    });
}

export async function prepareReloadScripts(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('[Scope] Reload capture requires an HTTP(S) page.');
  await removeReloadScripts();
  const matches = [`${parsed.protocol}//${parsed.hostname}/*`];
  await chrome.scripting.registerContentScripts([
    {
      id: 'scope-reload-page',
      matches,
      js: ['reload-injected.js'],
      world: 'MAIN',
      runAt: 'document_start',
      persistAcrossSessions: false,
    },
    {
      id: 'scope-reload-content',
      matches,
      js: ['reload-content.js'],
      world: 'ISOLATED',
      runAt: 'document_start',
      persistAcrossSessions: false,
    },
  ]);
}
