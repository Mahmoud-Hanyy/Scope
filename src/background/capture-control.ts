import { captureReadySchema } from '../messaging/capture';
import type { Session } from '../types/session';

export async function setCapture(
  session: Session,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    await commandContent(session, true);
    try {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId: session.tabId },
        world: 'MAIN',
        files: ['injected.js'],
      });
      if (
        session.documentId !== undefined &&
        injected?.documentId !== session.documentId
      )
        throw new Error(
          '[Scope] Recording document changed during instrumentation.',
        );
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: session.tabId },
        world: 'MAIN',
        func: (sessionId: string) =>
          window.__scopeNetworkCaptureV1?.start(sessionId) === true,
        args: [session.id],
      });
      if (
        result?.result !== true ||
        (session.documentId !== undefined &&
          result.documentId !== session.documentId)
      )
        throw new Error('[Scope] Network instrumentation did not activate.');
    } catch (error) {
      try {
        await commandContent(session, false);
      } catch (cleanupError) {
        console.warn(
          '[Scope] Could not detach capture after activation failed.',
          cleanupError,
        );
      }
      throw error;
    }
    return;
  }
  let waitForNetwork = false;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      world: 'MAIN',
      func: (sessionId: string) =>
        window.__scopeNetworkCaptureV1?.stop(sessionId) === true,
      args: [session.id],
    });
    waitForNetwork = result?.result === true;
  } catch (error) {
    console.debug(
      '[Scope] Page instrumentation was unavailable during cleanup.',
      error,
    );
  }
  await commandContent(session, false, waitForNetwork);
}

async function commandContent(
  session: Session,
  enabled: boolean,
  waitForNetwork = false,
): Promise<void> {
  const response: unknown = await chrome.tabs.sendMessage(
    session.tabId,
    {
      type: 'scope/set-capture',
      sessionId: session.id,
      enabled,
      ...(!enabled && waitForNetwork ? { waitForNetwork } : {}),
    },
    { frameId: 0 },
  );
  const reply = captureReadySchema.parse(response);
  if (reply.sessionId !== session.id)
    throw new Error(
      '[Scope] Capture acknowledgement has the wrong session ID.',
    );
}
