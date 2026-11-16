import { describe, expect, it } from "vitest";

import {
  MAX_CHOICE_OPTIONS,
  SystemOneError,
  assertValidQuestions,
  type SystemOneQuestion,
} from "../../src/system-one/index.js";

const yesNo: SystemOneQuestion = {
  kind: "yes-no",
  key: "relevant",
  statement: "這張卡與這個請求相關嗎？",
};

const choice = (optionCount: number): SystemOneQuestion => ({
  kind: "choice",
  key: "pick",
  statement: "分類",
  options: Array.from({ length: optionCount }, (_, index) => ({
    key: `o${index}`,
    label: `選項 ${index}`,
  })),
});

const score = (levelCount: number): SystemOneQuestion => ({
  kind: "score",
  key: "rate",
  statement: "有多相關？",
  levels: Array.from({ length: levelCount }, (_, index) => `等級 ${index}`),
});

function rejectWith(questions: readonly SystemOneQuestion[], message: string): void {
  try {
    assertValidQuestions(questions);
  } catch (error) {
    expect(error).toBeInstanceOf(SystemOneError);
    expect((error as SystemOneError).code).toBe("invalid-question");
    expect((error as SystemOneError).message).toContain(message);
    return;
  }
  throw new Error("預期驗證失敗，但通過了");
}

describe("System One 題目驗證", () => {
  it("三種問法一起送時通過", () => {
    expect(() => assertValidQuestions([yesNo, choice(3), score(3)])).not.toThrow();
  });

  it("沒有題目就拒絕", () => {
    rejectWith([], "至少要有 1 題");
  });

  it("key 重複就拒絕", () => {
    rejectWith([yesNo, { ...yesNo }], "key 重複");
  });

  it("空的問句就拒絕", () => {
    rejectWith([{ ...yesNo, statement: "  " }], "問句是空的");
  });

  it("單選要 2 到 255 個選項", () => {
    expect(() => assertValidQuestions([choice(2)])).not.toThrow();
    expect(() => assertValidQuestions([choice(MAX_CHOICE_OPTIONS)])).not.toThrow();
    rejectWith([choice(1)], "選項必須是");
    rejectWith([choice(MAX_CHOICE_OPTIONS + 1)], "選項必須是");
  });

  it("單選的選項鍵不能重複", () => {
    rejectWith(
      [
        {
          kind: "choice",
          key: "pick",
          statement: "分類",
          options: [
            { key: "a", label: "A" },
            { key: "a", label: "B" },
          ],
        },
      ],
      "選項鍵重複",
    );
  });

  it("評分要 2 到 10 個等級", () => {
    expect(() => assertValidQuestions([score(2)])).not.toThrow();
    expect(() => assertValidQuestions([score(10)])).not.toThrow();
    rejectWith([score(1)], "等級必須是");
    rejectWith([score(11)], "等級必須是");
  });
});
