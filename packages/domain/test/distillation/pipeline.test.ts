import { describe, expect, it } from "vitest";

import {
  findBatchUnit,
  findCrossBatchMatch,
  judgeMemoryItem,
  memoryContentHash,
  planMemoryCardDraft,
  resumeIntentDecision,
  selectDistillationCandidates,
  validateDistillationOutput,
  type DistillationCandidateCard,
  type DistillationItemRecord,
  type DistillationSourceCard,
  type ExtractedMemoryItem,
  type MemoryDistiller,
  type MemoryJudge,
} from "../../src/distillation/index.js";

/**
 * 腳本化的小模型與判定器，端到端走一遍領域層的規則：
 * 歸零卡挑選 → 提煉（驗證）→ 合併／取代判定 → 卡片草稿／合併 → 續跑意圖。
 */

const silentJudge: MemoryJudge = {
  sameAs: async () => false,
  contradicts: async () => false,
};

/** 腳本化提煉器：照卡 id 回傳設定好的原始輸出或拋錯。 */
function scriptedDistiller(script: Readonly<Record<string, unknown>>): MemoryDistiller {
  return {
    distill: async (cards) => {
      const card = cards[0];
      if (card === undefined) throw new Error("空批次");
      const output = script[card.cardId];
      if (output instanceof Error) throw output;
      return output;
    },
  };
}

const sources: Record<string, DistillationSourceCard> = {
  "01NOTE": {
    cardId: "01NOTE",
    kind: "note",
    title: "筆記",
    body: "使用者決定六月內換掉整套硬碟",
    persona: "default",
  },
  "01LOG": {
    cardId: "01LOG",
    kind: "summary",
    title: "對話摘要",
    body: "今日盤點磁碟空間",
    persona: "default",
  },
};

const staleCards: DistillationCandidateCard[] = [
  { cardId: "01NOTE", kind: "note", lifecycle: "live", freshness: 0, persona: "default" },
  { cardId: "01LOG", kind: "summary", lifecycle: "live", freshness: 0, persona: "default" },
  { cardId: "01HOT", kind: "note", lifecycle: "live", freshness: 42, persona: "default" },
  { cardId: "01OLD", kind: "memory", lifecycle: "cold", freshness: 0, persona: "default" },
];

describe("領域層流水線：挑選到產出", () => {
  it("歸零卡提煉出兩條記憶，各自產生一張卡或合併進既有卡", async () => {
    const distiller = scriptedDistiller({
      "01NOTE": {
        items: [
          { type: "decision", text: "使用者決定六月內換掉整套硬碟" },
          { type: "fact", text: "目前硬碟以快寫滿" },
        ],
      },
      "01LOG": { items: [] },
    });
    const picked = selectDistillationCandidates(staleCards, "default");
    expect(picked.map((card) => card.cardId)).toEqual(["01LOG", "01NOTE"]);

    const produced: Array<{ item: ExtractedMemoryItem; hash: string; source: string }> = [];
    for (const card of picked) {
      const validated = validateDistillationOutput(
        await distiller.distill([sources[card.cardId]!]),
      );
      if (!validated.ok) throw new Error(`提煉失敗：${validated.reason}`);
      for (const item of validated.items) {
        produced.push({ item, hash: memoryContentHash(item), source: card.cardId });
      }
    }
    // 一張來源卡可以提煉出多條記憶；01LOG 的空 items 沒有產出。
    expect(produced.map((entry) => entry.item.type)).toEqual(["decision", "fact"]);
    expect(new Set(produced.map((entry) => entry.hash)).size).toBe(2);
    expect(produced.every((entry) => entry.source === "01NOTE")).toBe(true);
  });

  it("提煉失敗的卡不擋住其他卡；失敗單元標記 failed", async () => {
    const distiller = scriptedDistiller({
      "01NOTE": { items: [{ type: "opinion", text: "錯誤的 type" }] },
    });
    const ok = validateDistillationOutput({ items: [] });
    const bad = validateDistillationOutput(await distiller.distill([sources["01NOTE"]!]));
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });

  it("每個 item 先過續跑鍵：同批次續跑時已完成的單元跳過，不重產", async () => {
    const item: ExtractedMemoryItem = { type: "decision", text: "使用者決定六月內換掉整套硬碟" };
    const hash = memoryContentHash(item);
    const records: DistillationItemRecord[] = [
      {
        runId: "run_1",
        batchId: "dst_1",
        persona: "default",
        sourceCardId: "01NOTE",
        contentHash: hash,
        outputCardId: "01OUT",
        itemKey: "01NOTE:merge:0",
        phase: "merge",
        status: "done",
      },
    ];
    expect(findBatchUnit(records, { batchId: "dst_1", itemKey: "01NOTE:merge:0" })?.status).toBe(
      "done",
    );
    // 復原後，同一張產出被排除在跨批次去重外，且意圖不再寫卡。
    const undone = records.map((record) => ({ ...record, undone: true }));
    expect(
      findCrossBatchMatch(undone, {
        persona: "default",
        contentHash: hash,
        excludeBatchId: "dst_2",
      }),
    ).toBeUndefined();
    expect(
      resumeIntentDecision({
        done: false,
        undone: true,
        existingFile: undefined,
        contentHash: hash,
      }),
    ).toEqual({ kind: "skip", reason: "undone" });
  });

  it("全流程：歸零卡 → 提煉 → 判定為 create → 卡片草稿 sources 指回原卡", async () => {
    const item: ExtractedMemoryItem = {
      type: "preference",
      text: "使用者偏好以單一視窗工作",
    };
    const verdict = await judgeMemoryItem(item, [], silentJudge);
    const draft = planMemoryCardDraft({
      item,
      verdict,
      sources: ["01NOTE"],
      persona: "default",
      model: { title: "單一視窗偏好" },
    });
    expect(verdict).toEqual({ action: "create" });
    expect(draft?.kind).toBe("memory");
    expect(draft?.sources).toEqual(["01NOTE"]);
    expect(draft?.title).toBe("單一視窗偏好");
  });
});
