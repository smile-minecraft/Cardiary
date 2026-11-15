/**
 * 上下文服務：視圖、加入、移除、壓縮排程與用量記錄。
 *
 * 對外的形狀是 `@cardiary/domain` 的 `ContextService`；`attach` 是主機
 * 內部的接縫，閘道在 `session.create` 之後、回客戶端之前呼叫它，讓用量
 * 與自動壓縮從第一輪就開始追。
 */

import {
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_RESERVE_TOKENS,
  budgetTokensOf,
  isCompactionDue,
  type ContextService,
  type ContextView,
} from "@cardiary/domain";
import type { ConversationId, EngineSubscription, JsonValue } from "@cardiary/engine-adapter";
import type { ModelInvoker, ProtocolEventEmitter } from "@cardiary/module-api";

import type { HostEngine } from "../engine/types.js";
import { ContextAssembler, type ContextBudget } from "./assembler.js";
import { ContextCompactor, type CompactionTrigger } from "./compactor.js";
import type { ContextStore } from "./store.js";

/** 主模型還沒解析出來時的保守上限；介面會標明是估算。 */
export const DEFAULT_CONTEXT_WINDOW = 131_072;

/** 主機的模型服務多出來的部分；沒有提供時只用 `ModelInvoker`。 */
interface ModelServiceLike extends ModelInvoker {
  role?(role: "main"): {
    readonly ref: { readonly providerId: string; readonly modelId: string } | null;
  };
  readonly state?: {
    readonly providers: readonly {
      readonly providerId: string;
      readonly models: readonly { readonly modelId: string; readonly contextWindow: number }[];
    }[];
  };
}

export interface ContextServiceImplOptions {
  readonly store: ContextStore;
  readonly assembler: ContextAssembler;
  readonly compactor: ContextCompactor;
  readonly engine: HostEngine;
  readonly models: ModelInvoker;
  readonly protocol: ProtocolEventEmitter;
  readonly now?: () => Date;
  readonly settingNumber?: (key: string, fallback: number) => number;
  /** 主模型的上下文上限；省略時從模型服務解析。 */
  readonly contextWindow?: () => number;
  readonly warn?: (message: string, fields?: { readonly [key: string]: string | number }) => void;
}

/** 上下文服務的實作；`attach` 之外的形狀與領域介面相同。 */
export class ContextServiceImpl implements ContextService {
  readonly #store: ContextStore;
  readonly #assembler: ContextAssembler;
  readonly #compactor: ContextCompactor;
  readonly #engine: HostEngine;
  readonly #models: ModelInvoker;
  readonly #protocol: ProtocolEventEmitter;
  readonly #now: () => Date;
  readonly #settingNumber: (key: string, fallback: number) => number;
  readonly #contextWindow: (() => number) | undefined;
  readonly #warn: ContextServiceImplOptions["warn"];
  readonly #subscriptions = new Map<string, EngineSubscription>();

  constructor(options: ContextServiceImplOptions) {
    this.#store = options.store;
    this.#assembler = options.assembler;
    this.#compactor = options.compactor;
    this.#engine = options.engine;
    this.#models = options.models;
    this.#protocol = options.protocol;
    this.#now = options.now ?? (() => new Date());
    this.#settingNumber = options.settingNumber ?? ((_key, fallback) => fallback);
    this.#contextWindow = options.contextWindow;
    this.#warn = options.warn;
  }

  /** 目前視圖；不會改變版本。 */
  async view(sessionId: string): Promise<ContextView> {
    await this.attach(sessionId);
    return this.#assembler.view(sessionId);
  }

  async addCard(input: {
    readonly sessionId: string;
    readonly cardId: string;
  }): Promise<ContextView> {
    await this.attach(input.sessionId);
    const view = await this.#assembler.addCard(input.sessionId, input.cardId);
    await this.#pushPrefix(input.sessionId);
    this.#emitChanged(view);
    this.#scheduleIfDue(input.sessionId, view);
    return view;
  }

  async removeCard(input: {
    readonly sessionId: string;
    readonly cardId: string;
  }): Promise<ContextView> {
    await this.attach(input.sessionId);
    const view = await this.#assembler.removeCard(input.sessionId, input.cardId);
    this.#emitChanged(view);
    return view;
  }

  async compact(input: {
    readonly sessionId: string;
    readonly instructions?: string;
  }): Promise<{ readonly scheduled: boolean }> {
    await this.attach(input.sessionId);
    void this.#runCompaction(input.sessionId, "manual", input.instructions);
    return { scheduled: true };
  }

  /**
   * 接上用量與自動壓縮；重複呼叫是安全的。
   *
   * 第一次接上時先把目前的固定前綴推給引擎，新對話的第一輪就看得到第
   * 1 到 6 層，不必等使用者加入卡片。閘道在建立對話後呼叫；`context.*`
   * 的請求也會自己接上，讓沒有經過閘道接縫的測試與舊資料仍能運作。
   */
  async attach(sessionId: string): Promise<void> {
    if (this.#subscriptions.has(sessionId)) return;
    this.#assembler.ensure(sessionId);
    // 上次壓縮中斷時先補完，再推前綴與訂閱；這裡的引擎已經開啟。
    if (this.#store.read(sessionId)?.compactionInProgress === true) {
      await this.#compactor.compact(sessionId, { trigger: "recovery" });
    }
    await this.#pushPrefix(sessionId);
    let subscription: EngineSubscription;
    try {
      subscription = this.#engine.subscribe({ conversationId: sessionId as ConversationId });
    } catch (error) {
      this.#warn?.("訂閱對話事件失敗；上下文仍可讀取", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.#subscriptions.set(sessionId, subscription);
    void this.#consume(sessionId, subscription);
  }

  async #consume(sessionId: string, subscription: EngineSubscription): Promise<void> {
    try {
      for await (const event of subscription.events) {
        const kind = (event as { kind?: string }).kind;
        if (kind === "turn.completed") {
          const turnId = (event as { turnId?: string }).turnId;
          await this.recordUsage(sessionId, turnId ?? `${this.#now().getTime()}`);
        }
      }
    } catch (error) {
      this.#warn?.("對話事件串流結束", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 讀取最近一輪用量並記錄；沒有用量時跳過。 */
  async recordUsage(sessionId: string, turnId: string): Promise<void> {
    if (typeof this.#engine.readConversationUsage !== "function") return;
    const usage = await this.#engine.readConversationUsage(sessionId as ConversationId);
    if (usage === null) return;
    this.#store.recordUsage({
      conversationId: sessionId,
      turnId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      requestTokens: usage.requestTokens,
      recordedAt: this.#now().toISOString(),
    });
    const view = await this.#assembler.view(sessionId);
    this.#emitChanged(view);
    this.#scheduleIfDue(sessionId, view);
  }

  /** 目前主模型的上下文上限；解析不到時用保守預設。 */
  contextWindow(): number {
    if (this.#contextWindow !== undefined) return this.#contextWindow();
    const models = this.#models as ModelServiceLike;
    const ref = models.role?.("main").ref ?? null;
    if (ref !== null && models.state !== undefined) {
      for (const provider of models.state.providers) {
        if (provider.providerId !== ref.providerId) continue;
        for (const model of provider.models) {
          if (model.modelId === ref.modelId && model.contextWindow > 0) {
            return model.contextWindow;
          }
        }
      }
    }
    return DEFAULT_CONTEXT_WINDOW;
  }

  /** 目前的預算；由主模型與設定決定。 */
  budget(): ContextBudget {
    return {
      contextWindow: this.contextWindow(),
      reserveTokens: Math.max(
        0,
        this.#settingNumber("context.reserveTokens", DEFAULT_RESERVE_TOKENS),
      ),
      compactionThreshold: clampThreshold(
        this.#settingNumber("context.compactionThreshold", DEFAULT_COMPACTION_THRESHOLD),
      ),
    };
  }

  /** 關閉所有訂閱；停用模組時呼叫。 */
  close(): void {
    for (const subscription of this.#subscriptions.values()) {
      subscription.close();
    }
    this.#subscriptions.clear();
  }

  #scheduleIfDue(sessionId: string, view: ContextView): void {
    if (!isCompactionDue(view)) return;
    void this.#runCompaction(sessionId, "threshold", undefined);
  }

  async #runCompaction(
    sessionId: string,
    trigger: CompactionTrigger,
    instructions: string | undefined,
  ): Promise<void> {
    await this.#compactor.compact(sessionId, {
      trigger,
      ...(instructions === undefined ? {} : { instructions }),
    });
  }

  /**
   * 把目前的固定前綴推給引擎；引擎不支援時不做事。
   *
   * 推送失敗不影響讀取視圖：記一筆警告，下一次加入卡片或下次啟動會再送。
   */
  async #pushPrefix(sessionId: string): Promise<void> {
    if (typeof this.#engine.configureConversationContext !== "function") return;
    try {
      const assembled = await this.#assembler.assemble(sessionId);
      await this.#engine.configureConversationContext(sessionId, assembled.systemContext);
    } catch (error) {
      this.#warn?.("推送對話前綴失敗；第一輪可能看不到分層", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #emitChanged(view: ContextView): void {
    this.#protocol.emit({
      kind: "context-changed",
      conversationId: view.sessionId as ConversationId,
      context: view as unknown as JsonValue,
    });
  }
}

/** 壓縮完成時由模組轉送的事件；放在服務旁邊讓形狀只有一份。 */
export interface ContextCompactedPayload {
  readonly sessionId: string;
  readonly summaryCardId: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly compactedAt: string;
}

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_COMPACTION_THRESHOLD;
  return Math.min(0.95, Math.max(0.1, value));
}

/** 服務用得到但不需要公開的預算換算。 */
export function budgetOf(budget: ContextBudget): number {
  return budgetTokensOf(budget.contextWindow, budget.reserveTokens);
}
