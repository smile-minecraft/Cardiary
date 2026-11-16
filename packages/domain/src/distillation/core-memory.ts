/**
 * 核心記憶組：token 預算與「一天最多變動一次」。
 *
 * 設計文件 m2-distillation.md §3 與規格書第 7 章：
 * - 成員存 `state/cardiary.sqlite`（v3 遷移由其他工作擁有），領域層只做規則；
 * - 預算預設 800 token，可調 400–1,500；以「標題＋摘要＋內文」估算；
 * - 一天最多變動一次，以人格＋日期鍵計算，與蒸餾、手動增刪、復原共用計數；
 * - 順序固定為 `added_day, card_id` 升冪（決定性），不佔發牌預算；
 * - 預算不足時蒸餾「提議」換出最近最少用的核心卡，不自動換出。
 *
 * 日期鍵以 UTC 日期為準；呼叫端傳入 RFC 3339 的時間，測試注入固定時間。
 */

import type { CardId } from "../cards/index.js";
import { estimateTokens } from "../context/estimate.js";

/** 核心組預算預設值。 */
export const CORE_TOKEN_BUDGET_DEFAULT = 800;
export const CORE_TOKEN_BUDGET_MIN = 400;
export const CORE_TOKEN_BUDGET_MAX = 1500;

/** 夾到 400–1,500；`NaN` 或無窮回預設 800。 */
export function clampCoreTokenBudget(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return CORE_TOKEN_BUDGET_DEFAULT;
  }
  return Math.min(CORE_TOKEN_BUDGET_MAX, Math.max(CORE_TOKEN_BUDGET_MIN, Math.round(value)));
}

/** 日期鍵（UTC，`YYYY-MM-DD`）；格式不合法回 `null`。 */
export function coreDayKey(fromRfc3339: string): string | null {
  const ms = Date.parse(fromRfc3339);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/** 一張要進（或已在）核心組的卡片的估算用內容。 */
export interface CoreCardTokens {
  readonly title: string;
  readonly summary?: string | undefined;
  readonly body?: string | undefined;
}

/** 估算核心組總 token：標題＋摘要＋內文（內文可缺省）。 */
export function estimateCoreMemoryTokens(
  cards: readonly CoreCardTokens[],
  estimator: (text: string) => number = estimateTokens,
): number {
  let total = 0;
  for (const card of cards) {
    total += estimator(card.title);
    if (card.summary !== undefined) total += estimator(card.summary);
    if (card.body !== undefined) total += estimator(card.body);
  }
  return total;
}

/** 核心組成員；與 v3 `core_memory` 表的欄位一一對應。 */
export interface CoreMemoryEntry {
  readonly persona: string;
  readonly cardId: CardId;
  /** 加入當天的日期鍵。升冪排序在這個欄位再比 `cardId`。 */
  readonly addedDay: string;
  readonly source: "distillation" | "import" | "user";
}

/** 人格＋日期鍵的「一天最多變動一次」計數；與 v3 `core_memory_daily` 對應。 */
export interface CoreMemoryDaily {
  readonly persona: string;
  /** 日期鍵，見 {@link coreDayKey}。 */
  readonly day: string;
  readonly changed: boolean;
}

/** 固定順序：`added_day` 升冪，再 `card_id` 升冪；不改寫輸入。 */
export function sortCoreMemory(entries: readonly CoreMemoryEntry[]): CoreMemoryEntry[] {
  return [...entries].sort((left, right) => {
    const dayDelta = left.addedDay < right.addedDay ? -1 : left.addedDay > right.addedDay ? 1 : 0;
    if (dayDelta !== 0) return dayDelta;
    return left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0;
  });
}

/** 當日變動計數；沒有 `changed: true` 就還能變。 */
export function coreChangeAllowed(daily: CoreMemoryDaily | null | undefined): boolean {
  return daily?.changed !== true;
}

/** 核心組變動的請求；`tokens` 是這張卡佔用的估算值（移除時可省略）。 */
export type CoreChangeRequest =
  | { readonly kind: "add"; readonly cardId: CardId; readonly tokens: number }
  | { readonly kind: "remove"; readonly cardId: CardId; readonly tokens?: number | undefined };

export type CoreChangeDecision =
  /** 可以執行；`projectedTokens` 是變更後的估算總量。 */
  | { readonly kind: "apply"; readonly projectedTokens: number }
  /** 今天已變動過：順延到明天。 */
  | { readonly kind: "defer"; readonly reason: "daily-limit" }
  /** 加入會超過預算：不變更；呼叫端可向使用者提議換出最近最少用的卡。 */
  | { readonly kind: "refuse"; readonly reason: "budget"; readonly projectedTokens: number };

/**
 * 決定一次核心組變動能不能生效。
 *
 * 同一個人在同一天只能變動一次：`daily.changed` 為真一律順延（蒸餾、
 * 手動與復原共用這個判定）。加入時以加入後的估算總量對照預算，超過就
 * 拒絕；蒸餾不自動換出既有成員。移除永遠不會爆預算。
 */
export function planCoreChange(input: {
  readonly entries: readonly CoreMemoryEntry[];
  readonly currentTokens: number;
  readonly budget: number;
  readonly daily: CoreMemoryDaily | null | undefined;
  readonly request: CoreChangeRequest;
}): CoreChangeDecision {
  if (!coreChangeAllowed(input.daily)) {
    return { kind: "defer", reason: "daily-limit" };
  }
  const budget = clampCoreTokenBudget(input.budget);
  if (input.request.kind === "remove") {
    return {
      kind: "apply",
      projectedTokens: Math.max(0, input.currentTokens - Math.max(0, input.request.tokens ?? 0)),
    };
  }
  const alreadyIn = input.entries.some((entry) => entry.cardId === input.request.cardId);
  if (alreadyIn) {
    // 已在組內：重複加入不增加預算；冪等由呼叫端（資料庫主鍵）決定。
    return { kind: "apply", projectedTokens: Math.max(0, input.currentTokens) };
  }
  const projectedTokens = input.currentTokens + Math.max(0, input.request.tokens);
  return projectedTokens <= budget
    ? { kind: "apply", projectedTokens }
    : { kind: "refuse", reason: "budget", projectedTokens };
}
