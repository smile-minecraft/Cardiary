/**
 * 小型語言模型的 System One 實作。
 *
 * spike 顯示本機 3B 一次送多題會亂答（20 題批次準確率 35%、順序反轉
 * 13/20 翻轉），所以逐題送、逐題驗證；只支援是非題，其他題型直接記入
 * `missing`。輸出要求是 `{"p": 0–1}`，解析或值域不對的題目一律記入
 * `missing`，不猜。逾時丟 `SystemOneError`，由發牌走退路。
 */

import {
  DEFAULT_NO_CRITERIA,
  DEFAULT_YES_CRITERIA,
  SystemOneError,
  type SystemOneAnswer,
  type SystemOneInvoker,
  type SystemOneJudgeResult,
  type YesNoQuestion,
} from "./types.js";
import { assertValidQuestions } from "./validate.js";

/** 預設逾時；設計值是 8 秒，逐題請求共用同一個截止時間。 */
export const DEFAULT_MODEL_TIMEOUT_MS = 8_000;

/** 逐題呼叫宿主提供的模型；宿主負責選模型、金鑰與供應商格式。 */
export interface SystemOneModelCallRequest {
  readonly purpose: string;
  readonly prompt: string;
  /** 要求模型照這個 JSON Schema 輸出；宿主不支援時可以忽略。 */
  readonly jsonSchema: unknown;
  readonly signal: AbortSignal;
}

export interface SystemOneModelCallResult {
  readonly text: string;
}

export type SystemOneModelCall = (
  request: SystemOneModelCallRequest,
) => Promise<SystemOneModelCallResult>;

export interface ModelInvokerOptions {
  readonly call: SystemOneModelCall;
  /** 整批的逾時毫秒數；逐題請求共用同一個截止時間。 */
  readonly timeoutMs?: number;
}

/** 是非題的輸出 schema：只有一個 0–1 的數字。 */
export const PROBABILITY_SCHEMA = {
  type: "object",
  properties: { p: { type: "number", minimum: 0, maximum: 1 } },
  required: ["p"],
  additionalProperties: false,
} as const;

/** 組出是非題的提示；`statement` 與判定文字都放進去。 */
export function buildProbabilityPrompt(question: YesNoQuestion): string {
  return [
    "你要判斷一個陳述是否為真。只輸出一個 JSON 物件，不要輸出其他文字。",
    '形狀是 {"p": 0 到 1 的數字}，代表這個陳述為真的機率。',
    "",
    `陳述：${question.statement}`,
    `為真的意思：${question.criteriaTrue ?? DEFAULT_YES_CRITERIA}`,
    `為假的意思：${question.criteriaFalse ?? DEFAULT_NO_CRITERIA}`,
  ].join("\n");
}

/** 嚴格解析 `{"p": 0–1}`；多一個欄位或型別不對都算沒有答案。 */
function parseProbability(text: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "p") return null;
  const probability = record.p;
  return typeof probability === "number" &&
    Number.isFinite(probability) &&
    probability >= 0 &&
    probability <= 1
    ? probability
    : null;
}

function timeoutError(timeoutMs: number, cause?: unknown): SystemOneError {
  return new SystemOneError("timeout", `System One 模型判斷超過 ${timeoutMs} ms`, { cause });
}

export function createModelInvoker(options: ModelInvokerOptions): SystemOneInvoker {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

  return {
    async judge(request): Promise<SystemOneJudgeResult> {
      assertValidQuestions(request.questions);
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const answers: SystemOneAnswer[] = [];
      const missing: string[] = [];
      try {
        for (const question of request.questions) {
          if (question.kind !== "yes-no") {
            missing.push(question.key);
            continue;
          }
          if (controller.signal.aborted) throw timeoutError(timeoutMs);
          let text: string;
          try {
            const result = await options.call({
              purpose: "system-one",
              prompt: buildProbabilityPrompt(question),
              jsonSchema: PROBABILITY_SCHEMA,
              signal: controller.signal,
            });
            text = result.text;
          } catch (error) {
            if (controller.signal.aborted) throw timeoutError(timeoutMs, error);
            missing.push(question.key);
            continue;
          }
          const probability = parseProbability(text);
          if (probability === null) missing.push(question.key);
          else answers.push({ kind: "yes-no", key: question.key, probability });
        }
        return { answers, missing };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
