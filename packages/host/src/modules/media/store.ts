import { randomBytes } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import {
  THUMBNAIL_SPEC,
  extensionOfMediaType,
  mediaKindOf,
  normalizeMediaType,
  type MediaKind,
} from "@cardiary/domain";
import {
  CardIndexStore,
  FileRegistry,
  LocalAssetStore,
  type AssetMeta,
  type Database,
  type FolderLayout,
} from "@cardiary/storage";

import { asMediaError, MediaError } from "./errors.js";
import { imageSize, renderThumbnail } from "./thumbnail.js";

/** 單檔上傳上限：100 MB。 */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

const BLOB_ID = /^[0-9a-f]{64}$/;
const MEDIA_OWNER = "media";
const UPLOAD_OWNER = "media-upload";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  tiff: "image/tiff",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  aiff: "audio/aiff",
};

export interface BlobInfo {
  readonly blobId: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

export interface StoredBlobInfo extends BlobInfo {
  readonly kind: MediaKind;
  readonly path: string;
  readonly meta: AssetMeta | undefined;
}

export interface MediaStoreOptions {
  readonly layout: FolderLayout;
  readonly state: Database;
  /** 目前的快取連線；暫停後恢復時會換一個。 */
  readonly cache: () => Database;
  readonly now?: () => Date;
}

/**
 * `assets/` 與 `cache/thumbs/` 的多模態儲存。
 *
 * 原檔由卡片庫的 `LocalAssetStore` 以內容雜湊寫入；這裡只負責上傳時的
 * 暫存檔、圖片中繼資料與固定規格的縮圖。上傳中的檔案先登記到檔案登記
 * 簿再寫，行程被殺時啟動清空 `tmp/` 會一起清掉登記列。
 */
export class MediaStore {
  readonly #layout: FolderLayout;
  readonly #state: Database;
  readonly #cache: () => Database;
  readonly #now: () => Date;
  readonly #registry: FileRegistry;
  readonly #trace: ((operation: string) => void) | undefined;
  #cachedDatabase: Database | null = null;
  #cachedIndex: CardIndexStore | null = null;
  #cachedAssetDatabase: Database | null = null;
  #cachedAssets: LocalAssetStore | null = null;

  constructor(options: MediaStoreOptions & { readonly trace?: (operation: string) => void }) {
    this.#layout = options.layout;
    this.#state = options.state;
    this.#cache = options.cache;
    this.#now = options.now ?? (() => new Date());
    this.#registry = new FileRegistry(options.state, options.layout, { now: this.#now });
    this.#trace = options.trace;
  }

  get layout(): FolderLayout {
    return this.#layout;
  }

  get registry(): FileRegistry {
    return this.#registry;
  }

  /** 寫入一個上傳檔；同內容同副檔名只會有一份，回傳既有的識別碼。 */
  async put(input: {
    readonly bytes: AsyncIterable<Uint8Array>;
    readonly mediaType: string;
    readonly declaredLength?: number;
  }): Promise<BlobInfo> {
    const mediaType = normalizeMediaType(input.mediaType);
    const kind = mediaKindOf(mediaType);
    const extension = extensionOfMediaType(mediaType);
    if (kind === undefined || extension === undefined) {
      throw new MediaError("unsupported", `不支援的媒體類型：${mediaType}`, {
        reason: "unsupported_media_type",
        mediaType,
      });
    }
    if (input.declaredLength !== undefined && input.declaredLength > MAX_MEDIA_BYTES) {
      throw new MediaError("payload_too_large", "檔案超過 100 MB 上限。", {
        limitBytes: MAX_MEDIA_BYTES,
      });
    }
    const relPath = `tmp/media/${randomBytes(12).toString("hex")}.upload`;
    const tempPath = this.#layout.absolute(relPath);
    mkdirSync(path.dirname(tempPath), { recursive: true });
    // 先登記再寫：維護掃描才不會把正在上傳的檔案當成垃圾。
    this.#registry.register({
      relPath,
      ownerKind: "module",
      ownerId: UPLOAD_OWNER,
      sizeBytes: null,
    });
    let fd: number | null = null;
    let written = 0;
    try {
      fd = openSync(tempPath, "wx+", 0o644);
      for await (const chunk of input.bytes) {
        if (chunk.length === 0) continue;
        written += chunk.length;
        if (written > MAX_MEDIA_BYTES) {
          throw new MediaError("payload_too_large", "檔案超過 100 MB 上限。", {
            limitBytes: MAX_MEDIA_BYTES,
          });
        }
        writeAll(fd, chunk);
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
      this.#removeTemp(relPath, tempPath);
      throw asMediaError(error, "上傳檔案寫入失敗。");
    }
    if (input.declaredLength !== undefined && input.declaredLength !== written) {
      this.#removeTemp(relPath, tempPath);
      throw new MediaError("invalid_message", "Content-Length 與實際位元組數不符。", {
        reason: "content_length_mismatch",
        declaredLength: input.declaredLength,
        sizeBytes: written,
      });
    }
    if (written === 0) {
      this.#removeTemp(relPath, tempPath);
      throw new MediaError("invalid_message", "上傳的檔案是空的。", {
        reason: "empty_file",
      });
    }
    try {
      const result = await this.#assets().put({
        bytes: createReadStream(tempPath),
        mediaType,
        extension,
      });
      if (kind === "image") {
        const size = await imageSize(tempPath);
        if (size !== undefined) {
          this.#index().putAssetMeta({
            assetId: result.blobId,
            mediaType,
            sizeBytes: result.sizeBytes,
            width: size.width,
            height: size.height,
          });
        }
      }
      this.#trace?.("media:put");
      return { blobId: result.blobId, mediaType, sizeBytes: result.sizeBytes };
    } catch (error) {
      throw asMediaError(error, "原檔寫入失敗。");
    } finally {
      this.#removeTemp(relPath, tempPath);
    }
  }

  /** 原檔的資訊；不存在時回 undefined。 */
  info(blobId: string): StoredBlobInfo | undefined {
    const normalized = normalizeBlobId(blobId);
    const target = this.#assets().filesFor(normalized)[0];
    if (target === undefined) return undefined;
    const meta = this.#index().getAssetMeta(normalized);
    const mediaType =
      meta?.mediaType ?? MIME_BY_EXTENSION[path.extname(target).slice(1).toLowerCase()];
    const kind = mediaType === undefined ? undefined : mediaKindOf(mediaType);
    if (mediaType === undefined || kind === undefined) return undefined;
    return {
      blobId: normalized,
      mediaType,
      sizeBytes: statSync(target).size,
      kind,
      path: target,
      meta,
    };
  }

  /** 讀回整份原檔；不存在時回 undefined。 */
  read(blobId: string): Uint8Array | undefined {
    const info = this.info(blobId);
    return info === undefined ? undefined : readFileSync(info.path);
  }

  /**
   * 引用這個原檔的卡片。
   *
   * 索引就緒時查 `asset_refs`；索引還沒追上 `cards/` 時直接掃卡片檔，
   * 避免同一個內容被匯入兩次而留下兩張卡。
   */
  cardsReferencing(blobId: string): string[] {
    const assetId = normalizeBlobId(blobId);
    const index = this.#index();
    if (index.isReady) {
      return index.assetCards(assetId);
    }
    const directory = this.#layout.subfolderPath("cards");
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const name of names) {
      const match = /^([0-9A-HJKMNP-TV-Z]{26})\.md$/i.exec(name);
      if (match === null) continue;
      try {
        const text = readFileSync(path.join(directory, name), "utf8").toLowerCase();
        if (text.includes(assetId)) found.push((match[1] as string).toUpperCase());
      } catch {
        // 讀不到就跳過；匯入去重寧可多建一張卡，也不刪使用者的資料。
      }
    }
    return found;
  }

  /** 縮圖的絕對路徑；不存在時回 undefined。 */
  thumbnailPath(blobId: string): string | undefined {
    const info = this.info(blobId);
    if (info === undefined || info.kind !== "image") return undefined;
    const relPath = thumbnailRelPath(info.blobId);
    const target = this.#layout.absolute(relPath);
    return existsSync(target) ? target : undefined;
  }

  /**
   * 產生或讀回固定規格的縮圖。
   *
   * 同一張圖每次的輸出一樣；快取不存在時重新產生，位元組仍相同。
   */
  async thumbnail(blobId: string): Promise<{ readonly bytes: Uint8Array; readonly path: string }> {
    const info = this.info(blobId);
    if (info === undefined) {
      throw new MediaError("not_found", "找不到原檔。", { blobId });
    }
    if (info.kind !== "image") {
      throw new MediaError("invalid_message", "只有圖片有縮圖。", {
        reason: "variant_not_supported",
        blobId,
      });
    }
    const relPath = thumbnailRelPath(info.blobId);
    const target = this.#layout.absolute(relPath);
    if (existsSync(target)) {
      this.#registry.touch(relPath);
      return { bytes: readFileSync(target), path: target };
    }
    const input = readFileSync(info.path);
    let bytes: Uint8Array;
    try {
      bytes = await renderThumbnail(input);
    } catch (error) {
      throw asMediaError(error, "縮圖產生失敗。");
    }
    mkdirSync(path.dirname(target), { recursive: true });
    this.#registry.register({
      relPath,
      ownerKind: "module",
      ownerId: MEDIA_OWNER,
      sizeBytes: bytes.byteLength,
    });
    const tempRel = `cache/thumbs/.${info.blobId}.${randomBytes(6).toString("hex")}.tmp`;
    const tempPath = this.#layout.absolute(tempRel);
    this.#registry.register({
      relPath: tempRel,
      ownerKind: "module",
      ownerId: MEDIA_OWNER,
      sizeBytes: bytes.byteLength,
    });
    let fd: number | null = null;
    try {
      fd = openSync(tempPath, "wx+", 0o644);
      writeAll(fd, bytes);
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tempPath, target);
      syncDirectory(path.dirname(target));
    } catch (error) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // 保留原始錯誤。
        }
      }
      rmSync(tempPath, { force: true });
      this.#removeRegistryRow(tempRel);
      throw asMediaError(error, "縮圖寫入失敗。");
    }
    this.#removeRegistryRow(tempRel);
    this.#trace?.("media:thumbnail");
    return { bytes, path: target };
  }

  /** 清掉指定路徑的登記列；檔案自己刪。 */
  removeRegistered(relPath: string): void {
    this.#removeRegistryRow(relPath);
  }

  #index(): CardIndexStore {
    const database = this.#cache();
    if (this.#cachedIndex === null || this.#cachedDatabase !== database) {
      this.#cachedDatabase = database;
      this.#cachedIndex = new CardIndexStore({ db: database, now: this.#now });
    }
    return this.#cachedIndex;
  }

  #assets(): LocalAssetStore {
    const database = this.#cache();
    if (this.#cachedAssets === null || this.#cachedAssetDatabase !== database) {
      this.#cachedAssetDatabase = database;
      this.#cachedAssets = new LocalAssetStore({
        layout: this.#layout,
        index: this.#index(),
        now: this.#now,
      });
    }
    return this.#cachedAssets;
  }

  #removeTemp(relPath: string, tempPath: string): void {
    rmSync(tempPath, { force: true });
    this.#removeRegistryRow(relPath);
  }

  #removeRegistryRow(relPath: string): void {
    this.#state.run("DELETE FROM file_registry WHERE rel_path = ?", relPath);
  }
}

function thumbnailRelPath(blobId: string): string {
  return `cache/thumbs/${blobId}.${THUMBNAIL_SPEC.extension}`;
}

function normalizeBlobId(blobId: string): string {
  const normalized = blobId.trim().toLowerCase();
  if (!BLOB_ID.test(normalized)) {
    throw new MediaError("invalid_message", "原檔識別碼必須是 SHA-256 十六進位字串。", {
      field: "blobId",
    });
  }
  return normalized;
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
