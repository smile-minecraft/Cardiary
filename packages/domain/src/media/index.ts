/**
 * 多模態的領域型別與文字替身組合。
 *
 * 原檔的儲存與引用計數在 `cards`；這裡只定「文字替身」與匯入結果的形狀，
 * 以及把 OCR、描述、逐字稿與摘要排成卡片內文的規則。文字替身是搜尋與
 * 上下文唯一會碰到的部分，缺少哪一塊要寫清楚，不能假裝完整。
 */

/** 多模態的種類。 */
export type MediaKind = "image" | "audio";

/** 縮圖的固定規格；改動這裡等於讓既有快取全部失效。 */
export const THUMBNAIL_SPEC = {
  /** 長邊上限（像素）。 */
  maxEdge: 1_568,
  /** JPEG 品質。 */
  jpegQuality: 80,
  /** 快取檔的副檔名。 */
  extension: "jpg",
} as const;

/** 支援的圖片媒體類型與對應副檔名。 */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
};

/** 支援的音訊媒體類型與對應副檔名。 */
const AUDIO_TYPES: Readonly<Record<string, string>> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
};

/**
 * 媒體類型轉成多模態種類；不支援時回 undefined。
 *
 * 只接受圖片與音訊；PDF 與其他檔案不做。
 */
export function mediaKindOf(mediaType: string): MediaKind | undefined {
  const normalized = normalizeMediaType(mediaType);
  if (Object.hasOwn(IMAGE_TYPES, normalized)) return "image";
  if (Object.hasOwn(AUDIO_TYPES, normalized)) return "audio";
  return undefined;
}

/** 媒體類型對應的副檔名；不支援時回 undefined。 */
export function extensionOfMediaType(mediaType: string): string | undefined {
  const normalized = normalizeMediaType(mediaType);
  return IMAGE_TYPES[normalized] ?? AUDIO_TYPES[normalized];
}

/** `Content-Type` 可能帶參數；只取前面的媒體類型並轉小寫。 */
export function normalizeMediaType(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

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

/** 組合文字替身需要的素材；沒有的欄位代表那一塊沒有產生。 */
export interface TextStandInInput {
  readonly kind: MediaKind;
  readonly ocrText?: string;
  readonly description?: string;
  readonly transcript?: string;
  readonly summary?: string;
  /** 額外的缺少說明；例如本機辨識被拒絕。 */
  readonly missing?: readonly string[];
  /** 文字被截斷時要說清楚。 */
  readonly truncated?: boolean;
}

/**
 * 把各段素材排成卡片內文。
 *
 * 圖片依序是描述與 OCR；音訊依序是摘要與逐字稿。缺少的部分列在最後，
 * 搜尋仍然只會看到文字替身，不會碰到原檔。
 */
export function composeTextStandIn(input: TextStandInInput): TextStandIn {
  const missing = [...(input.missing ?? [])];
  const sections: string[] = [];
  const sources: TextStandInSource = {
    ocr: input.kind === "image" && hasText(input.ocrText) ? "local" : "none",
    description: input.kind === "image" && hasText(input.description) ? "small-model" : "none",
    transcript: input.kind === "audio" && hasText(input.transcript) ? "local" : "none",
    summary: input.kind === "audio" && hasText(input.summary) ? "small-model" : "none",
  };
  if (input.kind === "image") {
    sections.push("> 這是圖片的文字替身；原檔在 `assets/`，代理翻牌時才會載入。");
    if (hasText(input.description)) sections.push("## 描述", input.description.trim());
    if (hasText(input.ocrText)) sections.push("## OCR 文字", input.ocrText.trim());
    if (input.truncated === true) missing.push("OCR 文字過長，只保留前段。");
    if (sources.ocr === "none" && !missing.some((reason) => reason.includes("OCR"))) {
      missing.push("本機 OCR 沒有產生文字。");
    }
  } else {
    sections.push("> 這是音訊的文字替身；原檔在 `assets/`，代理翻牌時才會載入。");
    if (hasText(input.summary)) sections.push("## 摘要", input.summary.trim());
    if (hasText(input.transcript)) sections.push("## 逐字稿", input.transcript.trim());
    if (input.truncated === true) missing.push("逐字稿過長，只保留前段。");
    if (sources.transcript === "none" && !missing.some((reason) => reason.includes("逐字稿"))) {
      missing.push("本機語音轉文字沒有產生逐字稿。");
    }
  }
  if (missing.length > 0) {
    sections.push("## 缺少的部分", ...missing.map((reason) => `- ${reason}`));
  }
  const text = `${sections.join("\n\n")}\n`;
  return { kind: input.kind, text, sources, missing };
}

/** 沒有標題時，用文字替身的第一段或內容雜湊組一個可讀的標題。 */
export function defaultMediaTitle(input: {
  readonly kind: MediaKind;
  readonly blobId: string;
  readonly text: string;
}): string {
  const firstLine = input.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("-"))
    .find((line) => line.length > 0);
  const fallback = input.kind === "image" ? "圖片" : "音訊";
  const label = firstLine === undefined ? fallback : truncate(firstLine, 60);
  return `${label}（${input.blobId.slice(0, 8)}）`;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function truncate(text: string, max: number): string {
  return [...text].slice(0, max).join("");
}

/** 翻牌的結果；模型不支援時回文字替身與原因，不是錯誤。 */
export interface FlipResult {
  readonly loaded: boolean;
  readonly reason?: string;
  readonly mediaType: string;
  /** 原檔的內容雜湊；引擎用它在下一個請求載入原檔。 */
  readonly assetId?: string;
  readonly bytes?: Uint8Array;
  /** 模型不支援時要送回模型的文字替身；載入成功時可省略。 */
  readonly text?: string;
}
