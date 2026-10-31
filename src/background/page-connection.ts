import { pageReplySchema, type ConnectionReply } from '../messaging/contracts';

export async function checkTabConnection(
  tabId: number,
): Promise<ConnectionReply> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (error) {
    console.warn('[Scope] Page access or script injection failed.', error);
    return { status: 'unavailable', reason: 'page-unavailable' };
  }
  try {
    const response: unknown = await chrome.tabs.sendMessage(
      tabId,
      { type: 'scope/page-ping' },
      { frameId: 0 },
    );
    pageReplySchema.parse(response);
    return { status: 'connected' };
  } catch (error) {
    console.error('[Scope] Content script handshake failed.', error);
    return { status: 'unavailable', reason: 'handshake-failed' };
  }
}
