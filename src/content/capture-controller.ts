import { captureAckSchema, MAX_BATCH_SIZE } from '../messaging/capture';
import type { CapturedEvent } from '../types/event';
import { observeInteractions } from './interactions';
import { observePageNetwork } from './network-bridge';

const FLUSH_DELAY_MS = 200;
const MAX_BUFFERED_EVENTS = 100;

export class CaptureController {
  private sessionId: string | null = null;
  private buffer: CapturedEvent[] = [];
  private sequence = 0;
  private network: ReturnType<typeof observePageNetwork> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private detach: (() => void) | undefined;
  private sending: Promise<void> | null = null;

  start(sessionId: string): void {
    if (this.sessionId === sessionId) return;
    this.clear();
    this.sessionId = sessionId;
    this.sequence = 0;
    const collect = (event: CapturedEvent) => {
      if (this.buffer.length >= MAX_BUFFERED_EVENTS) {
        this.fail(sessionId);
        return;
      }
      this.buffer.push({ ...event, sequence: this.sequence++ });
      if (
        this.buffer.length >= MAX_BATCH_SIZE ||
        event.type === 'submit' ||
        (event.type === 'click' && event.data.element === 'link')
      ) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.deliver();
      } else if (!this.timer) this.scheduleFlush(FLUSH_DELAY_MS);
    };
    this.detach = observeInteractions(collect);
    this.network = observePageNetwork(sessionId, collect, () =>
      this.fail(sessionId),
    );
  }

  async stop(sessionId: string, waitForNetwork = false): Promise<void> {
    if (this.sessionId !== sessionId) return;
    this.detach?.();
    this.detach = undefined;
    try {
      if (waitForNetwork) await this.network?.waitForStop();
      this.network?.dispose();
      this.network = null;
      clearTimeout(this.timer);
      this.timer = undefined;
      await this.flush();
    } finally {
      if (this.sessionId === sessionId) this.clear();
    }
  }

  private clear(): void {
    this.network?.dispose();
    this.network = null;
    this.detach?.();
    this.detach = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.buffer = [];
    this.sessionId = null;
  }

  private fail(sessionId: string | null): void {
    if (this.sessionId !== sessionId) return;
    this.clear();
    if (sessionId)
      void Promise.resolve()
        .then(() =>
          chrome.runtime.sendMessage({
            type: 'scope/capture-failed',
            sessionId,
          }),
        )
        .catch((error: unknown) =>
          console.error('[Scope] Could not report capture failure.', error),
        );
  }

  private scheduleFlush(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.deliver();
    }, delay);
  }

  private deliver(): void {
    const sessionId = this.sessionId;
    void this.flush().catch((error: unknown) => {
      console.error('[Scope] Event delivery failed.', error);
      this.fail(sessionId);
    });
  }

  private flush(): Promise<void> {
    if (this.sending) return this.sending;
    if (!this.sessionId || !this.buffer.length) return Promise.resolve();
    const sessionId = this.sessionId;
    const operation = (async () => {
      while (this.sessionId === sessionId && this.buffer.length) {
        const events = this.buffer.splice(0, MAX_BATCH_SIZE);
        const message = {
          type: 'scope/captured-events',
          sessionId,
          events,
        };
        let response: unknown;
        try {
          response = await this.send(message);
        } catch {
          // A worker may stop between send and acknowledgement. Stable event IDs
          // make one retry safe; the repository never overwrites an existing ID.
          response = await this.send(message);
        }
        const reply = captureAckSchema.parse(response);
        if (!reply.recording) {
          if (this.sessionId === sessionId) this.clear();
          break;
        }
      }
    })();
    this.sending = operation.finally(() => {
      this.sending = null;
      if (this.sessionId && this.buffer.length && !this.timer)
        this.scheduleFlush(0);
    });
    return this.sending;
  }

  private async send(message: unknown): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('[Scope] Event acknowledgement timed out.')),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
