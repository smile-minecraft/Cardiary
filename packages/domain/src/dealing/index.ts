/**
 * 開局發牌的純函式。
 *
 * 發牌只發生在對話的第一則訊息：候選卡由檢索提供（含名次與分數），
 * System One 逐卡回答一題是非題，程式依門檻過濾、依（機率降冪、檢索
 * 名次升冪、卡片識別碼升冪）排序，再依 token 預算貪婪裝入。沒有 System
 * One 或判斷失敗時，直接依檢索名次發牌，不讓開場卡住。
 *
 * 相同輸入必定得到相同的卡與順序：排序鍵是完整的全序，不看時間、Map
 * 迭代順序或候選傳入的順序。
 */

import {
  SystemOneError,
  type SystemOneErrorCode,
  type SystemOneInvoker,
  type SystemOneJudgeResult,
  type SystemOneProfile,
  type SystemOneQuestion,
} from "../system-one/index.js";

/** 預設的發牌 token 預算；核心記憶組（第 3 層）不計入。 */
export const DEFAULT_DEAL_BUDGET_TOKENS = 1_500;

/** 設定層允許的預算範圍；領域層不夾住，只提供常數給邊界驗證。 */
export const MIN_DEAL_BUDGET_TOKENS = 500;
export const MAX_DEAL_BUDGET_TOKENS = 3_000;

/** 發牌的是非題判定文字；固定文字讓 Jev 的快取可以重用。 */
export const DEAL_CRITERIA_TRUE =
  "這張卡直接談到請求的主題、人物、專案或問題，可以用來回應這個請求。";
export const DEAL_CRITERIA_FALSE = "主題相近，但不能用來回應這個請求。";

/** 這張卡是怎麼被發的。 */
export type DealSource = "system-one" | "retrieval";

/** 發牌的候選卡；由檢索（`dealing` 模式）整理成這個形狀。 */
export interface DealCandidate {
  readonly cardId: string;
  readonly title: string;
  /** 摘要；送給外部 System One 的內容只有標題與摘要，不含內文。 */
  readonly summary?: string;
  /** 標題＋摘要＋內文的 token 估算，由呼叫端用同一套估算器算好。 */
  readonly tokenEstimate: number;
  /** 檢索名次，從 0 開始。 */
  readonly rank: number;
  /** 檢索分數（RRF）；只供呈現與除錯，不參與排序。 */
  readonly retrievalScore?: number;
}

/** 逐卡的相關機率；鍵是卡片識別碼。 */
export interface DealJudgement {
  readonly probabilities: Readonly<Record<string, number>>;
}

/** 一張被發的卡。 */
export interface DealtCard {
  readonly cardId: string;
  readonly title: string;
  readonly tokenEstimate: number;
  /** 在第 4 層的順序，從 0 開始。 */
  readonly position: number;
  /** System One 給的相關機率；退路時省略。 */
  readonly dealProbability?: number;
  readonly dealSource: DealSource;
}

/** 有判斷結果時依門檻挑卡；沒有判斷結果時依檢索名次。 */
export type DealSelectionInput = {
  readonly candidates: readonly DealCandidate[];
  readonly budgetTokens: number;
} & (
  | { readonly judgement: DealJudgement; readonly threshold: number }
  | { readonly judgement?: undefined; readonly threshold?: undefined }
);

/** 發牌用的 System One：實作與它的門檻、候選數、逾時。 */
export interface SystemOneDealJudge {
  readonly profile: SystemOneProfile;
  readonly invoker: SystemOneInvoker;
}

export interface OpeningDealInput {
  /** 第一則使用者訊息，也是檢索的查詢。 */
  readonly requestText: string;
  readonly candidates: readonly DealCandidate[];
  readonly budgetTokens: number;
  /** null＝沒有 System One（設為「無」或不可用）；直接依檢索名次。 */
  readonly judge: SystemOneDealJudge | null;
}

/** 判斷失敗的摘要；`code` 是 `SystemOneError` 的錯誤碼或未知。 */
export interface DealFailure {
  readonly code: SystemOneErrorCode | "unknown";
  readonly message: string;
}

export interface OpeningDeal {
  readonly cards: readonly DealtCard[];
  readonly source: DealSource;
  /** System One 沒有回答的題目（cardId）。 */
  readonly missing: readonly string[];
  readonly failure?: DealFailure;
}

/** 只有對話的第一則訊息、而且第 4 層還沒寫過時才發牌。 */
export function shouldDealOpening(state: {
  /** 這是第幾則使用者訊息，從 0 開始。 */
  readonly turnIndex: number;
  /** 這場對話的第 4 層是否已經寫過（即使發了 0 張也算）。 */
  readonly openingDealt: boolean;
}): boolean {
  return state.turnIndex === 0 && !state.openingDealt;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertCandidates(candidates: readonly DealCandidate[]): void {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.cardId)) {
      throw new RangeError(`候選卡的識別碼重複：${candidate.cardId}`);
    }
    ids.add(candidate.cardId);
    if (!Number.isFinite(candidate.tokenEstimate) || candidate.tokenEstimate < 0) {
      throw new RangeError(`候選卡 ${candidate.cardId} 的 token 估算不合法`);
    }
    if (!Number.isFinite(candidate.rank)) {
      throw new RangeError(`候選卡 ${candidate.cardId} 的檢索名次不合法`);
    }
  }
}

function assertBudget(budgetTokens: number): void {
  if (!Number.isFinite(budgetTokens) || budgetTokens < 0) {
    throw new RangeError(`發牌預算不合法：${budgetTokens}`);
  }
}

/** 依檢索名次、再依卡片識別碼排序；不看傳入順序。 */
function byRetrieval(left: DealCandidate, right: DealCandidate): number {
  return left.rank - right.rank || compareText(left.cardId, right.cardId);
}

/** 依機率降冪、檢索名次升冪、卡片識別碼升冪排序。 */
function byProbability(
  left: { readonly candidate: DealCandidate; readonly probability: number },
  right: { readonly candidate: DealCandidate; readonly probability: number },
): number {
  return (
    right.probability - left.probability ||
    left.candidate.rank - right.candidate.rank ||
    compareText(left.candidate.cardId, right.candidate.cardId)
  );
}

/** 依序裝入，遇到第一張塞不下的卡就停；順序就是第 4 層的順序。 */
function pack(
  ordered: readonly { readonly candidate: DealCandidate; readonly probability?: number }[],
  budgetTokens: number,
  source: DealSource,
): DealtCard[] {
  const dealt: DealtCard[] = [];
  let usedTokens = 0;
  for (const { candidate, probability } of ordered) {
    if (usedTokens + candidate.tokenEstimate > budgetTokens) break;
    usedTokens += candidate.tokenEstimate;
    dealt.push({
      cardId: candidate.cardId,
      title: candidate.title,
      tokenEstimate: candidate.tokenEstimate,
      position: dealt.length,
      dealSource: source,
      ...(probability === undefined ? {} : { dealProbability: probability }),
    });
  }
  return dealt;
}

/** 組出逐卡的是非題；`state.cards[i]` 對應候選卡的順序。 */
export function buildDealQuestions(
  candidates: readonly DealCandidate[],
): readonly SystemOneQuestion[] {
  assertCandidates(candidates);
  return candidates.map((candidate, index) => ({
    kind: "yes-no",
    key: candidate.cardId,
    statement: `state.cards[${index}]（標題：${candidate.title}）這張卡與這個請求相關嗎？`,
    criteriaTrue: DEAL_CRITERIA_TRUE,
    criteriaFalse: DEAL_CRITERIA_FALSE,
  }));
}

/** 依門檻與預算挑卡；回傳順序就是第 4 層的順序。 */
export function dealOpeningCards(input: DealSelectionInput): readonly DealtCard[] {
  const { candidates, budgetTokens } = input;
  assertBudget(budgetTokens);
  assertCandidates(candidates);

  if (input.judgement === undefined) {
    const ordered = [...candidates].sort(byRetrieval).map((candidate) => ({ candidate }));
    return pack(ordered, budgetTokens, "retrieval");
  }

  const { threshold, judgement } = input;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(`發牌門檻不合法：${threshold}`);
  }
  const judged = candidates.map((candidate) => {
    const probability = judgement.probabilities[candidate.cardId] ?? 0;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError(`候選卡 ${candidate.cardId} 的機率不合法`);
    }
    return { candidate, probability };
  });
  const ordered = judged.filter((entry) => entry.probability >= threshold).sort(byProbability);
  return pack(ordered, budgetTokens, "system-one");
}

/** 把 Promise 與逾時賽跑；逾時後才失敗的 Promise 不會變成未處理的拒絕。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new SystemOneError("timeout", `System One 判斷超過 ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  promise.catch(() => {});
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 只留判斷需要的欄位；內文不送給外部服務。 */
function judgeState(requestText: string, candidates: readonly DealCandidate[]): unknown {
  return {
    request: requestText,
    cards: candidates.map((candidate) => ({
      id: candidate.cardId,
      title: candidate.title,
      ...(candidate.summary === undefined ? {} : { summary: candidate.summary }),
    })),
  };
}

function failureOf(error: unknown): DealFailure {
  if (error instanceof SystemOneError) return { code: error.code, message: error.message };
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 跑完整個發牌流程：送判斷、依門檻與預算挑卡。
 *
 * System One 逾時或出錯時退回檢索名次；部分題目沒有答案時只影響那幾張卡。
 */
export async function planOpeningDeal(input: OpeningDealInput): Promise<OpeningDeal> {
  assertBudget(input.budgetTokens);
  assertCandidates(input.candidates);
  const ordered = [...input.candidates].sort(byRetrieval);
  if (input.judge === null) {
    return {
      cards: dealOpeningCards({ candidates: ordered, budgetTokens: input.budgetTokens }),
      source: "retrieval",
      missing: [],
    };
  }

  const { profile, invoker } = input.judge;
  const limited = ordered.slice(0, profile.candidateLimit);
  let result: SystemOneJudgeResult;
  try {
    result = await withTimeout(
      invoker.judge({
        state: judgeState(input.requestText, limited),
        questions: buildDealQuestions(limited),
        timeoutMs: profile.timeoutMs,
      }),
      profile.timeoutMs,
    );
  } catch (error) {
    return {
      cards: dealOpeningCards({ candidates: ordered, budgetTokens: input.budgetTokens }),
      source: "retrieval",
      missing: [],
      failure: failureOf(error),
    };
  }

  const probabilities: Record<string, number> = {};
  for (const answer of result.answers) {
    if (answer.kind === "yes-no") probabilities[answer.key] = answer.probability;
  }
  return {
    cards: dealOpeningCards({
      candidates: limited,
      budgetTokens: input.budgetTokens,
      threshold: profile.threshold,
      judgement: { probabilities },
    }),
    source: "system-one",
    missing: [...result.missing],
  };
}
