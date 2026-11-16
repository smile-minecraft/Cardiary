import { describe, expect, it, vi } from "vitest";

import {
  PROBABILITY_SCHEMA,
  SystemOneError,
  buildProbabilityPrompt,
  createModelInvoker,
  type SystemOneModelCall,
  type SystemOneModelCallRequest,
  type SystemOneQuestion,
} from "../../src/system-one/index.js";

const yesNo: SystemOneQuestion = {
  kind: "yes-no",
  key: "card-1",
  statement: "這張卡與這個請求相關嗎？",
  criteriaTrue: "直接談到請求的主題。",
  criteriaFalse: "主題相近但不能回應請求。",
};

const yesNo2: SystemOneQuestion = {
  kind: "yes-no",
  key: "card-2",
  statement: "第二張卡相關嗎？",
};

const choice: SystemOneQuestion = {
  kind: "choice",
  key: "pick",
  statement: "分類",
  options: [
    { key: "a", label: "A" },
    { key: "b", label: "B" },
  ],
};

/** 記錄每次呼叫，依序回傳給定的輸出。 */
function scriptedCall(outputs: readonly (string | Error)[]): SystemOneModelCall & {
  readonly requests: SystemOneModelCallRequest[];
} {
  const requests: SystemOneModelCallRequest[] = [];
  const call = async (request: SystemOneModelCallRequest) => {
    requests.push(request);
    const output = outputs[requests.length - 1];
    if (output instanceof Error) throw output;
    return { text: output ?? "" };
  };
  return Object.assign(call, { requests });
}

describe("小型模型的提示", () => {
  it("提示包含問句與判定文字，要求只輸出機率 JSON", () => {
    const prompt = buildProbabilityPrompt(yesNo);

    expect(prompt).toContain("這張卡與這個請求相關嗎？");
    expect(prompt).toContain("直接談到請求的主題。");
    expect(prompt).toContain("主題相近但不能回應請求。");
    expect(prompt).toContain('"p"');
  });

  it("schema 固定是只有一個 0–1 數字的物件", () => {
    expect(PROBABILITY_SCHEMA).toMatchObject({
      type: "object",
      required: ["p"],
      additionalProperties: false,
    });
  });
});

describe("ModelInvoker", () => {
  it("逐題請求並把機率轉成答案", async () => {
    const call = scriptedCall(['{"p": 0.82}', '{"p": 0.1}']);
    const invoker = createModelInvoker({ call });

    const result = await invoker.judge({ state: null, questions: [yesNo, yesNo2] });

    expect(call.requests).toHaveLength(2);
    expect(result.answers).toEqual([
      { kind: "yes-no", key: "card-1", probability: 0.82 },
      { kind: "yes-no", key: "card-2", probability: 0.1 },
    ]);
    expect(result.missing).toEqual([]);
    expect(call.requests[0]?.jsonSchema).toBe(PROBABILITY_SCHEMA);
  });

  it("單選與評分題不送給模型，直接記入 missing", async () => {
    const call = scriptedCall(['{"p": 0.5}']);
    const invoker = createModelInvoker({ call });

    const result = await invoker.judge({ state: null, questions: [choice, yesNo] });

    expect(call.requests).toHaveLength(1);
    expect(result.answers).toEqual([{ kind: "yes-no", key: "card-1", probability: 0.5 }]);
    expect(result.missing).toEqual(["pick"]);
  });

  it.each([
    ["不是 JSON", "0.8"],
    ["多了欄位", '{"p": 0.8, "why": "相關"}'],
    ["超出值域", '{"p": 1.2}'],
    ["字串不是數字", '{"p": "0.8"}'],
    ["包了 markdown", '```json\n{"p": 0.8}\n```'],
  ])("輸出形狀不對（%s）時記入 missing，不猜", async (_label, text) => {
    const invoker = createModelInvoker({ call: scriptedCall([text]) });

    const result = await invoker.judge({ state: null, questions: [yesNo] });

    expect(result.answers).toEqual([]);
    expect(result.missing).toEqual(["card-1"]);
  });

  it("單題失敗只影響那一題，其他題照常", async () => {
    const call = scriptedCall([new Error("provider down"), '{"p": 0.7}']);
    const invoker = createModelInvoker({ call });

    const result = await invoker.judge({ state: null, questions: [yesNo, yesNo2] });

    expect(result.answers).toEqual([{ kind: "yes-no", key: "card-2", probability: 0.7 }]);
    expect(result.missing).toEqual(["card-1"]);
  });

  it("超過整批逾時就中斷並丟 timeout", async () => {
    const call = vi.fn(
      (request: SystemOneModelCallRequest) =>
        new Promise<{ text: string }>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const invoker = createModelInvoker({ call, timeoutMs: 10 });

    await expect(invoker.judge({ state: null, questions: [yesNo] })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("沒有是非題時不呼叫模型", async () => {
    const call = scriptedCall([]);
    const invoker = createModelInvoker({ call });

    const result = await invoker.judge({ state: null, questions: [choice] });

    expect(call.requests).toEqual([]);
    expect(result.missing).toEqual(["pick"]);
  });

  it("題目不合法時丟 invalid-question，不呼叫模型", async () => {
    const call = scriptedCall([]);
    const invoker = createModelInvoker({ call });
    const invalid: SystemOneQuestion = {
      kind: "score",
      key: "s",
      statement: "評分",
      levels: ["一"],
    };

    await expect(invoker.judge({ state: null, questions: [invalid] })).rejects.toThrow(
      SystemOneError,
    );
    expect(call.requests).toEqual([]);
  });
});
