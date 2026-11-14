import { Console } from "node:console";

import { LineWriter } from "./ndjson.js";

export interface ProtocolSink {
  writeLine(line: string): Promise<void>;
  flush(): Promise<void>;
  readonly guardedWrites: number;
}

/**
 * 服務 stdout 的執行期守門。
 *
 * 入口在載入其他模組之前先呼叫這個函式：
 * 1. 保留真正的 `process.stdout.write` 給協定 writer，放進閉包、不匯出。
 * 2. 覆寫 `process.stdout.write`：任何不是協定 writer 發出的寫入都改寫到
 *    stderr（加上 `[stdout-guard]` 前綴），並計次。
 * 3. `console` 重新綁到 stderr，避免它繞過覆寫。
 */
export function installStdoutGuard(): ProtocolSink {
  const stdout = process.stdout as unknown as {
    write: (
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => boolean;
  };
  const realWrite = stdout.write.bind(process.stdout) as (
    chunk: string,
    callback: (error?: Error | null) => void,
  ) => void;

  const writer = new LineWriter((chunk, callback) => {
    realWrite(chunk, callback);
  });

  let guarded = 0;
  stdout.write = function guardedWrite(chunk, encoding, callback) {
    guarded += 1;
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    process.stderr.write(`[stdout-guard] ${text}`);
    const cb = typeof encoding === "function" ? encoding : callback;
    if (typeof cb === "function") cb(null);
    return true;
  };

  const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });
  globalThis.console = stderrConsole;

  return {
    writeLine: (line) => writer.writeLine(line),
    flush: () => writer.flush(),
    get guardedWrites() {
      return guarded;
    },
  };
}

/** 不覆寫 stdout 的協定 writer；測試與內嵌時使用。 */
export function createProtocolSink(
  write: (chunk: string, callback: (error?: Error | null) => void) => void,
): ProtocolSink {
  const writer = new LineWriter(write);
  return {
    writeLine: (line) => writer.writeLine(line),
    flush: () => writer.flush(),
    guardedWrites: 0,
  };
}
