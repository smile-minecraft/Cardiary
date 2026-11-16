import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL,
  SystemOneError,
  buildJevRequest,
  createJevInvoker,
  normalizeJevAnswers,
  type JevUsageRecord,
  type SystemOneQuestion,
} from "../../src/system-one/index.js";

const yesNo: SystemOneQuestion = {
  kind: "yes-no",
  key: "card-1",
  statement: "state.cards[0] 這張卡與這個請求相關嗎？",
  criteriaTrue: "直接談到請求的主題。",
  criteriaFalse: "主題相近但不能回應請求。",
};

const choice: SystemOneQuestion = {
  kind: "choice",
  key: "department",
  statement: "這是哪個部門的工單？",
  options: [
    { key: "billing", label: "帳務" },
    { key: "technical", label: "技術" },
  ],
};

const score: SystemOneQuestion = {
  kind: "score",
  key: "frustration",
  statement: "使用者有多不滿？",
  levels: ["平靜", "不滿", "非常生氣"],
};

const jevPayload = {
  model: "typesafe/jev-1.14-20261014",
  answers: {
    "card-1": { type: "noul", noul: 0.87 },
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 1, technical: 0 },
      confidence: 1,
    },
    frustration: {
      type: "score",
      score: 1.47,
      probabilities: { "0": 0, "1": 0.53, "2": 0.47 },
      confidence: 0.3,
    },
  },
  usage: { input_tokens: 466, output_tokens: 73, cost: 0.000019572 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 記錄每次呼叫，依固定 body 與狀態碼回應。 */
function fakeFetch(
  body: unknown,
  status = 200,
): ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>> {
  return vi.fn(async () => jsonResponse(body, status));
}

describe("Jev 請求與回應轉換", () => {
  it("三種問法轉成 Jev 的 noul、choice、score", () => {
    const body = buildJevRequest([yesNo, choice, score], { request: "退款" });

    expect(body.model).toBe(DEFAULT_JEV_MODEL);
    expect(body.state).toEqual({ request: "退款" });
    expect(body.questions).toEqual({
      "card-1": {
        type: "noul",
        instructions: yesNo.statement,
        criteria: { true: yesNo.criteriaTrue, false: yesNo.criteriaFalse },
      },
      department: {
        type: "choice",
        instructions: choice.statement,
        criteria: { billing: "帳務", technical: "技術" },
      },
      frustration: {
        type: "score",
        instructions: score.statement,
        criteria: ["平靜", "不滿", "非常生氣"],
      },
    });
  });

  it("是非題沒有給判定文字時補上預設", () => {
    const body = buildJevRequest([{ kind: "yes-no", key: "a", statement: "是真的嗎？" }], null);
    const question = body.questions.a as {
      criteria: { true: string; false: string };
    };

    expect(question.criteria.true.length).toBeGreaterThan(0);
    expect(question.criteria.false.length).toBeGreaterThan(0);
  });

  it("回應正規化成領域答案，順序照題目", () => {
    const result = normalizeJevAnswers([score, choice, yesNo], jevPayload);

    expect(result.missing).toEqual([]);
    expect(result.answers).toEqual([
      {
        kind: "score",
        key: "frustration",
        expected: 1.47,
        confidence: 0.3,
        distribution: { "0": 0, "1": 0.53, "2": 0.47 },
      },
      {
        kind: "choice",
        key: "department",
        choice: "billing",
        confidence: 1,
        distribution: { billing: 1, technical: 0 },
      },
      {
        kind: "yes-no",
        key: "card-1",
        probability: 0.87,
      },
    ]);
  });

  it("缺答案或值域不對的題目記入 missing，其餘照常", () => {
    const result = normalizeJevAnswers([yesNo, choice, score], {
      answers: {
        "card-1": { type: "noul", noul: 1.4 },
        department: { type: "choice", choice: "sales", confidence: 1, probabilities: { sales: 1 } },
        frustration: {
          type: "score",
          score: 2,
          probabilities: { "0": 0, "1": 0, "2": 1 },
          confidence: 1,
        },
      },
    });

    expect(result.answers).toEqual([
      {
        kind: "score",
        key: "frustration",
        expected: 2,
        confidence: 1,
        distribution: { "0": 0, "1": 0, "2": 1 },
      },
    ]);
    expect(result.missing).toEqual(["card-1", "department"]);
  });

  it("回應沒有 answers 物件時視為整批格式錯誤", () => {
    expect(() => normalizeJevAnswers([yesNo], { model: "x" })).toThrow(SystemOneError);
  });
});

describe("JevInvoker", () => {
  it("一次請求送出所有題目，帶上鎖定模型與 Bearer 金鑰", async () => {
    const fetchImpl = fakeFetch(jevPayload);
    const invoker = createJevInvoker({ apiKey: "secret", fetchImpl });

    const result = await invoker.judge({
      state: { request: "退款" },
      questions: [yesNo, choice, score],
    });

    expect(result.answers).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${DEFAULT_JEV_BASE_URL}/systemone`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(DEFAULT_JEV_MODEL);
    expect(Object.keys(body.questions)).toEqual(["card-1", "department", "frustration"]);
  });

  it("baseUrl 換成 AIML API 時路徑一樣接在後面", async () => {
    const fetchImpl = fakeFetch({ answers: {} });
    const invoker = createJevInvoker({
      apiKey: "k",
      baseUrl: "https://api.aimlapi.com/v1/",
      fetchImpl,
    });

    const result = await invoker.judge({ state: null, questions: [yesNo] });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.aimlapi.com/v1/systemone");
    expect(result.missing).toEqual(["card-1"]);
  });

  it("HTTP 失敗整批丟 SystemOneError，不重試", async () => {
    const fetchImpl = fakeFetch({ error: "busy" }, 429);
    const invoker = createJevInvoker({ apiKey: "k", fetchImpl });

    await expect(invoker.judge({ state: null, questions: [yesNo] })).rejects.toMatchObject({
      name: "SystemOneError",
      code: "http",
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("超過逾時就中斷請求並丟 timeout", async () => {
    const fetchImpl = vi.fn((...args: [string, RequestInit]) => {
      const init = args[1];
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const invoker = createJevInvoker({ apiKey: "k", fetchImpl, timeoutMs: 10 });

    await expect(
      invoker.judge({ state: null, questions: [yesNo], timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("用量記錄 build 號、token 與成本，不含題目內容", async () => {
    const records: JevUsageRecord[] = [];
    const fetchImpl = fakeFetch(jevPayload);
    const invoker = createJevInvoker({
      apiKey: "k",
      fetchImpl,
      onUsage: (record) => records.push(record),
    });

    await invoker.judge({ state: { request: "退款" }, questions: [yesNo, choice, score] });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      model: "typesafe/jev-1.14-20261014",
      inputTokens: 466,
      outputTokens: 73,
      costUsd: 0.000019572,
    });
    expect(JSON.stringify(records[0])).not.toContain("退款");
  });

  it("題目不合法的請求不送到網路", async () => {
    const fetchImpl = fakeFetch({ answers: {} });
    const invoker = createJevInvoker({ apiKey: "k", fetchImpl });
    const invalid: SystemOneQuestion = {
      kind: "choice",
      key: "pick",
      statement: "分類",
      options: [{ key: "only", label: "只有一個" }],
    };

    await expect(invoker.judge({ state: null, questions: [invalid] })).rejects.toMatchObject({
      code: "invalid-question",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("沒有答案的請求回傳空的答案與 missing", async () => {
    const fetchImpl = fakeFetch({ answers: {} });
    const invoker = createJevInvoker({ apiKey: "k", fetchImpl });

    const result = await invoker.judge({ state: null, questions: [yesNo] });

    expect(result.answers).toEqual([]);
    expect(result.missing).toEqual(["card-1"]);
  });
});
