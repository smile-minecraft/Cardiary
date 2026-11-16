import { describe, expect, it } from "vitest";

import { sha256Hex } from "../../src/cards/index.js";
import {
  CorruptVersionHistoryError,
  planRetention,
  reconstructBody,
  type CardVersion,
} from "../../src/documents/index.js";

function version(seq: number, overrides: Partial<CardVersion> = {}): CardVersion {
  const patchText = overrides.patchText ?? `body-${seq}`;
  return {
    versionId: `v${seq}`,
    cardId: "card",
    seq,
    kind: "patch",
    revision: `rev-${seq}`,
    bodyHash: sha256Hex(patchText),
    baseRevision: null,
    patchFormat: "unified",
    patchText,
    createdAt: "2026-01-01T00:00:00.000Z",
    mergedCount: 0,
    mergedSeqRange: null,
    ...overrides,
  };
}

describe("版本重放", () => {
  const body0 = ["line one", "line two"].join("\n");
  const body1 = ["line one", "line TWO"].join("\n");
  const diff = ["@@ -2,1 +2,1 @@", "-line two", "+line TWO"].join("\n");

  const versions: CardVersion[] = [
    version(1, {
      kind: "create",
      patchFormat: "replace",
      patchText: body0,
      bodyHash: sha256Hex(body0),
    }),
    version(2, {
      patchFormat: "unified",
      patchText: diff,
      bodyHash: sha256Hex(body1),
      baseRevision: "rev-1",
    }),
  ];

  it("從錨點重放補丁，還原出目標版內文", () => {
    expect(reconstructBody("card", versions, "v1")).toBe(body0);
    expect(reconstructBody("card", versions, "v2")).toBe(body1);
  });

  it("重放結果與 bodyHash 不符時拒絕回傳", () => {
    const corrupt = versions.map((item) =>
      item.seq === 2 ? { ...item, bodyHash: "0".repeat(64) } : item,
    );
    expect(() => reconstructBody("card", corrupt, "v2")).toThrow(CorruptVersionHistoryError);
  });
});

describe("版本保留策略", () => {
  const versions: CardVersion[] = Array.from({ length: 10 }, (_, index) => {
    const seq = index + 1;
    return version(seq, {
      kind: seq === 1 ? "create" : seq === 4 ? "checkpoint" : "patch",
      patchFormat: seq === 1 || seq === 4 ? "replace" : "unified",
    });
  });

  it("保留建立版、每日檢查點與最近 N 版，其餘合併並記錄範圍", () => {
    const plan = planRetention(versions, { maxRecent: 3, keepDailyCheckpoint: true });
    expect([...plan.keep].sort()).toEqual(["v1", "v10", "v4", "v8", "v9"]);
    expect(plan.merges.get("v4")).toEqual({ count: 2, range: "2-3" });
    expect(plan.merges.get("v8")).toEqual({ count: 3, range: "5-7" });
  });

  it("上限為 0 表示不限，不合併任何版本", () => {
    const plan = planRetention(versions, { maxRecent: 0, keepDailyCheckpoint: true });
    expect(plan.keep.size).toBe(10);
    expect(plan.merges.size).toBe(0);
  });

  it("每日檢查點是重放錨點，保留策略一律留著", () => {
    const plan = planRetention(versions, { maxRecent: 3, keepDailyCheckpoint: false });
    expect(plan.keep.has("v1")).toBe(true);
    expect(plan.keep.has("v4")).toBe(true);
  });
});
