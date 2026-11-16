import { describe, expect, it } from "vitest";

import {
  CORE_TOKEN_BUDGET_DEFAULT,
  CORE_TOKEN_BUDGET_MAX,
  CORE_TOKEN_BUDGET_MIN,
  clampCoreTokenBudget,
  coreDayKey,
  estimateCoreMemoryTokens,
  planCoreChange,
  sortCoreMemory,
  type CoreMemoryEntry,
} from "../../src/distillation/index.js";

function entry(cardId: string, addedDay: string, persona = "default"): CoreMemoryEntry {
  return { persona, cardId, addedDay, source: "user" };
}

function daily(changed: boolean, day = "2026-11-16", persona = "default") {
  return { persona, day, changed };
}

const ENTRIES: readonly CoreMemoryEntry[] = [
  entry("01B", "2026-11-10"),
  entry("01A", "2026-11-10"),
  entry("01C", "2026-11-12"),
];

describe("預算常數與夾取", () => {
  it("預設 800、可調 400–1,500、NaN 回預設值", () => {
    expect(CORE_TOKEN_BUDGET_DEFAULT).toBe(800);
    expect(clampCoreTokenBudget(undefined)).toBe(800);
    expect(clampCoreTokenBudget(Number.NaN)).toBe(800);
    expect(clampCoreTokenBudget(100)).toBe(CORE_TOKEN_BUDGET_MIN);
    expect(clampCoreTokenBudget(9999)).toBe(CORE_TOKEN_BUDGET_MAX);
    expect(clampCoreTokenBudget(1200)).toBe(1200);
  });

  it("估算以標題＋摘要＋內文加總", () => {
    const total = estimateCoreMemoryTokens([{ title: "甲乙", summary: "丙丁", body: "戊己庚辛" }]);
    const expected = Math.ceil(2 / 2.5) + Math.ceil(2 / 2.5) + Math.ceil(4 / 2.5);
    expect(total).toBe(expected);
  });
});

describe("核心組排序", () => {
  it("依 added_day 再 card_id 升冪，決定性且不改寫輸入", () => {
    const sorted = sortCoreMemory(ENTRIES);
    expect(sorted.map((item) => item.cardId)).toEqual(["01A", "01B", "01C"]);
    expect(ENTRIES[0]?.cardId).toBe("01B");
  });
});

describe("日期鍵", () => {
  it("以 UTC 日期作為人格＋日期鍵的一天；格式不合法回 null", () => {
    expect(coreDayKey("2026-11-16T04:00:00.000Z")).toBe("2026-11-16");
    expect(coreDayKey("not-a-date")).toBeNull();
  });
});

describe("一天最多變動一次（人格＋日期鍵）", () => {
  it("今天尚未變動：加入在預算內可以 apply", () => {
    const decision = planCoreChange({
      entries: [],
      currentTokens: 100,
      budget: 800,
      daily: daily(false),
      request: { kind: "add", cardId: "01NEW", tokens: 50 },
    });
    expect(decision).toEqual({ kind: "apply", projectedTokens: 150 });
  });

  it("今天已變動過：任何變動都順延到隔天", () => {
    const add = planCoreChange({
      entries: [],
      currentTokens: 100,
      budget: 800,
      daily: daily(true),
      request: { kind: "add", cardId: "01NEW", tokens: 10 },
    });
    const remove = planCoreChange({
      entries: [entry("01A", "2026-11-10")],
      currentTokens: 100,
      budget: 800,
      daily: daily(true),
      request: { kind: "remove", cardId: "01A", tokens: 30 },
    });
    expect(add).toEqual({ kind: "defer", reason: "daily-limit" });
    expect(remove).toEqual({ kind: "defer", reason: "daily-limit" });
  });

  it("隔天恢復：同一人格、不同日期鍵不共用額度", () => {
    const yesterday = daily(true, "2026-11-16", "default");
    const tomorrow = daily(false, "2026-11-17", "default");
    const keys = [coreDayKey("2026-11-16T04:00:00Z"), coreDayKey("2026-11-17T04:00:00Z")];
    expect(keys).toEqual(["2026-11-16", "2026-11-17"]);
    expect(yesterday.day).not.toBe(tomorrow.day);
    expect(
      planCoreChange({
        entries: [],
        currentTokens: 700,
        budget: 800,
        daily: tomorrow,
        request: { kind: "add", cardId: "01X", tokens: 50 },
      }),
    ).toEqual({ kind: "apply", projectedTokens: 750 });
  });

  it("加入會超過預算：拒絕並附上加入後的估算（蒸餾不自動換出）", () => {
    const decision = planCoreChange({
      entries: ENTRIES,
      currentTokens: 780,
      budget: 800,
      daily: daily(false),
      request: { kind: "add", cardId: "01NEW", tokens: 40 },
    });
    expect(decision).toEqual({ kind: "refuse", reason: "budget", projectedTokens: 820 });
  });

  it("已在組內的卡重複加入不疊加預算", () => {
    const decision = planCoreChange({
      entries: ENTRIES,
      currentTokens: 780,
      budget: 800,
      daily: daily(false),
      request: { kind: "add", cardId: "01A", tokens: 40 },
    });
    expect(decision).toEqual({ kind: "apply", projectedTokens: 780 });
  });

  it("移除：計入當日變動，投影扣掉移除的 token", () => {
    const decision = planCoreChange({
      entries: ENTRIES,
      currentTokens: 700,
      budget: 800,
      daily: daily(false),
      request: { kind: "remove", cardId: "01A", tokens: 150 },
    });
    expect(decision).toEqual({ kind: "apply", projectedTokens: 550 });
  });
});
