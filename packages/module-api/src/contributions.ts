import type {
  ConversationId,
  IsoInstant,
  ToolCallId,
  ToolDiagnostic,
  ToolName,
  TurnId,
} from "@cardiary/engine-adapter";
import type { CardChangeKind } from "./protocol.js";

/**
 * 固定前綴的八層；順序由前往後，模組只能把區段放進對應的層，
 * 不能自行插入別人的前面。
 */
export type ContextLayerName =
  | "bedrock"
  | "persona"
  | "core-memory"
  | "opening-memory"
  | "short-term-memory"
  | "other-cards"
  | "working-context"
  | "volatile-state";

/** 產生上下文區段時的輸入。 */
export interface ContextRenderInput {
  readonly conversationId: ConversationId;
  readonly trigger: "opening" | "turn" | "compaction";
  readonly tokenBudget: number;
  readonly now: IsoInstant;
}

/** 一個上下文區段的內容。 */
export interface ContextSectionContent {
  readonly text: string;
  readonly tokenEstimate?: number;
  /** 這段文字引用了哪些卡片，用於上下文面板與新鮮度。 */
  readonly sourceCards?: readonly string[];
}

/**
 * 模組提供的上下文區段。
 *
 * 回傳 `null` 表示這次沒有內容，不要回傳空字串佔位置。
 */
export interface ContextSectionContribution {
  readonly sectionId: string;
  readonly layer: ContextLayerName;
  readonly title: string;
  /** 同一層內的排序；越小越前面，省略時排在該層最後。 */
  readonly order?: number;
  render(input: ContextRenderInput): Promise<ContextSectionContent | null>;
}

/** 一輪開始前的掛鉤輸入。 */
export interface BeforeTurnContext {
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
  readonly trigger: "user-message" | "resume" | "schedule" | "background-task";
  readonly userText: string | null;
  readonly tokenBudget: number;
  readonly now: IsoInstant;
}

/** 掛鉤可以追加的內容；不能修改既有前綴。 */
export interface HookContextInjection {
  readonly sections: readonly ContextSectionContent[];
}

/** 一輪開始前的掛鉤結果；省略等於不追加。 */
export type BeforeTurnResult = HookContextInjection | void;

/** 一輪結束後的掛鉤輸入。 */
export interface AfterTurnContext {
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
  readonly status: "completed" | "cancelled" | "paused" | "failed" | "interrupted";
  readonly assistantText: string | null;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly now: IsoInstant;
}

/** 一輪中使用過的其中一次工具呼叫。 */
export interface ToolCallRecord {
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly ok: boolean;
  readonly diagnostics: readonly ToolDiagnostic[];
}

/** 一次工具結束後的掛鉤輸入。 */
export interface AfterToolContext {
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly ok: boolean;
  readonly diagnostics: readonly ToolDiagnostic[];
  readonly now: IsoInstant;
}

/** 壓縮前的掛鉤輸入。 */
export interface BeforeCompactionContext {
  readonly conversationId: ConversationId;
  readonly beforeTokens: number;
  readonly now: IsoInstant;
}

/** 壓縮後的掛鉤輸入。 */
export interface AfterCompactionContext {
  readonly conversationId: ConversationId;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly now: IsoInstant;
}

/** 卡片變更的掛鉤輸入。 */
export interface CardChangedContext {
  readonly cardId: string;
  readonly change: CardChangeKind;
  readonly now: IsoInstant;
}

/** 對話開啟或關閉的掛鉤輸入。 */
export interface ConversationLifecycleContext {
  readonly conversationId: ConversationId;
  readonly now: IsoInstant;
}

/**
 * 模組可以掛的鉤子。
 *
 * 掛鉤只做觀察與追加內容，不能核准工具、不能改權限判斷結果。
 * 耗時的工作要自行限制時間，不能阻塞其他模組。
 */
export type HookDeclaration =
  | {
      readonly point: "before-turn";
      handler(context: BeforeTurnContext): Promise<BeforeTurnResult> | BeforeTurnResult;
    }
  | {
      readonly point: "after-turn";
      handler(context: AfterTurnContext): Promise<void> | void;
    }
  | {
      readonly point: "after-tool";
      handler(context: AfterToolContext): Promise<void> | void;
    }
  | {
      readonly point: "before-compaction";
      handler(context: BeforeCompactionContext): Promise<BeforeTurnResult> | BeforeTurnResult;
    }
  | {
      readonly point: "after-compaction";
      handler(context: AfterCompactionContext): Promise<void> | void;
    }
  | {
      readonly point: "card-changed";
      handler(context: CardChangedContext): Promise<void> | void;
    }
  | {
      readonly point: "conversation-opened";
      handler(context: ConversationLifecycleContext): Promise<void> | void;
    }
  | {
      readonly point: "conversation-closing";
      handler(context: ConversationLifecycleContext): Promise<void> | void;
    };

/**
 * 排程的觸發方式。
 *
 * `cron` 目前只支援每日一次的簡單運算式 `mm HH * * *`（可省略分、時的前導
 * 零）與 `timezone: "local"`；主機會把它物化成每日排程，其他運算式不會
 * 物化，需要更細的週期請改用 `interval` 或 `heartbeat`。
 */
export type ScheduleTrigger =
  | { readonly kind: "cron"; readonly expression: string; readonly timezone?: string }
  | { readonly kind: "interval"; readonly everyMs: number }
  /** Heartbeat：固定間隔醒來，沒事就不產生通知。 */
  | { readonly kind: "heartbeat"; readonly everyMs: number; readonly idleOnly?: boolean };

/** 內建排程被執行時交給排程器的工作種類；省略時視為每日蒸餾。 */
export type ScheduleTaskDeclaration =
  { readonly type: "distillation" } | { readonly type: "agent"; readonly prompt: string };

/** 排程觸發時的執行環境。 */
export interface ScheduleRunContext {
  readonly scheduleId: string;
  readonly firedAt: IsoInstant;
  readonly signal: AbortSignal;
}

/**
 * 模組提供的排程定義。
 *
 * `requiresApproval` 為 true 時，啟用這個排程要人工核准；代理提出的
 * 排程一律走審批，不能自己新增。`defaultEnabled` 只在模組首次啟用時參考。
 * 主機會把宣告持久化成排程表的一列，之後使用者改過的時間與啟停狀態
 * 以排程表為準；宣告帶 `task` 時，主機執行排程就交給它，省略時照既有的
 * 每日蒸餾行為處理。
 */
export interface ScheduleDeclaration {
  readonly scheduleId: string;
  readonly title: string;
  readonly description?: string;
  readonly trigger: ScheduleTrigger;
  readonly defaultEnabled: boolean;
  readonly requiresApproval: boolean;
  readonly task?: ScheduleTaskDeclaration;
  run(context: ScheduleRunContext): Promise<void>;
}
