/**
 * Jev 1.14 的 System One 實作。
 *
 * 一次請求送完所有題目（spike：20 題 p50 610 ms、p95 698 ms），版本鎖在
 * `typesafe/jev-1.14`；回應的實際 build 號與用量交給呼叫端記錄，不記錄
 * 題目或上下文內容。HTTP 失敗丟 `SystemOneError`，缺答案的題目記入
 * `missing`，由發牌決定怎麼處理。
 */

import {
  DEFAULT_NO_CRITERIA,
  DEFAULT_YES_CRITERIA,
  SystemOneError,
  type SystemOneAnswer,
  type SystemOneInvoker,
  type SystemOneJudgeResult,
  type SystemOneQuestion,
} from "./types.js";
import { assertValidQuestions } from "./validate.js";

/** 預設直接連 TypeSafe；AIML API 只要換 baseUrl。 */
export const DEFAULT_JEV_BASE_URL = "https://api.typesafe.ai/v1";
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.14";

/** 預設逾時；設計值是 5 秒。 */
export const DEFAULT_JEV_TIMEOUT_MS = 5_000;

/** 每次請求後的用量；內容不含題目與上下文。 */
export interface JevUsageRecord {
  /** 回應裡的實際 build 號；沒有回應時是請求的模型。 */
  readonly model: string;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

/** 實際打 HTTP 的函式；測試注入假伺服器，正式用全域 `fetch`。 */
export type JevFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface JevInvokerOptions {
  /** 由宿主向鑰匙圈取得；領域層不碰金鑰的保存。 */
  readonly apiKey: string;
  /** API 基底，結尾是 `/v1`；實際路徑是 `{baseUrl}/systemone`。 */
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetchImpl?: JevFetch;
  /** 請求的預設逾時；`judge` 的 `timeoutMs` 優先。 */
  readonly timeoutMs?: number;
  readonly onUsage?: (record: JevUsageRecord) => void;
}

/** Jev 的請求形狀；`state` 與 `questions` 由題目轉換而來。 */
export interface JevRequestBody {
  readonly model: string;
  readonly state: unknown;
  readonly questions: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unitInterval(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function readDistribution(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  const distribution: Record<string, number> = {};
  let total = 0;
  for (const [key, raw] of entries) {
    const probability = unitInterval(raw);
    if (probability === null) return null;
    distribution[key] = probability;
    total += probability;
  }
  // Jev 的機率總和是 1；容許浮點誤差，差距太大代表回應不可信。
  return Math.abs(total - 1) <= 1e-3 ? distribution : null;
}

function readUsage(payload: unknown, fallbackModel: string, latencyMs: number): JevUsageRecord {
  const body = isRecord(payload) ? payload : {};
  const usage = isRecord(body.usage) ? body.usage : {};
  return {
    model: typeof body.model === "string" ? body.model : fallbackModel,
    latencyMs,
    ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
    ...(typeof usage.cost === "number" ? { costUsd: usage.cost } : {}),
  };
}

/** 從題目組出 Jev 的請求；是非題的預設判定文字也在這裡補上。 */
export function buildJevRequest(
  questions: readonly SystemOneQuestion[],
  state: unknown,
  model: string = DEFAULT_JEV_MODEL,
): JevRequestBody {
  assertValidQuestions(questions);
  const mapped: Record<string, unknown> = {};
  for (const question of questions) {
    if (question.kind === "yes-no") {
      mapped[question.key] = {
        type: "noul",
        instructions: question.statement,
        criteria: {
          true: question.criteriaTrue ?? DEFAULT_YES_CRITERIA,
          false: question.criteriaFalse ?? DEFAULT_NO_CRITERIA,
        },
      };
    } else if (question.kind === "choice") {
      mapped[question.key] = {
        type: "choice",
        instructions: question.statement,
        criteria: Object.fromEntries(question.options.map((option) => [option.key, option.label])),
      };
    } else {
      mapped[question.key] = {
        type: "score",
        instructions: question.statement,
        criteria: [...question.levels],
      };
    }
  }
  return { model, state, questions: mapped };
}

function normalizeChoice(
  question: Extract<SystemOneQuestion, { kind: "choice" }>,
  entry: Record<string, unknown>,
): SystemOneAnswer | null {
  const choice = entry.choice;
  if (typeof choice !== "string") return null;
  if (!question.options.some((option) => option.key === choice)) return null;
  const confidence = unitInterval(entry.confidence);
  const distribution = readDistribution(entry.probabilities);
  if (confidence === null || distribution === null) return null;
  const optionKeys = new Set(question.options.map((option) => option.key));
  const distributionKeys = Object.keys(distribution);
  if (distributionKeys.length !== optionKeys.size) return null;
  if (!distributionKeys.every((key) => optionKeys.has(key))) return null;
  return { kind: "choice", key: question.key, choice, confidence, distribution };
}

function normalizeScore(
  question: Extract<SystemOneQuestion, { kind: "score" }>,
  entry: Record<string, unknown>,
): SystemOneAnswer | null {
  const expected = entry.score;
  if (typeof expected !== "number" || !Number.isFinite(expected)) return null;
  if (expected < 0 || expected > question.levels.length - 1) return null;
  const confidence = unitInterval(entry.confidence);
  const distribution = readDistribution(entry.probabilities);
  if (confidence === null || distribution === null) return null;
  const levelKeys = question.levels.map((_, index) => String(index));
  const distributionKeys = Object.keys(distribution);
  if (distributionKeys.length !== levelKeys.length) return null;
  if (!levelKeys.every((key) => distribution[key] !== undefined)) return null;
  return { kind: "score", key: question.key, expected, confidence, distribution };
}

function normalizeAnswer(question: SystemOneQuestion, entry: unknown): SystemOneAnswer | null {
  if (!isRecord(entry)) return null;
  switch (question.kind) {
    case "yes-no": {
      const probability = unitInterval(entry.noul);
      return probability === null ? null : { kind: "yes-no", key: question.key, probability };
    }
    case "choice":
      return normalizeChoice(question, entry);
    case "score":
      return normalizeScore(question, entry);
  }
}

/**
 * 把 Jev 的回應正規化成領域答案。
 *
 * `answers` 不是物件時視為整批格式錯誤；個別題目缺欄位或值域不對時，
 * 該題記入 `missing`，不猜。
 */
export function normalizeJevAnswers(
  questions: readonly SystemOneQuestion[],
  payload: unknown,
): SystemOneJudgeResult {
  if (!isRecord(payload) || !isRecord(payload.answers)) {
    throw new SystemOneError("invalid-response", "Jev 回應缺少 answers 物件");
  }
  const raw = payload.answers;
  const answers: SystemOneAnswer[] = [];
  const missing: string[] = [];
  for (const question of questions) {
    const answer = normalizeAnswer(question, raw[question.key]);
    if (answer === null) missing.push(question.key);
    else answers.push(answer);
  }
  return { answers, missing };
}

function timeoutError(timeoutMs: number, cause?: unknown): SystemOneError {
  return new SystemOneError("timeout", `Jev 判斷超過 ${timeoutMs} ms`, { cause });
}

export function createJevInvoker(options: JevInvokerOptions): SystemOneInvoker {
  const baseUrl = (options.baseUrl ?? DEFAULT_JEV_BASE_URL).replace(/\/+$/, "");
  const model = options.model ?? DEFAULT_JEV_MODEL;
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS;

  return {
    async judge(request) {
      const body = buildJevRequest(request.questions, request.state, model);
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      try {
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}/systemone`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) throw timeoutError(timeoutMs, error);
          throw new SystemOneError("http", "Jev 請求失敗", { cause: error });
        }
        if (!response.ok) {
          throw new SystemOneError("http", `Jev 回應 HTTP ${response.status}`, {
            status: response.status,
          });
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw timeoutError(timeoutMs, error);
          throw new SystemOneError("invalid-response", "Jev 回應不是 JSON", { cause: error });
        }
        const result = normalizeJevAnswers(request.questions, payload);
        options.onUsage?.(readUsage(payload, model, Date.now() - startedAt));
        return result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
