/**
 * 八層的固定順序與固定前綴的組裝。
 *
 * 第 1 到 6 層由主機以寫死的層順序合成一個固定前綴；層內依項目的
 * `position` 排序，不看模組的註冊順序。第 7 層是引擎的逐字稿，
 * 第 8 層是每次請求重算的尾端訊息，兩者都不在這裡組字串。
 */

/** 八層的識別碼，順序由前往後。 */
export type ContextLayer =
  | "bedrock"
  | "persona"
  | "core-memory"
  | "opening-memory"
  | "short-term-memory"
  | "other-cards"
  | "working-context"
  | "volatile-state";

/** 八層的固定順序；第 1 到 6 層是固定前綴，第 7 層是逐字稿，第 8 層是尾端。 */
export const CONTEXT_LAYERS: readonly ContextLayer[] = [
  "bedrock",
  "persona",
  "core-memory",
  "opening-memory",
  "short-term-memory",
  "other-cards",
  "working-context",
  "volatile-state",
];

/** 組成固定前綴的層；第 7、8 層不在裡面。 */
export const SYSTEM_LAYERS: readonly ContextLayer[] = CONTEXT_LAYERS.slice(0, 6);

/** 項目在上下文中的狀態。 */
export type ContextEntryState = "active" | "pending-removal";

const LAYER_INDEX = new Map<ContextLayer, number>(
  CONTEXT_LAYERS.map((layer, index) => [layer, index]),
);

/** 這一層在固定順序中的位置；未知的層回 -1。 */
export function layerIndex(layer: string): number {
  return LAYER_INDEX.get(layer as ContextLayer) ?? -1;
}

/** 這是不是固定前綴的層之一。 */
export function isSystemLayer(layer: string): boolean {
  return SYSTEM_LAYERS.includes(layer as ContextLayer);
}

/** 一個要被渲染進固定前綴的區段。 */
export interface SystemSection {
  readonly layer: ContextLayer;
  readonly title: string;
  readonly text: string;
}

/**
 * 把區段合成固定前綴。
 *
 * 輸出只由「層順序 + 同一層的輸入順序 + 每個區段的標題與內文」決定：
 * 同樣的輸入一定得到同樣的位元組，前一輪的前綴才會是下一輪的前綴。
 * 空格或換行不參與正規化；呼叫端要傳入已經整理好的文字。
 */
export function assembleSystemContext(sections: readonly SystemSection[]): string {
  const ordered = [...sections]
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const layerDelta = layerIndex(left.section.layer) - layerIndex(right.section.layer);
      return layerDelta !== 0 ? layerDelta : left.index - right.index;
    });
  const parts: string[] = [];
  for (const { section } of ordered) {
    if (!isSystemLayer(section.layer)) continue;
    if (section.text.length === 0) continue;
    parts.push(`## ${section.title}\n\n${section.text}`);
  }
  return parts.join("\n\n");
}

/**
 * 第 8 層的尾端文字。
 *
 * 用 `user` 角色的尾端訊息送出，每次請求重算、不寫逐字稿。時間用
 * RFC 3339（UTC）加 IANA 時區名稱，同一個時刻一定得到同一段位元組。
 */
export function volatileStateText(now: Date, timeZone: string): string {
  return `目前時間：${now.toISOString()}（${timeZone}）`;
}
