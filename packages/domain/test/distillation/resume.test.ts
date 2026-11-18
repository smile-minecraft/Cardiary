import { describe, expect, it } from "vitest";

import {
  buildResumeKey,
  extractItemKey,
  findBatchUnit,
  findCrossBatchMatch,
  mergeItemKey,
  planResume,
  resumeIntentDecision,
  shouldSkipUnit,
  type DistillationItemRecord,
} from "../../src/distillation/index.js";

function record(overrides: Partial<DistillationItemRecord> = {}): DistillationItemRecord {
  return {
    runId: "run_1",
    batchId: "dst_batch_1",
    persona: "default",
    sourceCardId: "01SRC",
    itemKey: "01SRC:merge:0",
    phase: "merge",
    status: "done",
    ...overrides,
  };
}

describe("續跑去重鍵", () => {
  it("鍵 = 批次 id＋來源卡 id＋內容雜湊，一來源卡多條記憶各自帶雜湊", () => {
    const hashA = "hash-a";
    const hashB = "hash-b";
    expect(buildResumeKey("dst_1", "01SRC", hashA)).toBe("dst_1:01SRC:hash-a");
    expect(buildResumeKey("dst_1", "01SRC", hashA)).not.toBe(
      buildResumeKey("dst_1", "01SRC", hashB),
    );
    // 同一張來源卡的兩條記憶 → 相同 (batch, source)、不同內容雜湊，不被當成重複。
    expect(mergeItemKey("01SRC", 0)).toBe("01SRC:merge:0");
    expect(mergeItemKey("01SRC", 1)).toBe("01SRC:merge:1");
    expect(mergeItemKey("01SRC", 0)).not.toBe(mergeItemKey("01SRC", 1));
    expect(extractItemKey("01SRC")).toBe("01SRC:extract");
  });

  it("同批次往前查：已完成的單元不重跑", () => {
    const records = [
      record({ itemKey: "01SRC:merge:0", status: "done" }),
      record({ itemKey: "01SRC:merge:1", status: "pending" }),
    ];
    expect(shouldSkipUnit(records, { batchId: "dst_batch_1", itemKey: "01SRC:merge:0" })).toBe(
      true,
    );
    expect(shouldSkipUnit(records, { batchId: "dst_batch_1", itemKey: "01SRC:merge:1" })).toBe(
      false,
    );
    // 其他批次不受同一 itemKey 影響。
    expect(shouldSkipUnit(records, { batchId: "dst_batch_2", itemKey: "01SRC:merge:0" })).toBe(
      false,
    );
    expect(
      findBatchUnit(records, { batchId: "dst_batch_1", itemKey: "01SRC:merge:0" })?.status,
    ).toBe("done");
  });

  it("同批續跑：相同的內容意圖寫兩次也只有一張卡的結果", () => {
    const first = resumeIntentDecision({
      done: false,
      undone: false,
      existingFile: undefined,
      contentHash: "hash-a",
    });
    expect(first).toEqual({ kind: "write" });
    // 第一次中斷點在「寫完檔、還沒標記完成」：第二次看到同一份檔就補記完成。
    const second = resumeIntentDecision({
      done: false,
      undone: false,
      existingFile: { contentHash: "hash-a" },
      contentHash: "hash-a",
    });
    expect(second).toEqual({ kind: "adopt" });
  });

  it("寫檔前中斷：沒有檔案就寫入", () => {
    expect(
      resumeIntentDecision({ done: false, undone: false, existingFile: null, contentHash: "h" }),
    ).toEqual({ kind: "write" });
  });

  it("寫檔後中斷但內容被外部改過：停止該項、不覆寫", () => {
    expect(
      resumeIntentDecision({
        done: false,
        undone: false,
        existingFile: { contentHash: "tampered" },
        contentHash: "hash-a",
      }),
    ).toEqual({ kind: "abort-conflict" });
  });

  it("單元完成後續跑跳過；復原後續跑也跳過（不重建）", () => {
    expect(
      resumeIntentDecision({
        done: true,
        undone: false,
        existingFile: undefined,
        contentHash: "h",
      }),
    ).toEqual({ kind: "skip", reason: "done" });
    expect(
      resumeIntentDecision({
        done: false,
        undone: true,
        existingFile: undefined,
        contentHash: "h",
      }),
    ).toEqual({ kind: "skip", reason: "undone" });
  });
});

describe("同批次續跑（內容雜湊）", () => {
  const query = { batchId: "dst_batch_1", itemKey: "01SRC:merge:0", sourceCardId: "01SRC" };

  it("同 itemKey 但內容雜湊改變：不跳過，視為新單元", () => {
    const records = [record({ itemKey: "01SRC:merge:0", status: "done", contentHash: "hash-a" })];
    expect(shouldSkipUnit(records, { ...query, contentHash: "hash-a" })).toBe(true);
    expect(shouldSkipUnit(records, { ...query, contentHash: "hash-b" })).toBe(false);
    expect(findBatchUnit(records, { ...query, contentHash: "hash-b" })).toBeUndefined();
    expect(findBatchUnit(records, { ...query, contentHash: "hash-a" })?.status).toBe("done");
  });

  it("failed 的單元當日不重跑；extract（無雜湊）以 itemKey 比對", () => {
    const failed = [record({ itemKey: "01SRC:merge:0", status: "failed", contentHash: "hash-a" })];
    expect(shouldSkipUnit(failed, { ...query, contentHash: "hash-a" })).toBe(true);
    const extract = [record({ itemKey: "01SRC:extract", phase: "extract", status: "failed" })];
    expect(
      shouldSkipUnit(extract, {
        batchId: "dst_batch_1",
        itemKey: "01SRC:extract",
        sourceCardId: "01SRC",
      }),
    ).toBe(true);
  });
});

describe("跨批次去重", () => {
  it("不同批次、相同內容雜湊：命中先前完成且未復原的產出", () => {
    const records = [
      record({
        batchId: "dst_batch_1",
        contentHash: "hash-a",
        outputCardId: "01OUT",
      }),
    ];
    const hit = findCrossBatchMatch(records, {
      persona: "default",
      contentHash: "hash-a",
      excludeBatchId: "dst_batch_2",
    });
    expect(hit?.outputCardId).toBe("01OUT");
  });

  it("不同內容不誤合併：雜湊不同就不命中", () => {
    const records = [record({ contentHash: "hash-a", outputCardId: "01OUT" })];
    expect(
      findCrossBatchMatch(records, {
        persona: "default",
        contentHash: "hash-b",
        excludeBatchId: "dst_batch_2",
      }),
    ).toBeUndefined();
  });

  it("相同批次內的單元另循續跑規則處理，不走跨批次比對", () => {
    const records = [
      record({ batchId: "dst_batch_1", contentHash: "hash-a", outputCardId: "01OUT" }),
    ];
    expect(
      findCrossBatchMatch(records, {
        persona: "default",
        contentHash: "hash-a",
        excludeBatchId: "dst_batch_1",
      }),
    ).toBeUndefined();
  });

  it("復原過的產出不再被跨批次引用（復原後不重建、不誤合併回復原卡）", () => {
    const records = [
      record({
        batchId: "dst_batch_1",
        contentHash: "hash-a",
        outputCardId: "01OUT",
        undone: true,
      }),
    ];
    expect(
      findCrossBatchMatch(records, {
        persona: "default",
        contentHash: "hash-a",
        excludeBatchId: "dst_batch_2",
      }),
    ).toBeUndefined();
    // planResume 彙整已復原的產出卡 id，供主機防止重建。
    expect(planResume(records).undoneOutputs.has("01OUT")).toBe(true);
  });

  it("共用人格分區才去重；多個命中取 cardId 最小者，保證決定性", () => {
    const records = [
      record({ batchId: "dst_1", persona: "default", contentHash: "h", outputCardId: "01B" }),
      record({ batchId: "dst_2", persona: "default", contentHash: "h", outputCardId: "01A" }),
      record({ batchId: "dst_3", persona: "work", contentHash: "h", outputCardId: "00Z" }),
      record({
        batchId: "dst_4",
        persona: "default",
        contentHash: "h",
        outputCardId: "01C",
        status: "failed",
      }),
    ];
    const hit = findCrossBatchMatch(records, {
      persona: "default",
      contentHash: "h",
    });
    expect(hit?.outputCardId).toBe("01A");
    expect(hit?.persona).toBe("default");
  });

  it("輸出卡已被取代：不得跨批次合併", () => {
    const records = [
      record({
        batchId: "dst_batch_1",
        contentHash: "hash-a",
        outputCardId: "01OUT",
        outputCardSuperseded: true,
      }),
    ];
    expect(
      findCrossBatchMatch(records, {
        persona: "default",
        contentHash: "hash-a",
        excludeBatchId: "dst_batch_2",
      }),
    ).toBeUndefined();
  });

  it("輸出卡已刪除：不得跨批次合併", () => {
    const records = [
      record({
        batchId: "dst_batch_1",
        contentHash: "hash-a",
        outputCardId: "01OUT",
        outputCardDeleted: true,
      }),
    ];
    expect(
      findCrossBatchMatch(records, {
        persona: "default",
        contentHash: "hash-a",
        excludeBatchId: "dst_batch_2",
      }),
    ).toBeUndefined();
  });

  it("planResume 分列 done 與 failed", () => {
    const records = [
      record({ itemKey: "a", status: "done" }),
      record({ itemKey: "b", status: "failed" }),
      record({ itemKey: "c", status: "pending" }),
    ];
    const plan = planResume(records);
    expect(plan.done.map((entry) => entry.itemKey)).toEqual(["a"]);
    expect(plan.failed.map((entry) => entry.itemKey)).toEqual(["b"]);
  });
});
