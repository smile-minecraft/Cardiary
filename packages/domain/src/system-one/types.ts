/**
 * System One 判斷介面的領域型別：是非、單選、評分三種問法。
 *
 * 介面不綁供應商；Jev 與小型語言模型的實作在各自檔案，主機只依賴
 * `SystemOneInvoker`。一次呼叫可以送多題，各題獨立，答案以呼叫端給的
 * `key` 對回請求。
 */

/** 是非題：一個陳述為真的機率。沒有另外的置信度。 */
export interface YesNoQuestion {
  readonly kind: "yes-no";
  /** 呼叫端給的穩定鍵；同一請求內唯一。 */
  readonly key: string;
  /** 完整問句。 */
  readonly statement: string;
  /** 怎樣算「是」；省略時用預設文字。 */
  readonly criteriaTrue?: string;
  /** 怎樣算「否」；省略時用預設文字。 */
  readonly criteriaFalse?: string;
}

/** 單選題的一個選項。 */
export interface SystemOneOption {
  /** 回傳時指名的穩定鍵。 */
  readonly key: string;
  /** 給判斷者的說明。 */
  readonly label: string;
}

/** 單選題：從固定選項中選一個，回傳機率分佈。 */
export interface ChoiceQuestion {
  readonly kind: "choice";
  readonly key: string;
  readonly statement: string;
  /** 2–255 個選項；超過 255 個在驗證時拒絕（Jev 欄位上限）。 */
  readonly options: readonly SystemOneOption[];
}

/** 評分題：依由低到高的有序等級評分。 */
export interface ScoreQuestion {
  readonly kind: "score";
  readonly key: string;
  readonly statement: string;
  /** 由低到高 2–10 個等級。 */
  readonly levels: readonly string[];
}

/** 一次判斷請求中的一道題目。 */
export type SystemOneQuestion = YesNoQuestion | ChoiceQuestion | ScoreQuestion;

export interface YesNoAnswer {
  readonly kind: "yes-no";
  readonly key: string;
  /** 0–1，代表「是」的機率。 */
  readonly probability: number;
}

export interface ChoiceAnswer {
  readonly kind: "choice";
  readonly key: string;
  /** 選中的選項鍵。 */
  readonly choice: string;
  /** 機率分佈的集中度，不是正確率。 */
  readonly confidence: number;
  /** 各選項機率，總和為 1。 */
  readonly distribution: Readonly<Record<string, number>>;
}

export interface ScoreAnswer {
  readonly kind: "score";
  readonly key: string;
  /** 期望等級，可為小數（實測 1.47）。 */
  readonly expected: number;
  /**
   * 機率分佈的集中度，不是正確率。評分題的 `confidence` 天生偏低
   * （實測 0.26–0.31）；判斷穩不穩要看 `expected` 的重複差異。
   */
  readonly confidence: number;
  /** 各等級的機率，鍵是等級的索引字串（`"0"`…`"n-1"`），總和為 1。 */
  readonly distribution: Readonly<Record<string, number>>;
}

export type SystemOneAnswer = YesNoAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneJudgeRequest {
  /**
   * 共用上下文。Jev 路徑直接放進請求的 `state`；只放判斷需要的內容，
   * 不送金鑰與無關的對話資料。
   */
  readonly state: unknown;
  readonly questions: readonly SystemOneQuestion[];
  /** 這次判斷的逾時毫秒數；省略時由實作決定。 */
  readonly timeoutMs?: number;
}

export interface SystemOneJudgeResult {
  /** 依請求的題目順序排列；沒有拿到答案的題目不在這裡。 */
  readonly answers: readonly SystemOneAnswer[];
  /** 沒有拿到答案的鍵（例如模型實作逐題失敗的那些）。呼叫端決定怎麼處理。 */
  readonly missing: readonly string[];
}

/** System One 的判斷介面；實作有三種：Jev、小型語言模型、無。 */
export interface SystemOneInvoker {
  judge(request: SystemOneJudgeRequest): Promise<SystemOneJudgeResult>;
}

/** 是非題沒有指定判定文字時使用的預設。 */
export const DEFAULT_YES_CRITERIA = "這個陳述為真。";
export const DEFAULT_NO_CRITERIA = "這個陳述不成立。";

export type SystemOneErrorCode = "invalid-question" | "invalid-response" | "timeout" | "http";

/** System One 的失敗；呼叫端一律走退路，不讓開場卡住。 */
export class SystemOneError extends Error {
  readonly code: SystemOneErrorCode;
  /** HTTP 失敗時的狀態碼。 */
  readonly status: number | undefined;

  constructor(
    code: SystemOneErrorCode,
    message: string,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SystemOneError";
    this.code = code;
    this.status = options.status;
  }
}
