import { describe, expect, it } from "vitest";

import {
  buildDistillationSummary,
  planUndoItem,
  recoveryKindFor,
  type DistillationSummaryItem,
} from "../../src/distillation/index.js";

const untouched = { changed: false };
const alreadyChanged = { changed: true };

describe("動作與復原種類對應", () => {
  it("created/superseded → delete-card、merged → none、cold → uncold、core → 對應加移", () => {
    expect(recoveryKindFor("created")).toBe("delete-card");
    expect(recoveryKindFor("superseded")).toBe("delete-card");
    expect(recoveryKindFor("merged")).toBe("none");
    expect(recoveryKindFor("cold")).toBe("uncold");
    expect(recoveryKindFor("core-added")).toBe("core-remove");
    expect(recoveryKindFor("core-removed")).toBe("core-add");
  });
});

describe("復原計畫", () => {
  it("created：刪除新卡，歸零卡 sources 轉回 live", () => {
    const plan = planUndoItem(
      {
        id: "itm_1",
        action: "created",
        cardId: "01NEW",
        sources: ["01A", "01B"],
        recovery: "delete-card",
      },
      untouched,
    );
    expect(plan).toEqual({
      kind: "steps",
      steps: [
        { type: "delete-card", cardId: "01NEW" },
        { type: "restore-sources-live", cardIds: ["01A", "01B"] },
      ],
    });
  });

  it("superseded：刪除新卡讓取代關係失效，舊卡不改寫", () => {
    const plan = planUndoItem(
      {
        id: "itm_2",
        action: "superseded",
        cardId: "01NEW",
        supersedes: "01OLD",
        sources: ["01A"],
        recovery: "delete-card",
      },
      untouched,
    );
    expect(plan).toEqual({
      kind: "steps",
      steps: [
        { type: "delete-card", cardId: "01NEW" },
        { type: "restore-sources-live", cardIds: ["01A"] },
      ],
    });
  });

  it("merged：無操作", () => {
    const plan = planUndoItem(
      { id: "itm_3", action: "merged", mergedInto: "01OLD", sources: ["01A"], recovery: "none" },
      untouched,
    );
    expect(plan).toEqual({ kind: "steps", steps: [{ type: "noop", reason: "merged" }] });
  });

  it("cold：把全部列出的歸零卡轉回 live", () => {
    const plan = planUndoItem(
      { id: "itm_4", action: "cold", cardIds: ["01A", "01B"], recovery: "uncold" },
      untouched,
    );
    expect(plan).toEqual({
      kind: "steps",
      steps: [{ type: "uncold", cardIds: ["01A", "01B"] }],
    });
  });

  it("core-added：今天未變動就從核心組移除；今天已變動則順延", () => {
    const item: DistillationSummaryItem = {
      id: "itm_5",
      action: "core-added",
      cardId: "01NEW",
      recovery: "core-remove",
    };
    expect(planUndoItem(item, untouched)).toEqual({
      kind: "steps",
      steps: [{ type: "core-remove", cardId: "01NEW" }],
    });
    expect(planUndoItem(item, alreadyChanged)).toEqual({
      kind: "deferred",
      reason: "daily-limit",
    });
  });

  it("core-removed：今天未變動就加回（預算檢查由呼叫端在執行時做）；今天已變動則順延", () => {
    const item: DistillationSummaryItem = {
      id: "itm_6",
      action: "core-removed",
      cardId: "01OLD",
      recovery: "core-add",
    };
    expect(planUndoItem(item, untouched)).toEqual({
      kind: "steps",
      steps: [{ type: "core-add", cardId: "01OLD" }],
    });
    expect(planUndoItem(item, alreadyChanged)).toEqual({
      kind: "deferred",
      reason: "daily-limit",
    });
  });

  it("結構不完整的項目拒絕復原：缺 supersedes 或 recovery 不符就拋錯", () => {
    expect(() =>
      planUndoItem(
        {
          id: "x",
          action: "superseded",
          cardId: "01NEW",
          sources: ["01A"],
          recovery: "delete-card",
        },
        untouched,
      ),
    ).toThrow();
    expect(() =>
      planUndoItem(
        { id: "x", action: "created", cardId: "01NEW", sources: ["01A"], recovery: "uncold" },
        untouched,
      ),
    ).toThrow();
  });
});

describe("每日摘要通知", () => {
  const items: DistillationSummaryItem[] = [
    { id: "itm_1", action: "created", cardId: "01NEW", sources: ["01A"], recovery: "delete-card" },
    { id: "itm_2", action: "merged", mergedInto: "01OLD", sources: ["01B"], recovery: "none" },
  ];

  it("組出 version=1 的 payload，保留項目順序", () => {
    const summary = buildDistillationSummary({ day: "2026-11-16", runId: "dst_run_1", items });
    expect(summary.version).toBe(1);
    expect(summary.items.map((item) => item.id)).toEqual(["itm_1", "itm_2"]);
  });

  it("日期格式與 runId 不合法就拋錯；項目結構不完整也拋錯", () => {
    expect(() =>
      buildDistillationSummary({ day: "2026/11/16", runId: "dst_run_1", items }),
    ).toThrow();
    expect(() => buildDistillationSummary({ day: "2026-11-16", runId: "  ", items })).toThrow();
    expect(() =>
      buildDistillationSummary({
        day: "2026-11-16",
        runId: "dst_run_1",
        items: [{ id: "x", action: "cold", cardIds: [], recovery: "uncold" }],
      }),
    ).toThrow();
  });
});
