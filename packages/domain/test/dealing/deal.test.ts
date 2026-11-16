import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEAL_BUDGET_TOKENS,
  MAX_DEAL_BUDGET_TOKENS,
  MIN_DEAL_BUDGET_TOKENS,
  buildDealQuestions,
  dealOpeningCards,
  planOpeningDeal,
  shouldDealOpening,
  type DealCandidate,
  type DealJudgement,
  type SystemOneDealJudge,
} from "../../src/dealing/index.js";
import {
  JEV_PROFILE,
  MODEL_PROFILE,
  SystemOneError,
  type SystemOneJudgeRequest,
  type SystemOneJudgeResult,
} from "../../src/system-one/index.js";

function candidate(
  cardId: string,
  rank: number,
  tokenEstimate: number,
  summary = `${cardId} 的摘要`,
): DealCandidate {
  return {
    cardId,
    title: `標題 ${cardId}`,
    summary,
    tokenEstimate,
    rank,
    retrievalScore: 1 / rank,
  };
}

const judgement = (probabilities: Record<string, number>): DealJudgement => ({ probabilities });

/** 依題目 key 回傳固定機率的假 System One。 */
function stubJudge(
  probabilities: (key: string) => number | null,
): SystemOneDealJudge["invoker"] & { readonly requests: SystemOneJudgeRequest[] } {
  const requests: SystemOneJudgeRequest[] = [];
  const invoker = {
    requests,
    async judge(request: SystemOneJudgeRequest): Promise<SystemOneJudgeResult> {
      requests.push(request);
      const answers = [];
      const missing = [];
      for (const question of request.questions) {
        const probability = probabilities(question.key);
        if (probability === null) missing.push(question.key);
        else answers.push({ kind: "yes-no" as const, key: question.key, probability });
      }
      return { answers, missing };
    },
  };
  return invoker;
}

describe("發牌門檻與順序", () => {
  it("只有機率大於等於門檻的卡被發，依機率降冪", () => {
    const cards = [candidate("low", 0, 10), candidate("edge", 1, 10), candidate("high", 2, 10)];

    const dealt = dealOpeningCards({
      candidates: cards,
      budgetTokens: 100,
      threshold: 0.6,
      judgement: judgement({ low: 0.59, edge: 0.6, high: 0.95 }),
    });

    expect(dealt.map((card) => card.cardId)).toEqual(["high", "edge"]);
    expect(dealt[0]).toMatchObject({
      dealSource: "system-one",
      dealProbability: 0.95,
      position: 0,
    });
    expect(dealt[1]).toMatchObject({ dealProbability: 0.6, position: 1 });
  });

  it("同機率時依檢索名次，再同依卡片識別碼", () => {
    const cards = [
      candidate("rank-2", 2, 10),
      candidate("rank-0-b", 0, 10),
      candidate("rank-0-a", 0, 10),
    ];

    const dealt = dealOpeningCards({
      candidates: cards,
      budgetTokens: 100,
      threshold: 0.6,
      judgement: judgement({ "rank-2": 0.8, "rank-0-b": 0.8, "rank-0-a": 0.8 }),
    });

    expect(dealt.map((card) => card.cardId)).toEqual(["rank-0-a", "rank-0-b", "rank-2"]);
  });

  it("檢索名次相同、機率相同時卡片識別碼是穩定的最後一鍵", () => {
    const cards = [candidate("b", 1, 10), candidate("a", 1, 10)];

    const dealt = dealOpeningCards({
      candidates: cards,
      budgetTokens: 100,
      threshold: 0.5,
      judgement: judgement({ a: 0.7, b: 0.7 }),
    });

    expect(dealt.map((card) => card.cardId)).toEqual(["a", "b"]);
  });

  it("沒有被判斷到的卡不發", () => {
    const cards = [candidate("answered", 0, 10), candidate("missing", 1, 10)];

    const dealt = dealOpeningCards({
      candidates: cards,
      budgetTokens: 100,
      threshold: 0.6,
      judgement: judgement({ answered: 0.9 }),
    });

    expect(dealt.map((card) => card.cardId)).toEqual(["answered"]);
  });
});

describe("發牌預算", () => {
  it("剛好塞滿預算時全部發", () => {
    const cards = [candidate("a", 0, 20), candidate("b", 1, 10)];

    const dealt = dealOpeningCards({
      candidates: cards,
      budgetTokens: 30,
      threshold: 0.6,
      judgement: judgement({ a: 0.9, b: 0.8 }),
    });

    expect(dealt.map((card) => card.cardId)).toEqual(["a", "b"]);
    expect(dealt.reduce((sum, card) => sum + card.tokenEstimate, 0)).toBe(30);
  });

  it("差一張就超過預算時停止，不跳過再塞更小的卡", () => {
    const cards = [candidate("big", 0, 20), candidate("middle", 1, 10), candidate("small", 2, 5)];

    const dealt = dealOpeningCards({
      candidates: cards,
      budgetTokens: 27,
      threshold: 0.6,
      judgement: judgement({ big: 0.9, middle: 0.8, small: 0.7 }),
    });

    expect(dealt.map((card) => card.cardId)).toEqual(["big"]);
  });

  it("預算是負數或不是數字時拒絕", () => {
    expect(() =>
      dealOpeningCards({
        candidates: [candidate("a", 0, 1)],
        budgetTokens: -1,
        threshold: 0.6,
        judgement: judgement({ a: 0.9 }),
      }),
    ).toThrow(RangeError);
  });

  it("預設預算與可調範圍符合設計", () => {
    expect(DEFAULT_DEAL_BUDGET_TOKENS).toBe(1_500);
    expect(MIN_DEAL_BUDGET_TOKENS).toBe(500);
    expect(MAX_DEAL_BUDGET_TOKENS).toBe(3_000);
  });
});

describe("發牌決定性", () => {
  const cards = [
    candidate("c", 2, 15),
    candidate("a", 0, 15),
    candidate("b", 1, 15),
    candidate("d", 3, 15),
  ];
  const probabilities = { a: 0.8, b: 0.8, c: 0.9, d: 0.7 };

  it("相同輸入兩次得到完全相同的卡與順序", () => {
    const input = {
      candidates: cards,
      budgetTokens: 30,
      threshold: 0.6,
      judgement: judgement(probabilities),
    } as const;

    const first = dealOpeningCards(input);
    const second = dealOpeningCards(input);

    expect(second).toEqual(first);
  });

  it("候選傳入的順序不影響結果", () => {
    const forward = dealOpeningCards({
      candidates: cards,
      budgetTokens: 100,
      threshold: 0.6,
      judgement: judgement(probabilities),
    });
    const reversed = dealOpeningCards({
      candidates: [...cards].reverse(),
      budgetTokens: 100,
      threshold: 0.6,
      judgement: judgement(probabilities),
    });

    expect(reversed).toEqual(forward);
    expect(forward.map((card) => card.cardId)).toEqual(["c", "a", "b", "d"]);
  });

  it("重複的卡片識別碼是壞掉的輸入，直接拒絕", () => {
    expect(() =>
      dealOpeningCards({
        candidates: [candidate("a", 0, 10), candidate("a", 1, 10)],
        budgetTokens: 100,
        threshold: 0.6,
        judgement: judgement({ a: 0.9 }),
      }),
    ).toThrow(RangeError);
  });
});

describe("沒有 System One 的退路", () => {
  it("依檢索名次發牌，不帶機率", () => {
    const cards = [
      candidate("third", 2, 10),
      candidate("first", 0, 10),
      candidate("second", 1, 10),
    ];

    const dealt = dealOpeningCards({ candidates: cards, budgetTokens: 20 });

    expect(dealt.map((card) => card.cardId)).toEqual(["first", "second"]);
    expect(dealt.map((card) => card.dealSource)).toEqual(["retrieval", "retrieval"]);
    expect(dealt[0]?.dealProbability).toBeUndefined();
  });

  it("退路一樣受預算限制", () => {
    const cards = [candidate("first", 0, 10), candidate("second", 1, 10)];

    const dealt = dealOpeningCards({ candidates: cards, budgetTokens: 10 });

    expect(dealt.map((card) => card.cardId)).toEqual(["first"]);
  });
});

describe("發牌題目", () => {
  it("每張候選卡一題是非題，key 是卡片識別碼", () => {
    const questions = buildDealQuestions([candidate("a", 0, 10), candidate("b", 1, 10)]);

    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ kind: "yes-no", key: "a" });
    expect(questions[0]?.statement).toContain("state.cards[0]");
    expect(questions[0]?.statement).toContain("標題 a");
    expect(questions[1]?.statement).toContain("state.cards[1]");
  });
});

describe("完整發牌流程", () => {
  const cards = [candidate("a", 0, 10), candidate("b", 1, 10), candidate("c", 2, 10)];

  it("沒有 System One 時不呼叫，直接依檢索名次", async () => {
    const deal = await planOpeningDeal({
      requestText: "幫我規劃花蓮行程",
      candidates: cards,
      budgetTokens: 100,
      judge: null,
    });

    expect(deal.source).toBe("retrieval");
    expect(deal.cards.map((card) => card.cardId)).toEqual(["a", "b", "c"]);
    expect(deal.failure).toBeUndefined();
  });

  it("送出判斷時只帶標題與摘要，不帶其他欄位", async () => {
    const invoker = stubJudge(() => 0.9);

    await planOpeningDeal({
      requestText: "幫我規劃花蓮行程",
      candidates: cards,
      budgetTokens: 100,
      judge: { profile: JEV_PROFILE, invoker },
    });

    expect(invoker.requests).toHaveLength(1);
    expect(invoker.requests[0]?.state).toEqual({
      request: "幫我規劃花蓮行程",
      cards: [
        { id: "a", title: "標題 a", summary: "a 的摘要" },
        { id: "b", title: "標題 b", summary: "b 的摘要" },
        { id: "c", title: "標題 c", summary: "c 的摘要" },
      ],
    });
    expect(invoker.requests[0]?.timeoutMs).toBe(JEV_PROFILE.timeoutMs);
  });

  it("Jev 路徑最多送 20 張，模型路徑最多送 5 張", async () => {
    const many = Array.from({ length: 25 }, (_, index) => candidate(`c${index}`, index, 1));
    const jev = stubJudge(() => 0.9);
    const model = stubJudge(() => 0.9);

    await planOpeningDeal({
      requestText: "q",
      candidates: many,
      budgetTokens: 100,
      judge: { profile: JEV_PROFILE, invoker: jev },
    });
    await planOpeningDeal({
      requestText: "q",
      candidates: many,
      budgetTokens: 100,
      judge: { profile: MODEL_PROFILE, invoker: model },
    });

    expect(jev.requests[0]?.questions).toHaveLength(20);
    expect(model.requests[0]?.questions).toHaveLength(5);
  });

  it("部分題目沒有答案時，只影響那幾張卡", async () => {
    const invoker = stubJudge((key) => (key === "b" ? null : 0.8));

    const deal = await planOpeningDeal({
      requestText: "q",
      candidates: cards,
      budgetTokens: 100,
      judge: { profile: JEV_PROFILE, invoker },
    });

    expect(deal.source).toBe("system-one");
    expect(deal.cards.map((card) => card.cardId)).toEqual(["a", "c"]);
    expect(deal.missing).toEqual(["b"]);
  });

  it("判斷失敗時退回檢索名次，對話照常開始", async () => {
    const invoker = {
      async judge(): Promise<SystemOneJudgeResult> {
        throw new SystemOneError("http", "HTTP 503", { status: 503 });
      },
    };

    const deal = await planOpeningDeal({
      requestText: "q",
      candidates: cards,
      budgetTokens: 100,
      judge: { profile: JEV_PROFILE, invoker },
    });

    expect(deal.source).toBe("retrieval");
    expect(deal.cards.map((card) => card.cardId)).toEqual(["a", "b", "c"]);
    expect(deal.failure).toMatchObject({ code: "http" });
  });

  it("判斷逾時時退回檢索名次，不會卡住開場", async () => {
    const invoker = {
      judge(): Promise<SystemOneJudgeResult> {
        return new Promise(() => {});
      },
    };

    const deal = await planOpeningDeal({
      requestText: "q",
      candidates: cards,
      budgetTokens: 100,
      judge: { profile: { ...JEV_PROFILE, timeoutMs: 10 }, invoker },
    });

    expect(deal.source).toBe("retrieval");
    expect(deal.failure?.code).toBe("timeout");
  });

  it("模型門檻 0.75：0.74 不發、0.75 發", async () => {
    const invoker = stubJudge((key) => (key === "a" ? 0.74 : key === "b" ? 0.75 : 0.8));

    const deal = await planOpeningDeal({
      requestText: "q",
      candidates: cards.slice(0, 2),
      budgetTokens: 100,
      judge: { profile: MODEL_PROFILE, invoker },
    });

    expect(deal.cards.map((card) => card.cardId)).toEqual(["b"]);
  });

  it("判斷成功但沒有卡過門檻時，不退回檢索", async () => {
    const invoker = stubJudge(() => 0.1);

    const deal = await planOpeningDeal({
      requestText: "q",
      candidates: cards,
      budgetTokens: 100,
      judge: { profile: JEV_PROFILE, invoker },
    });

    expect(deal.source).toBe("system-one");
    expect(deal.cards).toEqual([]);
  });
});

describe("只在開局發牌", () => {
  it("第一則訊息且第 4 層還沒寫過時才發", () => {
    expect(shouldDealOpening({ turnIndex: 0, openingDealt: false })).toBe(true);
  });

  it("第一則訊息重送時不重發", () => {
    expect(shouldDealOpening({ turnIndex: 0, openingDealt: true })).toBe(false);
  });

  it("後續回合都不發，即使第 4 層還是空的", () => {
    expect(shouldDealOpening({ turnIndex: 1, openingDealt: false })).toBe(false);
    expect(shouldDealOpening({ turnIndex: 9, openingDealt: false })).toBe(false);
    expect(shouldDealOpening({ turnIndex: 9, openingDealt: true })).toBe(false);
  });
});
