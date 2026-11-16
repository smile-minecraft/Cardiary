/**
 * 題目的邊界驗證。
 *
 * Jev 的欄位限制在領域層先擋下來（單選 2–255 個選項、評分 2–10 個等級），
 * 避免 HTTP 422 沿著呼叫鏈傳播；題數與鍵的唯一性也在這裡檢查。
 */

import { SystemOneError, type SystemOneQuestion } from "./types.js";

export const MIN_CHOICE_OPTIONS = 2;
/** Jev 的 `criteria` 欄位最多 255 項；256 會回 HTTP 422。 */
export const MAX_CHOICE_OPTIONS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new SystemOneError("invalid-question", message);
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * 在送到任何供應商之前驗證題目；不合法就丟 `invalid-question`。
 *
 * 只檢查型別表達不出來的限制：題數、鍵唯一、選項與等級的數量與文字。
 */
export function assertValidQuestions(questions: readonly SystemOneQuestion[]): void {
  assert(questions.length > 0, "至少要有 1 題");
  const keys = new Set<string>();
  for (const question of questions) {
    assert(nonEmpty(question.key), "題目的 key 不能是空的");
    assert(!keys.has(question.key), `題目的 key 重複：${question.key}`);
    keys.add(question.key);
    assert(nonEmpty(question.statement), `${question.key} 的問句是空的`);
    if (question.kind === "choice") {
      assert(
        question.options.length >= MIN_CHOICE_OPTIONS &&
          question.options.length <= MAX_CHOICE_OPTIONS,
        `${question.key} 的選項必須是 ${MIN_CHOICE_OPTIONS}–${MAX_CHOICE_OPTIONS} 個`,
      );
      const optionKeys = new Set<string>();
      for (const option of question.options) {
        assert(nonEmpty(option.key), `${question.key} 有空的選項鍵`);
        assert(!optionKeys.has(option.key), `${question.key} 的選項鍵重複：${option.key}`);
        assert(nonEmpty(option.label), `${question.key} 的選項 ${option.key} 沒有說明`);
        optionKeys.add(option.key);
      }
    }
    if (question.kind === "score") {
      assert(
        question.levels.length >= MIN_SCORE_LEVELS && question.levels.length <= MAX_SCORE_LEVELS,
        `${question.key} 的等級必須是 ${MIN_SCORE_LEVELS}–${MAX_SCORE_LEVELS} 個`,
      );
      for (const level of question.levels) {
        assert(nonEmpty(level), `${question.key} 有空的等級說明`);
      }
    }
  }
}
