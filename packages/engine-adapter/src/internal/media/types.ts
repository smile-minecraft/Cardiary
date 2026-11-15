/** 一個媒體區塊對應的原檔；位元組由主機的多模態服務提供。 */
export interface MediaAsset {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

/**
 * 依識別碼讀取原檔的接縫。
 *
 * 轉接層不自己找檔案，也不重新編碼圖片；實作由主機的 media 服務提供。
 * 讀不到時回 `null`，不要丟錯讓回合失敗。
 */
export interface MediaAssetReader {
  read(assetId: string): MediaAsset | null | Promise<MediaAsset | null>;
}

/** 內容區塊退回文字替身的原因。 */
export type MediaFallbackReason =
  | "model_input_unsupported:image"
  | "model_input_unsupported:audio"
  | "engine_input_unsupported:audio"
  | "media_reader_unavailable"
  | "media_asset_unavailable";

/** 一個沒有送出的媒體區塊與原因；給日誌或測試核對。 */
export interface MediaFallback {
  readonly assetId: string;
  readonly kind: "image" | "audio";
  readonly reason: MediaFallbackReason;
}

/** 模型輸入能力；與 `ModelDescriptor.input` 一致。 */
export type ModelInputKind = "text" | "image" | "audio";
