import { describe, expect, it } from "vitest";
import { mergeRetrievalCandidates, type RetrievalCandidate } from "../../src/retrieval/index.js";

const card = (cardId: string, extras: Partial<RetrievalCandidate> = {}): RetrievalCandidate => ({
  cardId,
  cold: false,
  superseded: false,
  broken: false,
  ...extras,
});

describe("混合檢索排名", () => {
  it("合併兩路排名，前段出現兩次者優先，同分以最佳名次與卡片識別碼排序", () => {
    const result = mergeRetrievalCandidates(
      [card("both"), card("b"), card("a")],
      [card("a"), card("both"), card("b")],
      "search",
    );
    expect(result.map((entry) => entry.cardId)).toEqual(["both", "a", "b"]);
    expect(result[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
  });

  it("被取代與格式錯誤的卡不進結果，冷封存只在主動搜尋出現", () => {
    const entries = [
      card("old", { superseded: true }),
      card("bad", { broken: true }),
      card("cold", { cold: true }),
      card("live"),
    ];
    expect(
      mergeRetrievalCandidates(entries, entries, "dealing").map((entry) => entry.cardId),
    ).toEqual(["live"]);
    expect(
      mergeRetrievalCandidates(entries, entries, "search").map((entry) => entry.cardId),
    ).toEqual(["cold", "live"]);
  });

  it("兩路各只取前 40 筆並輸出最多 20 筆", () => {
    const full = Array.from({ length: 45 }, (_, i) => card(`f${String(i).padStart(2, "0")}`));
    const vectors = Array.from({ length: 45 }, (_, i) => card(`v${String(i).padStart(2, "0")}`));
    const result = mergeRetrievalCandidates(full, vectors, "search");
    expect(result).toHaveLength(20);
    expect(result.map((entry) => entry.cardId)).toEqual(
      Array.from({ length: 10 }, (_, i) => [
        `f${String(i).padStart(2, "0")}`,
        `v${String(i).padStart(2, "0")}`,
      ]).flat(),
    );
  });
});
