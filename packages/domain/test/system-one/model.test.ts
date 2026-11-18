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

  it("開局發牌只帶請求與對應卡的標題、摘要，不帶正文、其他卡與其他狀態", () => {
    const state = {
      request: "幫我規劃花蓮行程",
      secret: "不該出現的共用狀態",
      cards: [
        { id: "card-1", title: "花蓮民宿", summary: "七星潭附近", body: "正文：訂房密碼 1234" },
        { id: "card-2", title: "台北咖啡店", summary: "大安區", body: "另一張卡的正文" },
      ],
    };

    const prompt = buildProbabilityPrompt(yesNo, state);

    expect(prompt).toContain("幫我規劃花蓮行程");
    expect(prompt).toContain("花蓮民宿");
    expect(prompt).toContain("七星潭附近");
    expect(prompt).not.toContain("訂房密碼");
    expect(prompt).not.toContain("正文");
    expect(prompt).not.toContain("台北咖啡店");
    expect(prompt).not.toContain("大安區");
    expect(prompt).not.toContain("不該出現的共用狀態");
  });

  it("卡片沒有摘要時只帶標題", () => {
    const prompt = buildProbabilityPrompt(yesNo, {
      request: "花蓮",
      cards: [{ id: "card-1", title: "花蓮民宿" }],
    });

    expect(prompt).toContain("花蓮民宿");
    expect(prompt).not.toContain('"summary"');
  });

  it.each([
    ["沒有狀態", undefined],
    ["狀態是 null", null],
    ["請求不是字串", { request: 1, cards: [{ id: "card-1", title: "t" }] }],
    ["cards 不是陣列", { request: "r", cards: { id: "card-1" } }],
    ["找不到對應的卡", { request: "r", cards: [{ id: "card-9", title: "別張" }] }],
    ["標題不是字串", { request: "r", cards: [{ id: "card-1", title: 3 }] }],
  ])("狀態形狀不對（%s）時不帶判斷資料，提示與沒有狀態時相同", (_label, state) => {
    expect(buildProbabilityPrompt(yesNo, state)).toBe(buildProbabilityPrompt(yesNo));
    expect(buildProbabilityPrompt(yesNo, state)).not.toContain("別張");
  });

  it("帶機率校準準則與嚴格輸出格式（m2-model-eval §4.5）", () => {
    const prompt = buildProbabilityPrompt(yesNo);

    expect(prompt).toContain("你是一個嚴格校準的機率判斷器");
    expect(prompt).toContain("- 0.90–1.00：證據完整、語意明確無歧義");
    expect(prompt).toContain("- 0.00–0.69：不符合、資訊遭截斷／不完整");
    expect(prompt).toContain('僅輸出一行純 JSON 物件，只允許唯一鍵 "p"：{"p":0.0}');
    expect(prompt).toContain("嚴禁輸出 markdown 圍欄");
    // 陳述在判定文字之前，判定文字在輸出規定之前。
    expect(prompt.indexOf("陳述：")).toBeLessThan(prompt.indexOf("為真的意思："));
    expect(prompt.indexOf("為假的意思：")).toBeLessThan(prompt.indexOf("輸出規定："));
  });

  it("開局發牌的判斷資料放在陳述與判定文字之間", () => {
    const prompt = buildProbabilityPrompt(yesNo, {
      request: "花蓮",
      cards: [{ id: "card-1", title: "花蓮民宿", summary: "七星潭" }],
    });

    const context = prompt.indexOf("開局發牌的判斷資料");
    expect(context).toBeGreaterThan(prompt.indexOf("陳述："));
    expect(context).toBeLessThan(prompt.indexOf("為真的意思："));
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

  it("每一題的提示只帶自己那張卡", async () => {
    const call = scriptedCall(['{"p": 0.9}', '{"p": 0.2}']);
    const invoker = createModelInvoker({ call });

    await invoker.judge({
      state: {
        request: "規劃行程",
        cards: [
          { id: "card-1", title: "第一張標題", summary: "第一張摘要" },
          { id: "card-2", title: "第二張標題", summary: "第二張摘要" },
        ],
      },
      questions: [yesNo, yesNo2],
    });

    expect(call.requests[0]?.prompt).toContain("第一張摘要");
    expect(call.requests[0]?.prompt).not.toContain("第二張摘要");
    expect(call.requests[1]?.prompt).toContain("第二張摘要");
    expect(call.requests[1]?.prompt).not.toContain("第一張摘要");
    expect(call.requests.every((request) => request.prompt.includes("規劃行程"))).toBe(true);
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
