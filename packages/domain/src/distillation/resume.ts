/**
 * 中斷續跑：批次 id、來源卡 id 與內容雜湊組成的去重鍵，以及寫檔前中斷時
 * 的決定。
 *
 * 設計文件 m2-distillation.md §4 的續跑規則：
 * - 同批次：以 `(batch_id, source_card_id, content_hash)` 找意圖；已 `done`
 *   的單元跳過，不重跑模型、也不重寫卡片；
 * - 跨批次：同一人格分區查找相同 `content_hash` 的已完成產物；命中時記錄
 *   合併，不新建卡；
 * - 寫卡前先落地意圖（固定輸出卡 id）；重啟先檢查該 id 與雜湊：檔案存在且
 *   相符就補記完成，不存在就寫入，不相符則停止該項並通知、不覆寫；
 * - 使用者復原產出後留下已復原紀錄；續跑不得重建已刪除的卡；
 * - 單一來源卡可以產生多條記憶，每條各自以雜湊辨識，不用來源集合當鍵。
 */

import type { CardId } from "../cards/index.js";

/** `distillation_items.item_key` 的慣用格式。 */
export function extractItemKey(sourceCardId: CardId): string {
  return `${sourceCardId}:extract`;
}

/** 第 `index` 條提煉項目對應的合併／取代單元。 */
export function mergeItemKey(sourceCardId: CardId, index: number): string {
  return `${sourceCardId}:merge:${index}`;
}

export type ResumePhase = "extract" | "merge" | "archive" | "core" | "notify";

export type ResumeItemStatus = "pending" | "done" | "failed";

/**
 * 一筆持久保存的蒸餾單元；主機把 `distillation_items` 的列映成這個形狀。
 * `batchId` 首次建立後不變；`undone` 標記使用者已復原這一項的產物。
 */
export interface DistillationItemRecord {
  readonly runId: string;
  /** 批次 id；同一次執行的所有單元共用。 */
  readonly batchId: string;
  readonly persona: string;
  /** 產出項目的來源卡；提煉單元就是被提煉的原卡。 */
  readonly sourceCardId: CardId;
  /** 正規化後內容的 SHA-256；`extract` 單元可能沒有（尚未提煉）。 */
  readonly contentHash?: string | undefined;
  /** 事先分配的輸出卡 id；只有會產出卡片的單元才有。 */
  readonly outputCardId?: CardId | undefined;
  readonly itemKey: string;
  readonly phase: ResumePhase;
  readonly status: ResumeItemStatus;
  /** 使用者已復原這一項的產出；復原後不重建。 */
  readonly undone?: boolean | undefined;
}

/** 續跑去重鍵：批次 id＋來源卡 id＋內容雜湊。 */
export function buildResumeKey(batchId: string, sourceCardId: CardId, contentHash: string): string {
  return `${batchId}:${sourceCardId}:${contentHash}`;
}

/**
 * 同批次續跑：找出這個批次裡已完成或已失敗的同一個單元。
 *
 * 已 `done` 的單元直接跳過；已 `failed` 的單元當日不重跑（原卡留 `live`，
 * 隔日蒸餾再撿）。
 */
export function findBatchUnit(
  records: readonly DistillationItemRecord[],
  query: { readonly batchId: string; readonly itemKey: string },
): DistillationItemRecord | undefined {
  return records.find(
    (record) => record.batchId === query.batchId && record.itemKey === query.itemKey,
  );
}

/**
 * 一張提煉項目的處理結論先不存在時，單元是不是已經完成、不必再動。
 */
export function shouldSkipUnit(
  records: readonly DistillationItemRecord[],
  query: { readonly batchId: string; readonly itemKey: string },
): boolean {
  const unit = findBatchUnit(records, query);
  return unit !== undefined && (unit.status === "done" || unit.undone === true);
}

/**
 * 跨批次去重：同一人格分區查找相同內容雜湊的已完成、有產出、
 * 尚未復原的單元。命中時呼叫端記錄「合併」而不新建卡。
 *
 * 不引用已復原（`undone`）或失敗的產物；同一批次的單元不在此查找
 * （同批次由 {@link findBatchUnit} 與意圖續跑處理）。多個命中時取
 * `outputCardId` 字典序最小者，保證決定性（ULID 前綴是毫秒時間，
 * 字典序單調）。
 */
export function findCrossBatchMatch(
  records: readonly DistillationItemRecord[],
  query: {
    readonly persona: string;
    readonly contentHash: string;
    readonly excludeBatchId?: string;
  },
): DistillationItemRecord | undefined {
  const hits = records
    .filter(
      (record) =>
        record.persona === query.persona &&
        record.contentHash === query.contentHash &&
        record.status === "done" &&
        record.outputCardId !== undefined &&
        record.undone !== true &&
        record.batchId !== query.excludeBatchId,
    )
    .sort((left, right) =>
      (left.outputCardId ?? "") < (right.outputCardId ?? "")
        ? -1
        : (left.outputCardId ?? "") > (right.outputCardId ?? "")
          ? 1
          : 0,
    );
  return hits[0];
}

/** 斷點統計用的索引；`planResume` 給主機與測試查。 */
export interface ResumePlan {
  /** 已完成的單元。 */
  readonly done: readonly DistillationItemRecord[];
  /** 已失敗的單元（當日放棄，隔日蒸餾再撿）。 */
  readonly failed: readonly DistillationItemRecord[];
  /** 已被使用者復原的產出卡 id；續跑不得重建。 */
  readonly undoneOutputs: ReadonlySet<CardId>;
}

export function planResume(records: readonly DistillationItemRecord[]): ResumePlan {
  const done = records.filter((record) => record.status === "done");
  const failed = records.filter((record) => record.status === "failed");
  const undoneOutputs = new Set<CardId>();
  for (const record of records) {
    if (record.undone === true && record.outputCardId !== undefined) {
      undoneOutputs.add(record.outputCardId);
    }
  }
  return { done, failed, undoneOutputs };
}

export type ResumeIntentDecision =
  /** 已完成或已被復原：跳過，不重寫卡片。 */
  | { readonly kind: "skip"; readonly reason: "done" | "undone" }
  /** 沒有檔案或意圖不存在：寫入預定卡 id 的卡片檔。 */
  | { readonly kind: "write" }
  /** 檔案存在且內容雜湊一致：補記完成，不重寫卡片。 */
  | { readonly kind: "adopt" }
  /** 檔案存在但雜湊不一致：停止該項、通知使用者，不覆寫。 */
  | { readonly kind: "abort-conflict" };

/**
 * 寫卡前後中斷時，固定輸出卡 id 的意圖要怎麼處理。
 *
 * 呼叫端先查該 id 的卡片檔，把結果填入 `existingFile`：
 * - 檔案不存在（或從未落地過意圖）：寫入；
 * - 檔案存在、雜湊與意圖相同：中斷點在「寫完檔、還沒標記完成」，
 *   直接補記完成；
 * - 檔案存在、雜湊不同：內容被外部改過，停止並通知，絕不覆寫。
 */
export function resumeIntentDecision(input: {
  /** 該單元已 `done` 或有已復原紀錄。 */
  readonly done: boolean;
  readonly undone: boolean;
  /** 意圖裡預先分配的固定輸出卡 id 對應的現存檔案；不存在就省略。 */
  readonly existingFile?: { readonly contentHash: string } | undefined | null;
  readonly contentHash: string;
}): ResumeIntentDecision {
  if (input.undone) {
    return { kind: "skip", reason: "undone" };
  }
  if (input.done) {
    return { kind: "skip", reason: "done" };
  }
  if (input.existingFile === null || input.existingFile === undefined) {
    return { kind: "write" };
  }
  return input.existingFile.contentHash === input.contentHash
    ? { kind: "adopt" }
    : { kind: "abort-conflict" };
}
