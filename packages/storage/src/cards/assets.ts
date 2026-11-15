import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { StorageError } from "../errors.js";
import type { FolderLayout } from "../paths.js";
import { assetFilesFor, cardFileAssetIds, listAssetFiles, removeAssetFiles } from "./asset-scan.js";
import type { CardIndexStore } from "./index-store.js";

const BLOB_ID = /^[0-9a-f]{64}$/;
const EXTENSION = /^[a-z0-9]{1,12}$/i;

export interface PutAssetInput {
  readonly bytes: Uint8Array | AsyncIterable<Uint8Array>;
  /** 權威的媒體類型，寫進 `asset_meta`。 */
  readonly mediaType: string;
  /** 檔名用的副檔名，不含點，例如 `png`。 */
  readonly extension: string;
}

export interface PutAssetResult {
  readonly blobId: string;
  readonly sizeBytes: number;
  /** 內部相對路徑：`assets/<sha256>.<ext>`。 */
  readonly relPath: string;
}

export type ReleaseResult = "deleted" | "retained" | "skipped";

export interface AssetSweepResult {
  /** 在 `assets/` 掃到幾個雜湊（以雜湊計，同內容不同副檔名算一個）。 */
  readonly scanned: number;
  /** 刪掉幾個雜湊（連同它的所有副檔名與 `asset_meta`）。 */
  readonly deleted: number;
  /** 索引未完成或讀不到卡片檔，整批沒有動。 */
  readonly skipped: boolean;
}

export interface LocalAssetStoreOptions {
  readonly layout: FolderLayout;
  readonly index: CardIndexStore;
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
}

export interface ReleaseCandidatesResult {
  /** 已確認沒有引用、檔案與 `asset_meta` 都處理完的雜湊。 */
  readonly reclaimed: readonly string[];
  /** 索引未完成或讀不到卡片檔，整批沒有動。 */
  readonly skipped: boolean;
}

/**
 * `assets/` 正本區：以內容雜湊命名，永不改寫，引用計數歸零才刪。
 *
 * 引用計數的權威是 `cards/*.md` 的實際內容，不是 `cache/index.sqlite` 的
 * `asset_refs`：索引是展開出來快取，格式不符的檔案與還沒被監看到的外部
 * 檔案都不在裡面，光查索引會刪掉仍被引用的原檔。索引只拿來加速——它說
 * 還有引用就保留，它說沒有仍要掃描檔案。索引還沒追上 `cards/`
 * （`index.isReady === false`）或掃描不完整時一律跳過回收（`release` 與 `sweep` 都跳過），
 * 寧可晚一點刪，也不能誤刪使用者的原檔。
 *
 * 卡片檔的掃描與原檔刪除規則在 `asset-scan.ts`，對話刪除的收尾也用同一份。
 *
 * 主機啟動掃描會呼叫 `sweep()`，整批比對所有原檔與卡片檔：沒有引用就刪。
 */
export class LocalAssetStore {
  readonly #layout: FolderLayout;
  readonly #index: CardIndexStore;
  readonly #now: () => Date;
  readonly #trace: ((operation: string) => void) | undefined;

  constructor(options: LocalAssetStoreOptions) {
    this.#layout = options.layout;
    this.#index = options.index;
    this.#now = options.now ?? (() => new Date());
    this.#trace = options.trace;
  }

  get directory(): string {
    return this.#layout.subfolderPath("assets");
  }

  /** 內容雜湊命名；同內容同副檔名就是同一個檔案。 */
  relPathFor(blobId: string, extension: string): string {
    return `assets/${assertBlobId(blobId)}.${assertExtension(extension)}`;
  }

  /**
   * 寫入一個原檔，回傳內容雜湊。
   *
   * 先寫到 `tmp/` 的暫存檔邊寫邊算雜湊，`fsync` 之後才 rename 進
   * `assets/`；失敗時只刪自己的暫存檔。內容相同的檔案已存在時不覆寫。
   */
  async put(input: PutAssetInput): Promise<PutAssetResult> {
    const extension = assertExtension(input.extension);
    const hash = createHash("sha256");
    const tempPath = path.join(
      this.#layout.subfolderPath("tmp"),
      `asset-${randomBytes(8).toString("hex")}.part`,
    );
    mkdirSync(this.directory, { recursive: true });
    mkdirSync(path.dirname(tempPath), { recursive: true });
    let fd: number | null = null;
    let sizeBytes = 0;
    try {
      fd = openSync(tempPath, "wx+", 0o644);
      for await (const chunk of toChunks(input.bytes)) {
        hash.update(chunk);
        writeAll(fd, chunk);
        sizeBytes += chunk.length;
      }
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
    } catch (error) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // 保留原始錯誤。
        }
      }
      rmSync(tempPath, { force: true });
      throw asStorageError(error, "原檔寫入失敗");
    }

    const blobId = hash.digest("hex");
    const target = this.#layout.absolute(this.relPathFor(blobId, extension));
    try {
      if (existsSync(target)) {
        // 同樣的內容已經在，同樣的位元組不需要再寫一次。
        rmSync(tempPath, { force: true });
      } else {
        renameSync(tempPath, target);
        syncDirectory(this.directory);
      }
    } catch (error) {
      rmSync(tempPath, { force: true });
      throw asStorageError(error, "原檔搬進 assets/ 失敗", blobId);
    }

    this.#index.ensureAssetMeta({ assetId: blobId, mediaType: input.mediaType, sizeBytes });
    this.#trace?.("assets:put");
    return { blobId, sizeBytes, relPath: this.relPathFor(blobId, extension) };
  }

  /** 讀回原檔；同一個雜湊可能有多個副檔名，依檔名排序取第一個。 */
  read(blobId: string): Uint8Array | undefined {
    const target = this.#findFiles(blobId)[0];
    if (target === undefined) {
      return undefined;
    }
    return readFileSync(target);
  }

  /**
   * 引用計數歸零時刪掉原檔與 `asset_meta`。
   *
   * 回傳 `retained`（還有卡片引用，或檔案是硬連結不能刪）、`skipped`
   * （索引未完成或無法確認，不能判斷）或 `deleted`（已刪除，或本來就
   * 沒有檔案）。
   *
   * 判斷順序：索引未完成就跳過；索引說還有引用就保留；否則掃描
   * `cards/*.md` 的實際內容，連格式不符的檔案與還沒進索引的外部檔一起看。
   */
  release(blobId: string): ReleaseResult {
    const result = this.releaseCandidates([assertBlobId(blobId)]);
    if (result.skipped) {
      this.#trace?.("assets:release-skipped");
      return "skipped";
    }
    if (result.reclaimed.length === 0) {
      return "retained";
    }
    this.#trace?.("assets:deleted");
    return "deleted";
  }

  /**
   * 批次回收指定的雜湊；`release()` 的候選清單版，卡片檔只掃一次。
   *
   * 對話刪除的收尾用它：候選來自刪除意圖的 `asset_ids`，卡片檔刪完後在
   * 這裡確認其他卡片檔與索引都沒有引用才刪。判斷規則與 `release()` 相同。
   */
  releaseCandidates(assetIds: readonly string[]): ReleaseCandidatesResult {
    if (!this.#index.isReady) {
      return { reclaimed: [], skipped: true };
    }
    // 索引說還有引用就先保留，不必掃描卡片檔；這也是 `release()` 原本的順序。
    const candidates = new Set<string>();
    for (const raw of assetIds) {
      const assetId = raw.toLowerCase();
      if (this.#index.assetRefCount(assetId) === 0) {
        candidates.add(assetId);
      }
    }
    if (candidates.size === 0) {
      return { reclaimed: [], skipped: false };
    }
    const referenced = cardFileAssetIds(this.#layout);
    if (referenced === null) {
      return { reclaimed: [], skipped: true };
    }
    const filesById = new Map<string, string[]>();
    for (const entry of listAssetFiles(this.#layout)) {
      const files = filesById.get(entry.assetId);
      if (files === undefined) {
        filesById.set(entry.assetId, [entry.path]);
      } else {
        files.push(entry.path);
      }
    }
    const reclaimed: string[] = [];
    let removedFiles = 0;
    for (const assetId of candidates) {
      if (referenced.has(assetId)) {
        continue;
      }
      const { removed, kept } = removeAssetFiles(this.#layout, filesById.get(assetId) ?? []);
      removedFiles += removed;
      if (kept > 0) {
        continue;
      }
      this.#index.removeAssetMeta(assetId);
      reclaimed.push(assetId);
    }
    if (removedFiles > 0) {
      syncDirectory(this.directory);
    }
    return { reclaimed, skipped: false };
  }

  /**
   * 整批回收沒有卡片檔引用的原檔（與它的 `asset_meta`）。
   *
   * 判斷方式與 `release()` 一樣：先確認索引已完成，再以 `cards/*.md` 的
   * 實際內容為準。掃描不到卡片檔內容就整批跳過，不會把「看不到」當成
   * 「沒有」。
   *
   * 呼叫時機是主機啟動掃描：客戶端還沒連上，不會踩到「原檔剛寫好、
   * 卡片檔還沒寫」的中間狀態。跳過回收的原檔（`release` 回 `skipped`）
   * 靠這裡補。
   */
  sweep(): AssetSweepResult {
    if (!this.#index.isReady) {
      this.#trace?.("assets:sweep-skipped");
      return { scanned: 0, deleted: 0, skipped: true };
    }
    const groups = new Set(listAssetFiles(this.#layout).map((entry) => entry.assetId));
    const result = this.releaseCandidates([...groups]);
    if (result.skipped) {
      this.#trace?.("assets:sweep-skipped");
      return { scanned: 0, deleted: 0, skipped: true };
    }
    if (result.reclaimed.length > 0) {
      this.#trace?.("assets:sweep-deleted");
    }
    return { scanned: groups.size, deleted: result.reclaimed.length, skipped: false };
  }

  /** 這個雜湊在 `assets/` 底下的所有檔案；同內容不同副檔名會有多個。 */
  filesFor(blobId: string): string[] {
    return this.#findFiles(blobId);
  }

  #findFiles(blobId: string): string[] {
    return assetFilesFor(this.#layout, assertBlobId(blobId));
  }

  /** 目前時間；給呼叫端組中繼資料用。 */
  now(): Date {
    return this.#now();
  }

  /** 單一原檔的位元組數；不存在時回 undefined。 */
  sizeOf(blobId: string): number | undefined {
    const target = this.#findFiles(blobId)[0];
    return target === undefined ? undefined : statSync(target).size;
  }
}

function assertBlobId(blobId: string): string {
  const normalized = blobId.toLowerCase();
  if (!BLOB_ID.test(normalized)) {
    throw new StorageError("invalid-path", "原檔識別碼必須是 SHA-256 十六進位字串", { blobId });
  }
  return normalized;
}

function assertExtension(extension: string): string {
  const normalized = extension.toLowerCase();
  if (!EXTENSION.test(normalized)) {
    throw new StorageError("invalid-path", "副檔名不合法", { extension });
  }
  return normalized;
}

async function* toChunks(
  bytes: Uint8Array | AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  if (bytes instanceof Uint8Array) {
    yield bytes;
    return;
  }
  for await (const chunk of bytes) {
    yield chunk;
  }
}

function writeAll(fd: number, chunk: Uint8Array): void {
  const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function syncDirectory(directory: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch {
    // 部分檔案系統不支援對目錄 fsync；資料已 rename 完成。
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // 同上。
      }
    }
  }
}

function asStorageError(error: unknown, message: string, blobId?: string): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  return new StorageError("storage-failed", message, {
    ...(blobId === undefined ? {} : { blobId }),
    cause: error instanceof Error ? error.message : String(error),
  });
}
