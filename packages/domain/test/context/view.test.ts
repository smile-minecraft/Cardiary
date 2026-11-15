import { describe, expect, it } from "vitest";

import {
  buildContextView,
  compactionTriggerTokens,
  isCompactionDue,
  nextPosition,
  sortEntries,
  type ContextEntry,
} from "../../src/context/index.js";

function entry(
  overrides: Partial<ContextEntry> & Pick<ContextEntry, "entryId" | "layer">,
): ContextEntry {
  return {
    title: overrides.entryId,
    tokenEstimate: 0,
    state: "active",
    position: 0,
    ...overrides,
  };
}

describe("ContextView", () => {
  it("usedTokens 是各項估算的加總，不是呼叫端填的值", () => {
    const view = buildContextView({
      sessionId: "conv_1",
      version: 3,
      entries: [
        entry({ entryId: "a", layer: "bedrock", tokenEstimate: 120 }),
        entry({ entryId: "b", layer: "working-context", tokenEstimate: 800 }),
        entry({ entryId: "c", layer: "volatile-state", tokenEstimate: 8 }),
      ],
      budgetTokens: 91_808,
      contextWindow: 100_000,
      compactionThreshold: 0.75,
    });

    expect(view.usedTokens).toBe(928);
    expect(view.entries.reduce((sum, item) => sum + item.tokenEstimate, 0)).toBe(view.usedTokens);
  });

  it("項目依層順序與層內 position 排序", () => {
    const view = buildContextView({
      sessionId: "conv_1",
      version: 1,
      entries: [
        entry({ entryId: "last", layer: "other-cards", position: 1 }),
        entry({ entryId: "tail", layer: "volatile-state", position: 0 }),
        entry({ entryId: "first", layer: "other-cards", position: 0 }),
        entry({ entryId: "bedrock", layer: "bedrock", position: 0 }),
      ],
      budgetTokens: 1000,
      contextWindow: 9000,
      compactionThreshold: 0.75,
    });

    expect(view.entries.map((item) => item.entryId)).toEqual(["bedrock", "first", "last", "tail"]);
  });

  it("pending-removal 的項目仍算進用量，因為它還在上下文裡", () => {
    const view = buildContextView({
      sessionId: "conv_1",
      version: 1,
      entries: [
        entry({ entryId: "kept", layer: "other-cards", tokenEstimate: 100 }),
        entry({
          entryId: "removing",
          layer: "other-cards",
          tokenEstimate: 50,
          state: "pending-removal",
          position: 1,
        }),
      ],
      budgetTokens: 10_000,
      contextWindow: 18_192,
      compactionThreshold: 0.75,
    });

    expect(view.usedTokens).toBe(150);
    expect(view.entries[1]?.state).toBe("pending-removal");
  });
});

describe("壓縮門檻", () => {
  it("預算是模型上限減去保留量", () => {
    expect(compactionTriggerTokens(80_000, 0.75)).toBe(60_000);
  });

  it("用量達到 75% 才算達到門檻", () => {
    const base = { budgetTokens: 80_000, compactionThreshold: 0.75 };

    expect(isCompactionDue({ ...base, usedTokens: 59_999 })).toBe(false);
    expect(isCompactionDue({ ...base, usedTokens: 60_000 })).toBe(true);
    expect(isCompactionDue({ ...base, usedTokens: 60_001 })).toBe(true);
  });

  it("沒有預算時不觸發，避免除以零", () => {
    expect(isCompactionDue({ usedTokens: 10, budgetTokens: 0, compactionThreshold: 0.75 })).toBe(
      false,
    );
  });
});

describe("排序工具", () => {
  it("下一張卡放在同一層的尾端", () => {
    const entries = [
      entry({ entryId: "a", layer: "other-cards", position: 0 }),
      entry({ entryId: "b", layer: "other-cards", position: 5 }),
      entry({ entryId: "c", layer: "bedrock", position: 9 }),
    ];

    expect(nextPosition(entries, "other-cards")).toBe(6);
    expect(nextPosition(entries, "short-term-memory")).toBe(0);
  });

  it("sortEntries 不會改到傳進來的陣列", () => {
    const entries = [
      entry({ entryId: "tail", layer: "volatile-state" }),
      entry({ entryId: "head", layer: "bedrock" }),
    ];
    const original = [...entries];

    sortEntries(entries);

    expect(entries).toEqual(original);
  });
});
