import { pageReplySchema, type ConnectionReply } from '../messaging/contracts';
import { documentIdSchema } from '../types/session';

type PageConnection =
  | { status: 'connected'; documentId: string }
  | Extract<ConnectionReply, { status: 'unavailable' }>;

export async function checkTabConnection(
  tabId: number,
): Promise<PageConnection> {
  let documentId: string;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    documentId = documentIdSchema.parse(result?.documentId);
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
    return { status: 'connected', documentId };
  } catch (error) {
    console.error('[Scope] Content script handshake failed.', error);
    return { status: 'unavailable', reason: 'handshake-failed' };
  }
}
