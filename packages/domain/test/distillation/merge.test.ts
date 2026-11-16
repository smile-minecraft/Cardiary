import { describe, expect, it } from "vitest";

import {
  comparisonCandidates,
  judgeMemoryItem,
  planMemoryCardDraft,
  type ExtractedMemoryItem,
  type MemoryJudge,
  type MemoryMatchCandidate,
} from "../../src/distillation/index.js";

function item(text: string, type: ExtractedMemoryItem["type"] = "fact"): ExtractedMemoryItem {
  return { type, text };
}

function memory(
  cardId: string,
  text: string,
  overrides: Partial<MemoryMatchCandidate> = {},
): MemoryMatchCandidate {
  return { cardId, kind: "memory", text, lifecycle: "live", ...overrides };
}

/** 依序登記的判定器：key 為 `kind:索引` 的候選文字。 */
function scriptedJudge(
  same: ReadonlyArray<boolean> = [],
  contradicts: ReadonlyArray<boolean> = [],
): MemoryJudge {
  let sameCall = 0;
  let contradictCall = 0;
  return {
    sameAs: async () => same[sameCall++] ?? false,
    contradicts: async () => contradicts[contradictCall++] ?? false,
  };
}

describe("比對候選過濾", () => {
  it("只留 kind=memory、未被取代、文字非空的候選，保留輸入順序、含冷封存", () => {
    const hits = comparisonCandidates([
      memory("01A", "A"),
      memory("01B", "B", { lifecycle: "cold" }),
      memory("01C", "C", { supersededBy: "01Z" }),
      { ...memory("01D", "D"), kind: "note" as const },
      memory("01E", "   "),
    ]);
    expect(hits.map((hit) => hit.cardId)).toEqual(["01A", "01B"]);
  });
});

describe("合併與取代判定", () => {
  it("與既有記憶重複：不建立新卡，記錄合併目標", async () => {
    const verdict = await judgeMemoryItem(
      item("使用者住在台北"),
      [memory("01M", "使用者住在台北")],
      scriptedJudge([true]),
    );
    expect(verdict).toEqual({ action: "merge", mergedInto: "01M" });
  });

  it("重複優先於取代：同一候選判為同一回事就不再問矛盾", async () => {
    const judge = scriptedJudge([true]);
    const verdict = await judgeMemoryItem(
      item("使用者住在台北"),
      [memory("01M", "使用者住在台北")],
      judge,
    );
    expect(verdict.action).toBe("merge");
  });

  it("矛盾：產生取代關係，舊卡不改寫", async () => {
    const verdict = await judgeMemoryItem(
      item("使用者搬到高雄"),
      [memory("01M", "使用者住在台北")],
      scriptedJudge([false], [true]),
    );
    expect(verdict).toEqual({ action: "supersede", supersedes: "01M" });
    const draft = planMemoryCardDraft({
      item: item("使用者搬到高雄"),
      verdict,
      sources: ["01S"],
      persona: "default",
    });
    expect(draft?.supersedes).toBe("01M");
    expect(draft?.kind).toBe("memory");
  });

  it("兩者皆否：建立全新記憶卡，無 supersedes", async () => {
    const verdict = await judgeMemoryItem(
      item("使用者偏好單一視窗"),
      [memory("01M", "使用者住在台北")],
      scriptedJudge([false], [false]),
    );
    expect(verdict).toEqual({ action: "create" });
    const draft = planMemoryCardDraft({
      item: item("使用者偏好單一視窗"),
      verdict,
      sources: ["01S"],
      persona: "default",
    });
    expect(draft).not.toBeNull();
    expect("supersedes" in (draft ?? {})).toBe(false);
    expect(draft?.sources).toEqual(["01S"]);
    expect(draft?.tags).toEqual([]);
  });

  it("非重複候選才會被問取代；多個矛盾候選取檢索順序最前面的一張", async () => {
    const judge = scriptedJudge([false, false], [false, true, true]);
    const verdict = await judgeMemoryItem(
      item("新的陳述"),
      [memory("01A", "占位A"), memory("01B", "占位B"), memory("01C", "占位C")],
      judge,
    );
    expect(verdict).toEqual({ action: "supersede", supersedes: "01B" });
  });

  it("不同內容不會誤合併為記憶卡", async () => {
    // 兩條文字不同的項目各自比對：判定器回 false → 都是 create，
    // 且各自保留獨立的 sources，不會被錯誤地綁成同一張卡。
    const judge = scriptedJudge();
    const first = await judgeMemoryItem(item("甲"), [memory("01M", "乙")], judge);
    const second = await judgeMemoryItem(item("乙"), [memory("01N", "甲")], judge);
    expect(first).toEqual({ action: "create" });
    expect(second).toEqual({ action: "create" });
  });

  it("合併結論不產生卡片", () => {
    const draft = planMemoryCardDraft({
      item: item("使用者住在台北"),
      verdict: { action: "merge", mergedInto: "01M" },
      sources: ["01S"],
      persona: "default",
    });
    expect(draft).toBeNull();
  });

  it("sources 去重、保留順序、全部指回歸零卡", async () => {
    const draft = planMemoryCardDraft({
      item: item("內容"),
      verdict: { action: "create" },
      sources: ["01S", "01S", "01T"],
      persona: "default",
    });
    expect(draft?.sources).toEqual(["01S", "01T"]);
  });
});
