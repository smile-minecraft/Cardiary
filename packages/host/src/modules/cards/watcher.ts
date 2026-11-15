import { watch } from "node:fs";
import type { JSONObject } from "@cardiary/protocol";

import type { CardLibrary } from "./library.js";

/**
 * `cards/` 的外部變更監看。
 *
 * 使用者在 Finder 或編輯器改檔是合法輸入：監看去抖 500 毫秒後重新索引
 * 受影響的檔案；漏接時每 10 分鐘一次低成本補掃。監看只是加速，索引的
 * 正確性不依賴它——啟動掃描與補掃都會補上。
 */

export const CARD_WATCH_DEBOUNCE_MS = 500;
export const CARD_RESCAN_INTERVAL_MS = 10 * 60 * 1000;

/** 監看來源的最小介面；`node:fs` 的 `FSWatcher` 直接相容。 */
export interface CardWatchHandle {
  on(event: "error", listener: (error: unknown) => void): unknown;
  close(): void;
}

/**
 * 監看工廠：給定資料夾與事件監聽器，回傳監看來源。
 * 預設用 `node:fs` 的 `watch`；測試可以注入假的事件源確定性觸發，
 * 不依賴 FSEvents 是否送達。
 */
export type CardWatchFactory = (
  directory: string,
  listener: (event: string, fileName: string | Buffer | null) => void,
) => CardWatchHandle;

const defaultWatchFactory: CardWatchFactory = (directory, listener) =>
  watch(directory, { persistent: false }, listener);

/**
 * 解析 `CARDIARY_CARD_RESCAN_MS`：內部測試接縫，讓測試組裝縮短補掃間隔。
 * 產品預設維持 `CARD_RESCAN_INTERVAL_MS`；只有正整數毫秒有效，其他回傳 undefined。
 */
export function parseCardRescanIntervalMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

export interface CardWatcherOptions {
  readonly directory: string;
  readonly library: CardLibrary;
  readonly debounceMs?: number;
  readonly rescanIntervalMs?: number;
  readonly watchFactory?: CardWatchFactory;
  readonly warn?: (message: string, fields?: JSONObject) => void;
}

export class CardWatcher {
  readonly #directory: string;
  readonly #library: CardLibrary;
  readonly #debounceMs: number;
  readonly #rescanIntervalMs: number;
  readonly #watchFactory: CardWatchFactory;
  readonly #warn: (message: string, fields?: JSONObject) => void;
  readonly #changed = new Set<string>();
  #fullRescan = false;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #interval: ReturnType<typeof setInterval> | null = null;
  #watcher: CardWatchHandle | null = null;
  #running = false;

  constructor(options: CardWatcherOptions) {
    this.#directory = options.directory;
    this.#library = options.library;
    this.#debounceMs = options.debounceMs ?? CARD_WATCH_DEBOUNCE_MS;
    this.#rescanIntervalMs = options.rescanIntervalMs ?? CARD_RESCAN_INTERVAL_MS;
    this.#watchFactory = options.watchFactory ?? defaultWatchFactory;
    this.#warn = options.warn ?? (() => {});
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    try {
      this.#watcher = this.#watchFactory(this.#directory, (event, fileName) => {
        if (event === "rename" && (fileName === null || fileName === undefined)) {
          this.#fullRescan = true;
        } else if (typeof fileName === "string") {
          this.#changed.add(fileName);
        } else {
          this.#fullRescan = true;
        }
        this.#schedule();
      });
      this.#watcher.on("error", (error) => {
        this.#warn("卡片資料夾監看失敗，改用定期補掃", { message: messageOf(error) });
        this.#closeWatcher();
      });
    } catch (error) {
      this.#warn("卡片資料夾監看無法啟動，改用定期補掃", { message: messageOf(error) });
    }
    this.#interval = setInterval(() => {
      void this.#library.rescan().catch((error: unknown) => {
        this.#warn("卡片補掃失敗", { message: messageOf(error) });
      });
    }, this.#rescanIntervalMs);
    this.#interval.unref?.();
  }

  /** 停止監看與補掃；重複呼叫是安全的。 */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#closeWatcher();
    if (this.#debounce !== null) {
      clearTimeout(this.#debounce);
      this.#debounce = null;
    }
    if (this.#interval !== null) {
      clearInterval(this.#interval);
      this.#interval = null;
    }
    this.#changed.clear();
    this.#fullRescan = false;
  }

  /** 測試與診斷：馬上處理已收集的變更，不等去抖。 */
  async flush(): Promise<void> {
    if (this.#debounce !== null) {
      clearTimeout(this.#debounce);
      this.#debounce = null;
    }
    await this.#run();
  }

  #schedule(): void {
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void this.#run().catch((error: unknown) => {
        this.#warn("卡片重新索引失敗", { message: messageOf(error) });
      });
    }, this.#debounceMs);
    this.#debounce.unref?.();
  }

  async #run(): Promise<void> {
    const full = this.#fullRescan;
    const names = [...this.#changed];
    this.#fullRescan = false;
    this.#changed.clear();
    if (full) {
      await this.#library.rescan();
      return;
    }
    if (names.length > 0) {
      await this.#library.syncPaths(names);
    }
  }

  #closeWatcher(): void {
    if (this.#watcher === null) return;
    try {
      this.#watcher.close();
    } catch {
      // 已經關閉。
    }
    this.#watcher = null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
