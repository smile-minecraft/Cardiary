/**
 * 多模態的領域型別。
 *
 * 實作由圖片與音訊匯入工作補上。原檔的儲存與引用計數在 `cards`；
 * 這裡只定「文字替身」與匯入結果的形狀。
 */

/** 多模態的種類。 */
export type MediaKind = "image" | "audio";

/** 文字替身的來源；缺哪一塊要說清楚，不能假裝完整。 */
export interface TextStandInSource {
  readonly ocr: "local" | "none";
  readonly description: "small-model" | "none";
  readonly transcript: "local" | "none";
  readonly summary: "small-model" | "none";
}

/** 匯入後要寫進卡片內文的文字替身。 */
export interface TextStandIn {
  readonly kind: MediaKind;
  readonly text: string;
  readonly sources: TextStandInSource;
  /** 無法產生的部分，給人看的說明。 */
  readonly missing: readonly string[];
}

/** 翻牌的結果；模型不支援時回文字替身與原因，不是錯誤。 */
export interface FlipResult {
  readonly loaded: boolean;
  readonly reason?: string;
  readonly mediaType: string;
  readonly bytes?: Uint8Array;
}
