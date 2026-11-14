import type { Readable, Writable } from "node:stream";

/** 私有通道的單一 frame 上限（`init` 的預設值 64 KiB）。 */
export const DEFAULT_CONTROL_FRAME_BYTES = 64 * 1024;

/** 控制通道只需要這兩個方法；`ProtocolSink` 與 `LineWriter` 都符合。 */
export interface LineSink {
  writeLine(line: string): Promise<void>;
  flush(): Promise<void>;
}

export interface LineReaderOptions {
  readonly maxFrameBytes?: number;
  readonly onLine: (line: string) => void;
  readonly onError: (reason: string) => void;
  readonly onEnd: () => void;
}

/**
 * NDJSON 讀取器：一行一個 JSON 物件，`\n` 結尾。
 *
 * 超過長度上限、解析失敗或最外層不是物件都由呼叫端回 `invalid_message` 並
 * 關閉通道；私有通道不應該出現壞訊息。
 */
export class LineReader {
  readonly #input: Readable;
  readonly #options: LineReaderOptions;
  readonly #maxBytes: number;
  #buffer = "";
  #stopped = false;

  constructor(input: Readable, options: LineReaderOptions) {
    this.#input = input;
    this.#options = options;
    this.#maxBytes = options.maxFrameBytes ?? DEFAULT_CONTROL_FRAME_BYTES;
    input.setEncoding?.("utf8");
    input.on("data", (chunk: string | Buffer) => {
      if (this.#stopped) return;
      this.#buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (this.#buffer.length > this.#maxBytes) {
        this.#options.onError("frame_too_large");
        this.stop();
        return;
      }
      let index = this.#buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.#buffer.slice(0, index).replace(/\r$/, "");
        this.#buffer = this.#buffer.slice(index + 1);
        if (line.trim().length > 0) this.#options.onLine(line);
        index = this.#buffer.indexOf("\n");
      }
    });
    input.on("end", () => {
      if (this.#stopped) return;
      this.#stopped = true;
      this.#options.onEnd();
    });
    input.on("close", () => {
      if (this.#stopped) return;
      this.#stopped = true;
      this.#options.onEnd();
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#input.pause();
  }
}

export class ChannelBackpressureError extends Error {
  readonly code = "channel_full";

  constructor(message: string) {
    super(message);
    this.name = "ChannelBackpressureError";
  }
}

/**
 * NDJSON 寫入器：一次只保留一個 frame 在途，等寫入 callback 完成才接下一個。
 *
 * 殼若停止讀取，待寫量超過上限就視為通道失效，呼叫端走致命錯誤關閉。
 */
export class LineWriter implements LineSink {
  readonly #write: (chunk: string, callback: (error?: Error | null) => void) => void;
  readonly #maxPendingBytes: number;
  #queue: Promise<void> = Promise.resolve();
  #pending = 0;
  #failed = false;

  constructor(
    write: (chunk: string, callback: (error?: Error | null) => void) => void,
    maxPendingBytes = 1024 * 1024,
  ) {
    this.#write = write;
    this.#maxPendingBytes = maxPendingBytes;
  }

  writeLine(line: string): Promise<void> {
    if (this.#failed) return Promise.reject(new ChannelBackpressureError("通道已失效"));
    const bytes = Buffer.byteLength(line, "utf8") + 1;
    this.#pending += bytes;
    if (this.#pending > this.#maxPendingBytes) {
      this.#failed = true;
      return Promise.reject(new ChannelBackpressureError("通道待寫量超過上限"));
    }
    const task = this.#queue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.#write(`${line}\n`, (error) => {
            this.#pending -= bytes;
            if (error) {
              this.#failed = true;
              reject(error);
              return;
            }
            resolve();
          });
        }),
    );
    this.#queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  flush(): Promise<void> {
    return this.#queue;
  }
}

export function writeAll(stream: Writable, text: string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(text, () => {
      resolve();
    });
  });
}
