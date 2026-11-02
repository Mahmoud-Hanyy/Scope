import { documentIdSchema } from '../types/session';

export async function currentDocumentId(tabId: number): Promise<string> {
  // A loading tab can still be the same document (hash/history navigation).
  // Read Chrome's identity without collecting URL/title or relying on page code.
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    injectImmediately: true,
    func: () => null,
  });
  return documentIdSchema.parse(result?.documentId);
}
