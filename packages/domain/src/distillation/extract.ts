/**
 * 提煉：注入的小模型介面、輸出驗證、正規化與內容雜湊。
 *
 * 設計文件 m2-distillation.md §2.2：每張歸零卡一次小模型呼叫；輸出
 * `{ "items": [ { "type": "fact"|"preference"|"decision", "text": "..." } ] }`。
 * 缺 `items`、`type` 不在三種、`text` 空或超過 500 字，整張卡視為提煉失敗。
 * 提煉結果先落地（由呼叫端寫入 `distillation_items`），中斷後不重提煉。
 *
 * 這一輪不接真的模型：`MemoryDistiller` 由呼叫端注入，測試用腳本化假件。
 */

import type { CardId, CardKind } from "../cards/index.js";
import { sha256Hex, stableStringify } from "../cards/index.js";

/** `text` 的字數上限（設計定 500 字，以 Unicode 碼點計）。 */
export const MEMORY_TEXT_MAX_LENGTH = 500;

/** 記憶項目的分類；與設計文件一致。 */
export const DISTILLATION_MEMORY_TYPES = ["fact", "preference", "decision"] as const;
export type DistillationMemoryType = (typeof DISTILLATION_MEMORY_TYPES)[number];

/** 一條從歸零卡提煉出的、值得長期保留的記憶。 */
export interface ExtractedMemoryItem {
  readonly type: DistillationMemoryType;
  /** 正規化前的原文字；自含，脫離原卡也讀得懂。 */
  readonly text: string;
}

/** 小模型的注入點；輸入是一張歸零卡的內容，輸出是未驗證的原始 JSON。 */
export interface MemoryDistiller {
  /**
   * 從一批歸零卡提煉項目。
   *
   * 回傳值視為不可信的模型輸出：經 {@link validateDistillationOutput} 驗證、
   * 正規化後才可使用。拋出的例外由呼叫端視為該批失敗。
   */
  distill(cards: readonly DistillationSourceCard[]): Promise<unknown>;
}

/** 交給小模型的來源卡；領域層只需要這些欄位。 */
export interface DistillationSourceCard {
  readonly cardId: CardId;
  readonly kind: CardKind;
  readonly title: string;
  readonly summary?: string | undefined;
  readonly body: string;
  readonly persona: string;
}

export type ExtractValidation =
  | { readonly ok: true; readonly items: readonly ExtractedMemoryItem[] }
  | { readonly ok: false; readonly reason: string };

/**
 * 把文字正規化成可比較、可雜湊的形式：NFC 正規化、連續空白壓成一個、
 * 去頭尾空白。不同內容的文字不會因此變成相同；純排版差異視為相同內容。
 */
export function normalizeMemoryText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * 驗證小模型輸出；整張卡一次判定。
 *
 * 任何一條項目不合格，整張卡視為提煉失敗（設計 §2.2），由呼叫端重試一次；
 * 仍失敗就讓該卡留在 `live`、不蒸餾，並在摘要通知標明。空的 `items` 是
 * 合法結果：代表沒有值得保留的內容，不算失敗。
 */
export function validateDistillationOutput(raw: unknown): ExtractValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "輸出不是 JSON 物件" };
  }
  const items = (raw as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    return { ok: false, reason: "缺少 items 陣列" };
  }
  const validated: ExtractedMemoryItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index] as unknown;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: `items[${index}] 不是物件` };
    }
    const { type, text } = entry as Record<string, unknown>;
    if (
      typeof type !== "string" ||
      !(DISTILLATION_MEMORY_TYPES as readonly string[]).includes(type)
    ) {
      return {
        ok: false,
        reason: `items[${index}].type 不在 fact|preference|decision`,
      };
    }
    if (typeof text !== "string") {
      return { ok: false, reason: `items[${index}].text 不是字串` };
    }
    const normalized = normalizeMemoryText(text);
    if (normalized.length === 0) {
      return { ok: false, reason: `items[${index}].text 是空白` };
    }
    if (countCodePoints(normalized) > MEMORY_TEXT_MAX_LENGTH) {
      return { ok: false, reason: `items[${index}].text 超過 ${MEMORY_TEXT_MAX_LENGTH} 字` };
    }
    validated.push({ type: type as DistillationMemoryType, text: normalized });
  }
  return { ok: true, items: validated };
}

/**
 * 內容雜湊：以正規化後的 `type` 與 `text` 計算 SHA-256。
 *
 * 這是續跑去重鍵與跨批次去重的內容部分；同一張來源卡可以提煉出多條
 * 記憶，每條各自雜湊。
 */
export function memoryContentHash(item: Pick<ExtractedMemoryItem, "type" | "text">): string {
  return sha256Hex(stableStringify({ type: item.type, text: normalizeMemoryText(item.text) }));
}

/** 記憶卡的標題上限（設計定 40 字，以 Unicode 碼點計）。 */
export const MEMORY_TITLE_MAX_LENGTH = 40;

/**
 * 決定新記憶卡的標題與一句話摘要。
 *
 * 小模型產生的標題（≤ 40 字）與摘要（一行）在這裡整理：去掉多餘空白、
 * 超出上限截斷、摘要壓成單行。模型沒給標題時退回記憶正文的前面一段，
 * 不讓蒸餾因為缺標題而失敗。
 */
export function memoryCardTitleAndSummary(
  model: { readonly title?: string | undefined; readonly summary?: string | undefined },
  text: string,
): { readonly title: string; readonly summary?: string } {
  const cleanedTitle = collapseWhitespace(model.title ?? "");
  const source = cleanedTitle.length > 0 ? cleanedTitle : collapseWhitespace(text);
  const title = takeCodePoints(source, MEMORY_TITLE_MAX_LENGTH);
  const rawSummary = typeof model.summary === "string" ? model.summary : "";
  const firstLine = rawSummary.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const summary = collapseWhitespace(firstLine);
  return summary.length > 0 ? { title, summary } : { title };
}

function collapseWhitespace(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function countCodePoints(text: string): number {
  return Array.from(text).length;
}

function takeCodePoints(text: string, limit: number): string {
  const points = Array.from(text);
  return points.slice(0, limit).join("");
}
