/**
 * `module.memory.undo { notificationId, itemId }` 的逐項復原。
 *
 * 復原只動一項：刪除產出的記憶卡、回復原卡 `cold → live`、增刪核心組成員，
 * 或合併的無操作。核心組變動與每日計數在同一交易；一天已變動過就順延。
 * 復原後在 distillation_items 標 `undone`，續跑不得重建已刪除的卡。
 */

import type { CardService, DistillationSummaryItem } from "@cardiary/domain";
import {
  assertWellFormedItem,
  planUndoItem,
  type UndoPlan,
  type UndoStep,
} from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";

import { CardLifecycleStore, CoreMemoryStore, DistillationStore } from "@cardiary/storage";

export interface UndoOptions {
  readonly cards: CardService;
  readonly runs: DistillationStore;
  readonly core: CoreMemoryStore;
  readonly lifecycle: CardLifecycleStore;
  readonly notifications: {
    get(notificationId: string): { payloadJson: string } | null;
  };
  readonly now: () => Date;
}

export type UndoOutcome =
  | { readonly ok: true; readonly action: string; readonly deferred?: boolean }
  | { readonly ok: false; readonly reason: string };

/** 處理一項復原；回傳結果給協定層轉成 response。 */
export async function undoItem(
  options: UndoOptions,
  notificationId: string,
  itemId: string,
): Promise<UndoOutcome> {
  const notification = options.notifications.get(notificationId);
  if (notification === null) {
    return { ok: false, reason: "not-found" };
  }
  const item = findItem(notification.payloadJson, itemId);
  if (item === null) {
    return { ok: false, reason: "item-not-found" };
  }

  const day = options.now().toISOString().slice(0, 10);
  const daily = options.core.getDaily("default", day);
  const checked = assertWellFormedItem(item);
  const plan: UndoPlan = planUndoItem(checked, daily);
  if (plan.kind === "deferred") {
    return { ok: true, action: checked.action, deferred: true };
  }

  try {
    for (const step of plan.steps) {
      await applyStep(options, checked, step, day);
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  // 標記已復原：找出該 item 在 run 裡對應的列（通知 payload 帶 runId）。
  const payload = safeParseObject(notification.payloadJson) as { runId?: string };
  if (typeof payload.runId === "string") {
    markUndoneForItem(options.runs, payload.runId, checked);
  }
  return { ok: true, action: checked.action };
}

async function applyStep(
  options: UndoOptions,
  item: DistillationSummaryItem,
  step: UndoStep,
  day: string,
): Promise<void> {
  switch (step.type) {
    case "delete-card":
      await options.cards.delete(step.cardId);
      break;
    case "restore-sources-live":
    case "uncold":
      options.lifecycle.live(step.cardIds);
      break;
    case "core-remove":
      options.core.change({
        persona: "default",
        day,
        op: "remove",
        cardId: step.cardId,
      });
      break;
    case "core-add":
      options.core.change({
        persona: "default",
        day,
        op: "add",
        cardId: step.cardId,
        source: "user",
      });
      break;
    case "noop":
      break;
  }
  void item;
}

/** 在該 run 找出對應的 merge／core 單元並標已復原；找不到就略過（冪等）。 */
function markUndoneForItem(runs: DistillationStore, runId: string, item: DistillationSummaryItem): void {
  const prefix = item.id.startsWith("core_") ? "core" : "merge";
  for (const record of runs.listItems(runId)) {
    if (record.phase !== prefix) continue;
    const cardId = record.outputCardId;
    if (cardId === undefined || cardId === null) continue;
    if (item.action === "cold") continue;
    if (
      cardId === item.cardId ||
      cardId === item.mergedInto ||
      (item.supersedes !== undefined && cardId === item.supersedes)
    ) {
      runs.markUndone(runId, record.itemKey);
    }
  }
}

function findItem(payloadJson: string, itemId: string): DistillationSummaryItem | null {
  const payload = safeParseObject(payloadJson) as { items?: unknown };
  if (!Array.isArray(payload.items)) return null;
  for (const raw of payload.items) {
    if (raw === null || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    if (candidate.id === itemId) {
      try {
        return candidate as unknown as DistillationSummaryItem;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function safeParseObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 落入空物件。
  }
  return {};
}

/** 給協定層：把 UndoOutcome 映射到 data 形狀。 */
export function undoOutcomeToJson(outcome: UndoOutcome): JsonValue {
  if (outcome.ok) {
    return { ok: true, action: outcome.action, ...(outcome.deferred ? { deferred: true } : {}) } as JsonValue;
  }
  return { ok: false, reason: outcome.reason } as JsonValue;
}
