import { describe, expect, it } from "vitest";
import type { CardSearchHit } from "@cardiary/domain";
import { RetrievalService } from "../../host/src/modules/retrieval/service.js";

function hit(cardId: string, extras: Partial<CardSearchHit["card"]> = {}): CardSearchHit {
  return {
    card: {
      cardId,
      title: cardId,
      kind: "note",
      tags: [],
      persona: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
      lifecycle: "live",
      ...extras,
    },
    score: 1,
    snippet: cardId,
  };
}

describe("檢索服務", () => {
  it("合併全文與向量，依模式過濾冷封存與被取代的卡", async () => {
    const full = [
      hit("text"),
      hit("both"),
      hit("old", { supersededBy: "new" }),
      hit("cold", { lifecycle: "cold" }),
    ];
    const vector = [hit("vector"), hit("both"), hit("cold", { lifecycle: "cold" })];
    const service = new RetrievalService(
      { search: async () => ({ items: full }) },
      { search: async () => vector },
    );
    const searched = (await service.search({ query: "字" }, "search")).items;
    expect(searched[0]?.card.cardId).toBe("both");
    expect(searched.map((item) => item.card.cardId)).toContain("cold");
    expect(searched.map((item) => item.card.cardId)).not.toContain("old");
    const dealing = (await service.search({ query: "字" }, "dealing")).items;
    expect(dealing.map((item) => item.card.cardId)).not.toContain("cold");
    expect(dealing.map((item) => item.card.cardId)).not.toContain("old");
  });

  it("向量來源失敗時仍回傳全文結果", async () => {
    const service = new RetrievalService(
      { search: async () => ({ items: [hit("text")] }) },
      {
        search: async () => {
          throw new Error("unavailable");
        },
      },
    );
    expect((await service.search({ query: "字" }, "search")).items[0]?.card.cardId).toBe("text");
  });
});
