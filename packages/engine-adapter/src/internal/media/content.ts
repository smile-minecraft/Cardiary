import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

import type { ContentBlock } from "../../conversation.js";
import type { ToolContent } from "../../tools.js";
import type {
  MediaAsset,
  MediaAssetReader,
  MediaFallback,
  MediaFallbackReason,
  ModelInputKind,
} from "./types.js";

export type {
  MediaAsset,
  MediaAssetReader,
  MediaFallback,
  MediaFallbackReason,
  ModelInputKind,
} from "./types.js";

export interface ModelContentOptions {
  readonly modelInput: readonly ModelInputKind[];
  readonly reader?: MediaAssetReader;
}

/** 使用者訊息轉成引擎內容後的結果。 */
export interface ConvertedModelContent {
  readonly content: string | (TextContent | ImageContent)[];
  readonly fallbacks: readonly MediaFallback[];
}

/** 工具結果轉成引擎內容後的結果。 */
export interface ConvertedToolContent {
  readonly content: (TextContent | ImageContent)[];
  readonly fallbacks: readonly MediaFallback[];
}

/**
 * 把 Cardiary 的使用者訊息內容區塊轉成引擎的內容區塊。
 *
 * 圖片需要模型宣告 `image` 輸入，且主機讀得到位元組；音訊在 Pi Durable
 * 1.5.2 沒有對應的內容區塊，因此一律退回文字替身並標明原因。任何區塊
 * 無法送出都不會讓回合失敗，模型會看到原本的文字與替身說明。
 */
export async function convertModelContent(
  blocks: readonly ContentBlock[],
  options: ModelContentOptions,
): Promise<ConvertedModelContent> {
  const parts: (TextContent | ImageContent)[] = [];
  const fallbacks: MediaFallback[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      if (block.text.length > 0) {
        parts.push({ type: "text", text: block.text });
      }
      continue;
    }
    if (block.type === "image") {
      const reason = imageFallbackReason(options, undefined);
      if (reason !== undefined) {
        fallbacks.push({ assetId: block.assetId, kind: "image", reason });
        parts.push({ type: "text", text: fallbackText("image", block.assetId, reason) });
        continue;
      }
      const asset = await readAsset(block.assetId, options.reader);
      if (asset === null) {
        const missing: MediaFallbackReason = "media_asset_unavailable";
        fallbacks.push({ assetId: block.assetId, kind: "image", reason: missing });
        parts.push({ type: "text", text: fallbackText("image", block.assetId, missing) });
        continue;
      }
      parts.push({
        type: "image",
        data: Buffer.from(asset.bytes).toString("base64"),
        mimeType: asset.mediaType,
      });
      continue;
    }
    // Pi Durable 1.5.2 的 UserMessage 只接受文字與圖片；音訊沒有內容區塊。
    const reason: MediaFallbackReason = options.modelInput.includes("audio")
      ? "engine_input_unsupported:audio"
      : "model_input_unsupported:audio";
    fallbacks.push({ assetId: block.assetId, kind: "audio", reason });
    parts.push({ type: "text", text: fallbackText("audio", block.assetId, reason) });
  }
  if (parts.every((part) => part.type === "text")) {
    return {
      content: parts.map((part) => (part as TextContent).text).join("\n"),
      fallbacks,
    };
  }
  return { content: parts, fallbacks };
}

/** 把工具結果的內容轉成引擎的內容區塊；圖片同樣不重新編碼。 */
export async function convertToolContent(
  content: readonly ToolContent[],
  options: ModelContentOptions,
): Promise<ConvertedToolContent> {
  const parts: (TextContent | ImageContent)[] = [];
  const fallbacks: MediaFallback[] = [];
  for (const block of content) {
    switch (block.type) {
      case "text":
        parts.push({ type: "text", text: block.text });
        break;
      case "json":
        parts.push({ type: "text", text: JSON.stringify(block.value) });
        break;
      case "card":
        parts.push({ type: "text", text: JSON.stringify(block.card) });
        break;
      case "image": {
        const reason = imageFallbackReason(options, block.bytes);
        if (reason !== undefined) {
          fallbacks.push({ assetId: block.assetId, kind: "image", reason });
          parts.push({ type: "text", text: fallbackText("image", block.assetId, reason) });
          break;
        }
        const asset = await imageAsset(block, options.reader);
        if (asset === null) {
          const missing: MediaFallbackReason = "media_asset_unavailable";
          fallbacks.push({ assetId: block.assetId, kind: "image", reason: missing });
          parts.push({ type: "text", text: fallbackText("image", block.assetId, missing) });
          break;
        }
        parts.push({
          type: "image",
          data: Buffer.from(asset.bytes).toString("base64"),
          mimeType: asset.mediaType,
        });
        break;
      }
      default:
        parts.push({ type: "text", text: "" });
    }
  }
  return { content: parts, fallbacks };
}

function imageFallbackReason(
  options: ModelContentOptions,
  inlineBytes: Uint8Array | undefined,
): MediaFallbackReason | undefined {
  if (!options.modelInput.includes("image")) {
    return "model_input_unsupported:image";
  }
  if (inlineBytes === undefined && options.reader === undefined) {
    return "media_reader_unavailable";
  }
  return undefined;
}

/** 工具帶來的位元組優先；沒有時才向主機的媒體服務讀。 */
async function imageAsset(
  block: { readonly assetId: string; readonly bytes?: Uint8Array; readonly mediaType: string },
  reader: MediaAssetReader | undefined,
): Promise<MediaAsset | null> {
  if (block.bytes !== undefined) {
    return { bytes: block.bytes, mediaType: block.mediaType };
  }
  return readAsset(block.assetId, reader);
}

async function readAsset(
  assetId: string,
  reader: MediaAssetReader | undefined,
): Promise<MediaAsset | null> {
  if (reader === undefined) {
    return null;
  }
  try {
    return await reader.read(assetId);
  } catch {
    return null;
  }
}

function fallbackText(
  kind: "image" | "audio",
  assetId: string,
  reason: MediaFallbackReason,
): string {
  const explanation: Record<MediaFallbackReason, string> = {
    "model_input_unsupported:image": "主模型不支援圖片輸入",
    "model_input_unsupported:audio": "主模型不支援音訊輸入",
    "engine_input_unsupported:audio": "引擎 1.5.2 沒有音訊內容區塊",
    media_reader_unavailable: "主機沒有提供原檔讀取",
    media_asset_unavailable: "讀不到原檔位元組",
  };
  return `[${kind} ${assetId}]（${explanation[reason]}，未送出原檔；${reason}）`;
}
