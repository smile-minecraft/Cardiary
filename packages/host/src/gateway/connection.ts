import type { ServerFrame } from "@cardiary/protocol";
import { WebSocket } from "ws";

/**
 * 一條客戶端連線：有序輸出佇列、訂閱清單與驗證狀態。
 *
 * 輸出用單一 Promise 鏈序列化，確保快照一定排在補送與即時事件之前；
 * 累積待送量超過上限時直接關閉連線，讓客戶端重連後 resync。
 */
export class ClientConnection {
  readonly id: string;
  readonly ws: WebSocket;
  readonly #maxBufferedBytes: number;
  readonly #onClose: () => void;
  readonly subscriptions = new Set<string>();
  #queue: Promise<void> = Promise.resolve();
  #closed = false;
  authenticated = false;
  version = 0;
  clientInstanceId = "";
  resumeSystemSeq: number | null = null;
  authFailures = 0;

  constructor(options: {
    readonly id: string;
    readonly ws: WebSocket;
    readonly maxBufferedBytes: number;
    readonly onClose: () => void;
  }) {
    this.id = options.id;
    this.ws = options.ws;
    this.#maxBufferedBytes = options.maxBufferedBytes;
    this.#onClose = options.onClose;
    this.ws.on("close", () => {
      this.#closed = true;
      this.#onClose();
    });
    this.ws.on("error", () => {
      this.#closed = true;
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** 送出一個 frame；回傳的 Promise 在寫入完成後 resolve。 */
  send(frame: ServerFrame | { readonly [key: string]: unknown }): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const data = JSON.stringify(frame);
    const write = this.#queue.then(
      () =>
        new Promise<void>((resolve) => {
          if (this.#closed || this.ws.readyState !== WebSocket.OPEN) {
            resolve();
            return;
          }
          if (this.ws.bufferedAmount > this.#maxBufferedBytes) {
            this.close(1011, "backpressure");
            resolve();
            return;
          }
          this.ws.send(data, (error) => {
            if (error) this.close(1011, "send_failed");
            resolve();
          });
        }),
    );
    this.#queue = write;
    return write;
  }

  close(code: number, reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.subscriptions.clear();
    try {
      this.ws.close(code, reason);
    } catch {
      this.ws.terminate();
    }
  }

  /** 測試與關閉流程用：等所有已排入的 frame 寫完。 */
  async flush(): Promise<void> {
    await this.#queue;
  }
}
