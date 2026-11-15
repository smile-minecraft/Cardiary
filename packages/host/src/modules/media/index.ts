import type { CardService, MediaKind } from "@cardiary/domain";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import { registerMediaHttpRoutes } from "./http.js";
import { manifest } from "./manifest.js";
import {
  MediaService,
  type FlipInput,
  type ImportMediaInput,
  type ImportMediaResult,
} from "./pipeline.js";
import { registerMediaProtocol } from "./protocol.js";
import { RecognitionClient } from "./recognition.js";
import { MediaStore, type BlobInfo, type StoredBlobInfo } from "./store.js";
import { createMediaToolBundle } from "./tools.js";

/** 其他模組使用的原檔服務；由卡片建立與匯入使用。 */
export interface BlobStore {
  put(input: {
    readonly bytes: AsyncIterable<Uint8Array>;
    readonly mediaType: string;
    readonly declaredLength?: number;
  }): Promise<BlobInfo>;
  info(blobId: string): StoredBlobInfo | undefined;
  read(blobId: string): Uint8Array | undefined;
  /** 匯入成卡片並產生文字替身；同一個 blobId 重跑會接回同一張卡。 */
  import(input: ImportMediaInput): Promise<ImportMediaResult>;
  /** 翻牌；模型不支援時回文字替身與原因。 */
  flip(input: FlipInput): ReturnType<MediaService["flip"]>;
  kindOf(blobId: string): MediaKind | undefined;
}

/**
 * 多模態模組的進入點。
 *
 * 協定面註冊 HTTP blob 路由與 `media.import`；匯入與翻牌以服務與工具
 * 提供給卡片、匯入與未來的介面使用。沒有殼時 `broker` 不存在，辨識
 * 一律回 `available:false`，匯入仍會完成並在卡片標明缺少的部分。
 */
export const hostModule: HostModule = {
  manifest,
  activate,
};

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const now = (): Date => context.services.clock.now();
  const store = new MediaStore({
    layout: cabinet.layout,
    state: cabinet.state,
    cache: () => cabinet.cache(),
    now,
  });
  const recognition = new RecognitionClient(() =>
    context.services.host.get(HOST_SERVICE_NAMES.broker),
  );
  const media = new MediaService({
    store,
    recognition,
    cardStorage: cabinet,
    cards: () => context.services.host.get<CardService>(HOST_SERVICE_NAMES.cards),
    models: () => context.services.host.get(HOST_SERVICE_NAMES.models),
    engine: () => context.services.host.get(HOST_SERVICE_NAMES.engine),
    now,
    logger: context.services.logger,
  });
  const blobs: BlobStore = {
    put: (input) => store.put(input),
    info: (blobId) => store.info(blobId),
    read: (blobId) => store.read(blobId),
    import: (input) => media.import(input),
    flip: (input) => media.flip(input),
    kindOf: (blobId) => store.info(blobId)?.kind,
  };

  context.services.host.provide(HOST_SERVICE_NAMES.recognition, recognition);
  context.services.host.provide(HOST_SERVICE_NAMES.blobs, blobs);
  registerMediaHttpRoutes({ store, protocol: context.services.protocol });
  registerMediaProtocol({ media, protocol: context.services.protocol });
  context.registerToolBundle(createMediaToolBundle({ media }));
  context.services.logger.info("多模態模組已啟用", {
    blobs: true,
    recognition: context.services.host.get(HOST_SERVICE_NAMES.broker) !== undefined,
  });
}

/** 停用：沒有背景工作；快取與原檔都保留。 */
export function deactivate(): void {}
