/**
 * 每日摘要通知的逐項復原：資料形狀與復原計畫。
 *
 * 設計文件 m2-distillation.md §2.6、§2.7：摘要通知的每一項列出
 * `action` 與 `recovery`，復原只動這一項。各動作的復原語義是設計定死的：
 * - `created`／`superseded`：刪除該次產出的記憶卡（走一般刪卡流程），
 *   其 `sources` 原卡 `cold → live`；取代關係隨新卡刪除失效，舊卡本身未被動過；
 * - `merged`：無操作（合併沒有改變任何卡）；
 * - `cold`：列出的歸零卡 `cold → live`；
 * - `core-added`：從核心組移除該卡；`core-removed`：加回（檢查預算）；
 *   核心組變更計入人格＋日期鍵的一天一次計數，今天已變動過就順延。
 *
 * 復原只新增或標記，不改寫別處的內容；卡片檔的刪除由使用者端點以
 * 「使用者刪除」處理（含 FTS／向量列清除），不在領域層。
 */

import type { CardId } from "../cards/index.js";

/** 每日摘要通知的六種動作。 */
export type DistillationSummaryAction =
  "created" | "superseded" | "merged" | "cold" | "core-added" | "core-removed";

/** 復原種類；與設計 §2.7 的對應一致。 */
export type DistillationRecoveryKind =
  "delete-card" | "uncold" | "core-remove" | "core-add" | "none";

/** 摘要裡的一項變更；`id` 是通知項目的 id（`itm_…`）。 */
export interface DistillationSummaryItem {
  readonly id: string;
  readonly action: DistillationSummaryAction;
  /** `created`／`superseded`／`core-added`／`core-removed`：被建立或異動的卡。 */
  readonly cardId?: CardId;
  /** `created`／`superseded`／`merged`：血緣指回的歸零卡。 */
  readonly sources?: readonly CardId[];
  /** `superseded`：新卡宣告蓋過的舊卡。 */
  readonly supersedes?: CardId;
  /** `merged`：被合併進去的既有記憶卡。 */
  readonly mergedInto?: CardId;
  /** `cold`：轉入冷封存的歸零卡。 */
  readonly cardIds?: readonly CardId[];
  readonly recovery: DistillationRecoveryKind;
}

/** 動作對應的復原種類；通知組裝時照這個表填 `recovery`。 */
export const RECOVERY_KIND_BY_ACTION: Readonly<
  Record<DistillationSummaryAction, DistillationRecoveryKind>
> = {
  created: "delete-card",
  superseded: "delete-card",
  merged: "none",
  cold: "uncold",
  "core-added": "core-remove",
  "core-removed": "core-add",
};

export function recoveryKindFor(action: DistillationSummaryAction): DistillationRecoveryKind {
  return RECOVERY_KIND_BY_ACTION[action];
}

/** 任一動作的必要欄位缺了就不成立；呼叫端組裝通知前先用這個驗證。 */
export function assertWellFormedItem(item: DistillationSummaryItem): DistillationSummaryItem {
  const need = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(`摘要項目 ${item.id}（${item.action}）缺少${message}`);
  };
  switch (item.action) {
    case "created":
      need(typeof item.cardId === "string" && item.cardId.length > 0, " cardId");
      need(Array.isArray(item.sources) && item.sources.length > 0, " sources");
      break;
    case "superseded":
      need(typeof item.cardId === "string" && item.cardId.length > 0, " cardId");
      need(typeof item.supersedes === "string" && item.supersedes.length > 0, " supersedes");
      need(Array.isArray(item.sources) && item.sources.length > 0, " sources");
      break;
    case "merged":
      need(typeof item.mergedInto === "string" && item.mergedInto.length > 0, " mergedInto");
      need(Array.isArray(item.sources) && item.sources.length > 0, " sources");
      break;
    case "cold":
      need(Array.isArray(item.cardIds) && item.cardIds.length > 0, " cardIds");
      break;
    case "core-added":
    case "core-removed":
      need(typeof item.cardId === "string" && item.cardId.length > 0, " cardId");
      break;
  }
  const expected = recoveryKindFor(item.action);
  need(item.recovery === expected, ` recovery=${expected}`);
  return item;
}

/** 每日摘要通知的 `payload`（版本固定 1）。 */
export interface DistillationSummary {
  readonly version: 1;
  /** 蒸餾執行的日期鍵。 */
  readonly day: string;
  /** 批次（run）id。 */
  readonly runId: string;
  readonly items: readonly DistillationSummaryItem[];
}

/**
 * 驗證並組合每日摘要。項目全部沿用原順序；任何一項結構不完整就拋錯，
 * 不讓壞通知出現在使用者眼前。
 */
export function buildDistillationSummary(input: {
  readonly day: string;
  readonly runId: string;
  readonly items: readonly DistillationSummaryItem[];
}): DistillationSummary {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) {
    throw new Error(`day 要是 YYYY-MM-DD，收到：${input.day}`);
  }
  if (input.runId.trim().length === 0) {
    throw new Error("runId 不可為空");
  }
  return {
    version: 1,
    day: input.day,
    runId: input.runId,
    items: input.items.map(assertWellFormedItem),
  };
}

/** 復原計畫的一步；每步可單獨執行，對應一個副作用。 */
export type UndoStep =
  /** 刪除該次產出的記憶卡；走刪卡流程，取代關係隨新卡消失。 */
  | { readonly type: "delete-card"; readonly cardId: CardId }
  /** 把列出的歸零卡 `cold → live`。 */
  | { readonly type: "uncold"; readonly cardIds: readonly CardId[] }
  /** 把該次產出的 `sources` 歸零卡 `cold → live`。 */
  | { readonly type: "restore-sources-live"; readonly cardIds: readonly CardId[] }
  /** 從核心組移除該卡。 */
  | { readonly type: "core-remove"; readonly cardId: CardId }
  /** 把該卡加回核心組（呼叫端需先檢查預算）。 */
  | { readonly type: "core-add"; readonly cardId: CardId }
  /** 合併不改動任何卡，無可復原的副作用。 */
  | { readonly type: "noop"; readonly reason: "merged" };

export type UndoPlan =
  | { readonly kind: "steps"; readonly steps: readonly UndoStep[] }
  /** 今天核心組已變動過；這一項順延到隔天。 */
  | { readonly kind: "deferred"; readonly reason: "daily-limit" };

/**
 * 為摘要的一項變更產生復原計畫；核心組項計入當天的一天一次計數。
 */
export function planUndoItem(
  item: DistillationSummaryItem,
  coreDaily: { readonly changed: boolean } | null | undefined,
): UndoPlan {
  const checked = assertWellFormedItem(item);
  switch (checked.action) {
    case "created":
    case "superseded":
      return {
        kind: "steps",
        steps: [
          { type: "delete-card", cardId: checked.cardId as CardId },
          { type: "restore-sources-live", cardIds: checked.sources ?? [] },
        ],
      };
    case "merged":
      return { kind: "steps", steps: [{ type: "noop", reason: "merged" }] };
    case "cold":
      return { kind: "steps", steps: [{ type: "uncold", cardIds: checked.cardIds ?? [] }] };
    case "core-added":
      return coreDaily?.changed === true
        ? { kind: "deferred", reason: "daily-limit" }
        : { kind: "steps", steps: [{ type: "core-remove", cardId: checked.cardId as CardId }] };
    case "core-removed":
      return coreDaily?.changed === true
        ? { kind: "deferred", reason: "daily-limit" }
        : { kind: "steps", steps: [{ type: "core-add", cardId: checked.cardId as CardId }] };
  }
}
