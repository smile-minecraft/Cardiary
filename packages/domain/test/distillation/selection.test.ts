import { describe, expect, it } from "vitest";

import {
  selectDistillationCandidates,
  type DistillationCandidateCard,
} from "../../src/distillation/index.js";

function card(overrides: Partial<DistillationCandidateCard> = {}): DistillationCandidateCard {
  return {
    cardId: "01A",
    kind: "note",
    lifecycle: "live",
    freshness: 0,
    persona: "default",
    ...overrides,
  };
}

describe("挑選", () => {
  it("只留下 live 且新鮮度歸零的卡，依 cardId 升冪", () => {
    const picked = selectDistillationCandidates(
      [card({ cardId: "01C" }), card({ cardId: "01A", freshness: 10 }), card({ cardId: "01B" })],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01B", "01C"]);
  });

  it("排除已冷封存的卡", () => {
    const picked = selectDistillationCandidates(
      [card({ cardId: "01A", lifecycle: "cold" }), card({ cardId: "01B" })],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01B"]);
  });

  it("排除被取代的卡", () => {
    const picked = selectDistillationCandidates(
      [card({ cardId: "01A", supersededBy: "01X" }), card({ cardId: "01B" })],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01B"]);
  });

  it("排除基岩卡與人格卡", () => {
    const picked = selectDistillationCandidates(
      [
        card({ cardId: "01A", kind: "bedrock" }),
        card({ cardId: "01B", kind: "persona" }),
        card({ cardId: "01C", kind: "memory" }),
      ],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01C"]);
  });

  it("排除格式錯誤的卡與核心組成員", () => {
    const picked = selectDistillationCandidates(
      [
        card({ cardId: "01A", broken: true }),
        card({ cardId: "01B", kind: "memory", coreMember: true }),
        card({ cardId: "01C" }),
      ],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01C"]);
  });

  it("以人格分區處理：其他人格的歸零卡不進這一區", () => {
    const picked = selectDistillationCandidates(
      [card({ cardId: "01A", persona: "work" }), card({ cardId: "01B" })],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01B"]);
  });

  it("長期記憶卡衰減到 0 也參與重提煉", () => {
    const picked = selectDistillationCandidates(
      [card({ cardId: "01A", kind: "memory" })],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01A"]);
  });

  it("負數與非有限的新鮮度視為歸零處理，非有限的捨棄", () => {
    const picked = selectDistillationCandidates(
      [
        card({ cardId: "01A", freshness: -0.5 }),
        card({ cardId: "01B", freshness: Number.NaN }),
        card({ cardId: "01C", freshness: Number.POSITIVE_INFINITY }),
      ],
      "default",
    );
    expect(picked.map((entry) => entry.cardId)).toEqual(["01A"]);
  });
});
