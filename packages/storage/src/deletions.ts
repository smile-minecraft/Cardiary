import { readFileSync } from "node:fs";
import path from "node:path";

import type { Database, Queryable } from "./db.js";
import { ApprovalLedger } from "./approvals.js";
import { assetIdsInText, listAssetFiles } from "./cards/asset-scan.js";
import { LocalAssetStore } from "./cards/assets.js";
import { CardIndexStore } from "./cards/index-store.js";
import { RequestDedupeStore } from "./dedupe.js";
import { StorageError } from "./errors.js";
import { deleteConversationRows } from "./freshness/conversations.js";
import { removeFileSafely, type FolderLayout } from "./paths.js";
import { EventLog } from "./events.js";
import type { FileRegistry } from "./registry.js";
import { TurnIndex } from "./turns.js";
import { nowIso, tryParseJson } from "./util.js";

/** `clientRequestId` 的正向索引文件：key 是 `clientRequestId`，值指向對話。 */
export const CLIENT_REQUEST_FORWARD_KIND = "cardiary.clientRequestId";
/** 反向索引文件：key 是對話 ID，值是 `clientRequestId`。 */
export const CLIENT_REQUEST_REVERSE_KIND = "cardiary.clientRequestId.reverse";

export type DeletionPhase = "rows" | "vacuum";

export interface ConversationDeletionIntent {
  readonly rootId: string;
  readonly conversationIds: readonly string[];
  readonly clientRequestIds: readonly string[];
  /**
   * 這筆刪除會一起移除的專屬卡片；寫入意圖時由 `conversation_cards` 算出。
   *
   * 恢復時用它刪卡片檔，不依賴索引或引擎的對話列。
   */
  readonly cardIds?: readonly string[];
  /** 專屬卡片引用過的原檔候選；真正刪除前仍會掃描所有卡片檔確認。 */
  readonly assetIds?: readonly string[];
  readonly phase: DeletionPhase;
  readonly requestedAt: string;
  readonly updatedAt: string;
}

export interface DeletionHooks {
  /** 停止整個服務的工具；必須等到沒有工具在寫檔才回來。 */
  readonly stopTools?: () => Promise<void>;
  readonly closeHarness?: () => Promise<void>;
  readonly openHarness?: () => Promise<void>;
  /** 測試注入：Cardiary 交易提交後中斷。 */
  readonly onAfterCardiaryCommit?: () => void;
  /** 測試注入：真空階段開始前中斷。 */
  readonly onVacuumStart?: () => void;
  /** 測試注入：每刪完一個登記檔後呼叫；用來模擬檔案刪一半的崩潰窗口。 */
  readonly onAfterFileDelete?: (relativePath: string) => void;
  /** M1 的工具呼叫識別碼；有值時一併清掉對應的登記列。 */
  readonly toolCallIds?: readonly string[];
}

export interface DeletionTableCounts {
  readonly eventLog: number;
  readonly approvals: number;
  readonly turnIndex: number;
  readonly requestDedupe: number;
  readonly subagentRuns: number;
  readonly fileRegistry: number;
  readonly nextTurnInjections: number;
  readonly conversations: number;
  readonly conversationCards: number;
  readonly conversationContext: number;
  readonly contextEntries: number;
  readonly conversationUsage: number;
  readonly cardState: number;
  readonly engineConversations: number;
  readonly engineEntries: number;
  readonly engineTasks: number;
  readonly engineSubmissions: number;
  readonly engineDocuments: number;
  readonly engineDocumentRevisions: number;
  readonly engineRecordIds: number;
}

export interface DeletionReport {
  readonly rootId: string;
  readonly deleted: boolean;
  readonly conversationIds: readonly string[];
  readonly counts: DeletionTableCounts;
  readonly stateSizeBefore: number;
  readonly stateSizeAfter: number;
  readonly engineSizeBefore: number;
  readonly engineSizeAfter: number;
}

export interface DeletionServiceOptions {
  readonly state: Database;
  readonly engine: Database;
  readonly layout: FolderLayout;
  readonly registry: FileRegistry;
  readonly resetCacheIndex: () => void;
  /** 快取索引的連線會換，所以用 getter；刪除卡片後用它清索引列與原檔。 */
  readonly cache: () => Database;
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
}

interface IntentRow {
  readonly root_id: string;
  readonly conversation_ids: string;
  readonly client_request_ids: string;
  readonly card_ids: string;
  readonly asset_ids: string;
  readonly phase: string;
  readonly requested_at: string;
  readonly updated_at: string;
}

interface ConversationRow {
  readonly id: number;
  readonly owner_conversation_id: number | null;
  readonly record: string;
}

interface DocumentRow {
  readonly id: number;
  readonly kind: string;
  readonly key_value: string;
  readonly scope_kind: string;
  readonly owner_id: number;
  readonly record: string;
}

interface IdRow {
  readonly id: number;
}

/**
 * 對話刪除：Cardiary 交易、引擎交易、跨資料庫的意圖列與崩潰恢復。
 *
 * 兩個資料庫不能共用交易；`conversation_deletions` 是收斂依據。
 */
export class ConversationDeletionService {
  readonly #state: Database;
  readonly #engine: Database;
  readonly #registry: FileRegistry;
  readonly #resetCacheIndex: () => void;
  readonly #cache: () => Database;
  readonly #now: () => Date;
  readonly #trace: (operation: string) => void;
  readonly #layout: FolderLayout;

  constructor(options: DeletionServiceOptions) {
    this.#state = options.state;
    this.#engine = options.engine;
    this.#registry = options.registry;
    this.#resetCacheIndex = options.resetCacheIndex;
    this.#cache = options.cache;
    this.#now = options.now ?? (() => new Date());
    this.#trace = options.trace ?? (() => {});
    this.#layout = options.layout;
  }

  /** 列出尚未完成的刪除意圖；啟動時在開 Harness 之前處理。 */
  listPendingDeletions(): ConversationDeletionIntent[] {
    return this.#state
      .all<IntentRow>("SELECT * FROM conversation_deletions ORDER BY requested_at")
      .map(rowToIntent);
  }

  /**
   * 刪除一場對話與整個支線子樹。
   *
   * 流程：停止工具 → 關閉 Harness → 寫意圖 → Cardiary 交易 → 引擎交易
   * → phase=vacuum → checkpoint／incremental_vacuum／integrity_check
   * → 清 tmp／重建快取 → 刪意圖 → 重開 Harness。
   */
  async deleteConversation(rootId: string, hooks: DeletionHooks = {}): Promise<DeletionReport> {
    await hooks.stopTools?.();
    // 提早返回或任何例外都要把 Harness 回到原本開著的狀態；真正行程崩潰
    // 不會執行 finally，下一次啟動由刪除意圖恢復。
    const shouldReopenHarness = hooks.closeHarness !== undefined;
    try {
      await hooks.closeHarness?.();

      const existing = this.getIntent(rootId);
      let intent = existing;
      if (intent === null) {
        const conversationIds = listConversationSubtree(this.#engine, rootId);
        if (conversationIds.length === 0) {
          // 找不到對話列時仍清掉殘留索引與 record_ids；這是冪等重試的一部分。
          this.cleanupResidualEngine();
          return emptyReport(rootId);
        }
        const clientRequestIds = listClientRequestIds(this.#engine, conversationIds);
        intent = this.insertIntent({
          rootId,
          conversationIds,
          clientRequestIds,
          phase: "rows",
          requestedAt: nowIso(this.#now),
          updatedAt: nowIso(this.#now),
        });
      }

      const stateSizeBefore = this.#state.fileSize();
      const engineSizeBefore = this.#engine.fileSize();

      let counts = emptyCounts();
      if (intent.phase === "rows") {
        const taskIds = listTaskIds(this.#engine, intent.conversationIds);
        counts = this.deleteCardiaryRows(
          intent,
          taskIds,
          hooks.toolCallIds ?? [],
          hooks.onAfterFileDelete,
        );
        hooks.onAfterCardiaryCommit?.();
        const engineCounts = deleteEngineRows(
          this.#engine,
          intent.conversationIds,
          intent.clientRequestIds,
        );
        counts = { ...counts, ...engineCounts };
        this.updatePhase(rootId, "vacuum");
      }

      hooks.onVacuumStart?.();
      this.vacuum(intent);
      this.deleteIntent(rootId);
      this.#trace("deletion:complete");

      return {
        rootId,
        deleted: true,
        conversationIds: intent.conversationIds,
        counts,
        stateSizeBefore,
        stateSizeAfter: this.#state.fileSize(),
        engineSizeBefore,
        engineSizeAfter: this.#engine.fileSize(),
      };
    } finally {
      if (shouldReopenHarness) {
        await hooks.openHarness?.();
      }
    }
  }

  /**
   * 啟動時先完成未結束的刪除，才建立 Harness。
   *
   * `openHarness` 在全部意圖完成後才呼叫；任何一步失敗都留在原 phase，
   * 下次啟動再試。
   */
  async recoverAtStartup(
    hooks: { readonly openHarness?: () => Promise<void> } = {},
  ): Promise<number> {
    const pending = this.listPendingDeletions();
    for (const intent of pending) {
      if (intent.phase === "rows") {
        const taskIds = listTaskIds(this.#engine, intent.conversationIds);
        this.deleteCardiaryRows(intent, taskIds, []);
        deleteEngineRows(this.#engine, intent.conversationIds, intent.clientRequestIds);
        this.updatePhase(intent.rootId, "vacuum");
      }
      this.vacuum(intent);
      this.deleteIntent(intent.rootId);
    }
    await hooks.openHarness?.();
    return pending.length;
  }

  /** 診斷用：某個根是否還有意圖列。 */
  getIntent(rootId: string): ConversationDeletionIntent | null {
    const row = this.#state.get<IntentRow>(
      "SELECT * FROM conversation_deletions WHERE root_id = ?",
      rootId,
    );
    return row === undefined ? null : rowToIntent(row);
  }

  /**
   * 寫入刪除意圖；同一個 root 已有意圖時保留原本的內容。
   *
   * 給跨資料庫刪除的呼叫端使用：引擎轉接層先把意圖落地，才開始刪任何列。
   */
  putIntent(intent: ConversationDeletionIntent): void {
    if (this.getIntent(intent.rootId) !== null) {
      return;
    }
    this.insertIntent(intent);
  }

  /** 推進意圖的階段；只有 `rows` 與 `vacuum` 兩個值。 */
  setIntentPhase(rootId: string, phase: DeletionPhase): void {
    this.updatePhase(rootId, phase);
  }

  /** 刪掉意圖列；刪除完成或呼叫端已自行完成收斂時使用。 */
  removeIntent(rootId: string): void {
    const intent = this.getIntent(rootId);
    if (intent !== null) {
      // 引擎路徑（`purge` → 引擎交易 → `removeIntent`）沒有 storage 的
      // `vacuum`；卡片檔要在這裡補刪。重試時檔案已不在，操作是冪等的。
      this.completeCardDeletion(intent);
    }
    this.deleteIntent(rootId);
  }

  /**
   * 刪掉意圖裡的專屬卡片檔，再收掉索引列與沒有其他卡片引用的原檔。
   *
   * 卡片狀態列已由 `deleteCardiaryRows` 的交易處理；卡片檔、`card_index`
   * 與原檔都在這裡收。重啟恢復只會走到這個方法（`removeIntent`），所以
   * 不在這裡收的話，`card.list` 會看到幽靈卡，原檔也要等下一次啟動掃描
   * 才回收。被另一個對話引用或釘在白板的卡片一律保留。
   */
  completeCardDeletion(intent: ConversationDeletionIntent): { readonly deletedCards: number } {
    let deletedCards = 0;
    const removed: string[] = [];
    for (const cardId of intent.cardIds ?? []) {
      const refs = this.#state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM conversation_cards WHERE card_id = ?",
        cardId,
      );
      if (Number(refs?.n ?? 0) > 0) {
        continue;
      }
      const state = this.#state.get<{ pinned: number }>(
        "SELECT pinned FROM card_state WHERE card_id = ?",
        cardId,
      );
      if ((state?.pinned ?? 0) === 1) {
        continue;
      }
      try {
        const absolutePath = this.#layout.absolute(`cards/${cardId}.md`);
        removeFileSafely(this.#layout, absolutePath, ["origin"]);
      } catch {
        // 單張卡刪不掉不能讓整個對話的刪除卡住；留著的是孤兒卡片檔，
        // 下次啟動掃描仍會看到它，不會被誤認成已刪。
        this.#trace("deletion:card-file-failed");
        continue;
      }
      this.#state.run("DELETE FROM card_state WHERE card_id = ?", cardId);
      deletedCards += 1;
      removed.push(cardId);
      this.#trace("deletion:card-removed");
    }
    this.#finishCardRemoval(removed, intent.assetIds ?? []);
    return { deletedCards };
  }

  /**
   * 卡片檔刪完後的收尾：清掉快取索引的列，回收沒有其他卡片檔引用的原檔。
   *
   * 原檔的回收規則與 `LocalAssetStore` 共用一份（`releaseCandidates`）：
   * 索引未完成或掃描不到卡片檔就整批跳過；有任何卡片檔寫著這個雜湊就保留。
   * 索引未完成同時代表其他查詢也不可信，寧可晚一點刪（設計見
   * `docs/design/cards.md` 第 5 節）。索引列照樣先刪——幽靈列留著會讓
   * `card.list` 看到已刪的卡。
   */
  #finishCardRemoval(cardIds: readonly string[], assetIds: readonly string[]): void {
    let index: CardIndexStore | null = null;
    const indexStore = (): CardIndexStore => {
      if (index === null) {
        index = new CardIndexStore({ db: this.#cache(), now: this.#now });
      }
      return index;
    };
    for (const cardId of cardIds) {
      try {
        indexStore().remove(cardId);
      } catch {
        // 索引壞掉不能擋住刪除；下一次啟動掃描會重建。
        this.#trace("deletion:index-cleanup-failed");
        break;
      }
    }
    if (assetIds.length === 0) {
      return;
    }
    try {
      const assets = new LocalAssetStore({
        layout: this.#layout,
        index: indexStore(),
        now: this.#now,
        trace: this.#trace,
      });
      const result = assets.releaseCandidates(assetIds);
      if (result.skipped) {
        this.#trace("deletion:asset-reclaim-skipped");
        return;
      }
      if (result.reclaimed.length > 0) {
        this.#trace("deletion:assets-removed");
      }
    } catch {
      // 回收失敗不能擋住刪除意圖；留下的原檔由啟動掃描再試。
      this.#trace("deletion:asset-removal-failed");
    }
  }

  /**
   * 只清 Cardiary 這一半的列：事件、審批、回合對照、去重、子代理與登記簿。
   *
   * 引擎的列由轉接層自己刪；這個方法讓兩個資料庫各自只有一個權威，
   * 但共用同一份意圖與同一段交易順序。
   */
  purgeCardiaryRows(intent: {
    readonly rootId: string;
    readonly conversationIds: readonly string[];
    readonly clientRequestIds: readonly string[];
  }): DeletionTableCounts {
    const stored = this.getIntent(intent.rootId);
    const full: ConversationDeletionIntent = {
      rootId: intent.rootId,
      conversationIds: intent.conversationIds,
      clientRequestIds: intent.clientRequestIds,
      ...(stored?.cardIds === undefined ? {} : { cardIds: stored.cardIds }),
      ...(stored?.assetIds === undefined ? {} : { assetIds: stored.assetIds }),
      phase: "rows",
      requestedAt: "",
      updatedAt: "",
    };
    return this.deleteCardiaryRows(full, listTaskIds(this.#engine, intent.conversationIds), []);
  }

  private insertIntent(intent: ConversationDeletionIntent): ConversationDeletionIntent {
    const cardIds = intent.cardIds ?? this.#exclusiveCardIds(intent.conversationIds);
    const assetIds = intent.assetIds ?? this.#assetIdsOf(cardIds);
    this.#state.run(
      `INSERT INTO conversation_deletions
         (root_id, conversation_ids, client_request_ids, card_ids, asset_ids, phase, requested_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      intent.rootId,
      JSON.stringify(intent.conversationIds),
      JSON.stringify(intent.clientRequestIds),
      JSON.stringify(cardIds),
      JSON.stringify(assetIds),
      intent.phase,
      intent.requestedAt,
      intent.updatedAt,
    );
    this.#trace("deletion:intent-written");
    return { ...intent, cardIds, assetIds };
  }

  private updatePhase(rootId: string, phase: DeletionPhase): void {
    this.#state.run(
      "UPDATE conversation_deletions SET phase = ?, updated_at = ? WHERE root_id = ?",
      phase,
      nowIso(this.#now),
      rootId,
    );
    this.#trace("deletion:phase-vacuum");
  }

  private deleteIntent(rootId: string): void {
    this.#state.run("DELETE FROM conversation_deletions WHERE root_id = ?", rootId);
  }

  /**
   * 寫入意圖時算出專屬卡片：只被這些對話引用、而且沒釘在白板。
   *
   * 結果是候選；真正刪檔前會再確認一次，刪除期間新增的引用不會被誤刪。
   */
  #exclusiveCardIds(conversationIds: readonly string[]): string[] {
    if (conversationIds.length === 0) return [];
    const wanted = new Set(conversationIds);
    const rows = this.#state.all<{ card_id: string; conversation_id: string }>(
      "SELECT card_id, conversation_id FROM conversation_cards",
    );
    const referenced = new Set<string>();
    for (const row of rows) {
      if (wanted.has(row.conversation_id)) referenced.add(row.card_id);
    }
    const refsByCard = new Map<string, string[]>();
    for (const row of rows) {
      if (!referenced.has(row.card_id)) continue;
      const refs = refsByCard.get(row.card_id) ?? [];
      refs.push(row.conversation_id);
      refsByCard.set(row.card_id, refs);
    }
    const result: string[] = [];
    for (const cardId of referenced) {
      const outside = (refsByCard.get(cardId) ?? []).some(
        (conversationId) => !wanted.has(conversationId),
      );
      if (outside) continue;
      const state = this.#state.get<{ pinned: number }>(
        "SELECT pinned FROM card_state WHERE card_id = ?",
        cardId,
      );
      if ((state?.pinned ?? 0) === 1) continue;
      result.push(cardId);
    }
    return result.sort();
  }

  /**
   * 卡片檔裡出現的原檔候選。
   *
   * 與原檔回收用同一條比對規則（`assetIdsInText`）：檔案任何地方出現 64 位
   * 雜湊就算，不解析 frontmatter。讀不到的卡片檔略過，回收時會再掃描一次
   * 確認；多帶候選不會誤刪，少帶才會漏收。
   */
  #assetIdsOf(cardIds: readonly string[]): string[] {
    const directory = this.#layout.subfolderPath("cards");
    const found = new Set<string>();
    for (const cardId of cardIds) {
      const text = loadText(path.join(directory, `${cardId}.md`));
      for (const assetId of text === null ? [] : assetIdsInText(text)) {
        found.add(assetId);
      }
    }
    return [...found].sort();
  }

  private cleanupResidualEngine(): void {
    this.#engine.transaction((tx) => {
      deleteOrphanSessionIndexes(tx);
      deleteOrphanRecordIds(tx);
    });
    this.#engine.checkpoint();
  }

  private deleteCardiaryRows(
    intent: ConversationDeletionIntent,
    taskIds: readonly string[],
    toolCallIds: readonly string[],
    onAfterFileDelete?: (relativePath: string) => void,
  ): DeletionTableCounts {
    const events = new EventLog(this.#state, { now: this.#now });
    const approvals = new ApprovalLedger(this.#state, { now: this.#now });
    const turns = new TurnIndex(this.#state);
    const dedupe = new RequestDedupeStore(this.#state, { now: this.#now });
    const streams = intent.conversationIds.map((id) => `session:${id}` as const);
    const counts = { ...emptyCounts() };
    // 刪列先於刪檔：先記下要刪的檔案，交易提交後再刪。
    const registryFiles = collectRegistryFiles(
      this.#registry,
      intent.conversationIds,
      taskIds,
      toolCallIds,
    );

    this.#state.transaction((tx) => {
      const eventLog = events.deleteStreams(streams, tx);
      const approvalCount = approvals.deleteForSessions(intent.conversationIds, tx);
      const turnCount = turns.deleteForConversations(intent.conversationIds, tx);
      const dedupeCount = dedupe.deleteForConversations(
        intent.conversationIds,
        intent.clientRequestIds,
        tx,
      );
      const nextTurnInjections = countNextTurnRows(tx, intent.conversationIds);
      let subagentRuns = 0;
      for (const conversationId of intent.conversationIds) {
        subagentRuns += tx.run(
          "DELETE FROM subagent_runs WHERE branch_id = ? OR parent_id = ?",
          conversationId,
          conversationId,
        ).changes;
        tx.run("DELETE FROM next_turn_injections WHERE conversation_id = ?", conversationId);
      }
      const fileRegistry = deleteRegistryRows(tx, intent.conversationIds, taskIds, toolCallIds);
      // M1 的對話列：先刪子表與引用，再刪 conversations；刪完引用後才算得出
      // 哪些專屬卡片的狀態列可以一起消失。
      const conversationRows = deleteConversationRows(tx, intent.conversationIds);
      let cardState = 0;
      for (const cardId of intent.cardIds ?? []) {
        cardState += deleteCardStateIfUnreferenced(tx, cardId);
      }

      Object.assign(counts, {
        eventLog,
        approvals: approvalCount,
        turnIndex: turnCount,
        requestDedupe: dedupeCount,
        subagentRuns,
        fileRegistry,
        nextTurnInjections,
        conversations: conversationRows.conversations,
        conversationCards: conversationRows.conversationCards,
        conversationContext: conversationRows.context,
        contextEntries: conversationRows.contextEntries,
        conversationUsage: conversationRows.usage,
        cardState,
      });
    });

    // 交易已提交；現在刪檔案。中途當機只會留下孤兒檔案，掃描會處理。
    deleteRegisteredFiles(this.#layout, registryFiles, onAfterFileDelete);
    return counts;
  }

  private vacuum(intent: ConversationDeletionIntent): void {
    // 兩個資料庫的交易都完成了，才動正本區的卡片檔；重試時是冪等的。
    this.completeCardDeletion(intent);
    this.#state.checkpoint();
    this.#state.incrementalVacuum();
    this.#state.checkpoint();
    this.#engine.checkpoint();
    this.#engine.incrementalVacuum();
    this.#engine.checkpoint();

    // 此時整個服務沒有工具在跑；tmp/ 直接清空。
    this.#registry.clearZone("tmp");
    this.#resetCacheIndex();

    if (this.#state.integrityCheck() !== "ok") {
      throw new StorageError("storage-failed", "Cardiary 資料庫 integrity_check 失敗", {
        rootId: intent.rootId,
      });
    }
    if (this.#engine.integrityCheck() !== "ok") {
      throw new StorageError("storage-failed", "引擎資料庫 integrity_check 失敗", {
        rootId: intent.rootId,
      });
    }
    this.#trace("deletion:vacuum-done");
  }
}

/** 列出根與所有子代；父層關係取自引擎的 `conversations.record.parent`。 */
export function listConversationSubtree(engine: Database, rootId: string): string[] {
  const rows = engine.all<ConversationRow>(
    "SELECT id, owner_conversation_id, record FROM conversations",
  );
  const children = new Map<string, string[]>();
  const known = new Set<string>();
  for (const row of rows) {
    const id = String(row.id);
    known.add(id);
    const parent = readParentId(row);
    if (parent === null) {
      continue;
    }
    const siblings = children.get(parent) ?? [];
    siblings.push(id);
    children.set(parent, siblings);
  }
  if (!known.has(rootId)) {
    return [];
  }
  const result: string[] = [];
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    result.push(current);
    queue.push(...(children.get(current) ?? []));
  }
  return result;
}

/** 由反向索引取得子樹的 `clientRequestId`；正向索引是退路。 */
export function listClientRequestIds(
  engine: Database,
  conversationIds: readonly string[],
): string[] {
  const wanted = new Set(conversationIds);
  const rows = engine.all<DocumentRow>(
    "SELECT id, kind, key_value, scope_kind, owner_id, record FROM documents WHERE scope_kind = 'session' AND kind IN (?, ?)",
    CLIENT_REQUEST_FORWARD_KIND,
    CLIENT_REQUEST_REVERSE_KIND,
  );
  const found = new Set<string>();
  for (const row of rows) {
    const record = parseRecord(row.record);
    const recordConversationId = readString(record, "conversationId");
    const key = parseScalar(row.key_value);
    if (row.kind === CLIENT_REQUEST_REVERSE_KIND) {
      const conversationId = recordConversationId ?? (typeof key === "string" ? key : null);
      const clientRequestId = readString(record, "clientRequestId");
      if (conversationId !== null && wanted.has(conversationId) && clientRequestId !== null) {
        found.add(clientRequestId);
      }
      continue;
    }
    const clientRequestId = typeof key === "string" ? key : readString(record, "clientRequestId");
    if (
      clientRequestId !== null &&
      recordConversationId !== null &&
      wanted.has(recordConversationId)
    ) {
      found.add(clientRequestId);
    }
  }
  return [...found];
}

/** 刪除引擎子樹；回傳每個表刪掉的列數。 */
export function deleteEngineRows(
  engine: Database,
  conversationIds: readonly string[],
  clientRequestIds: readonly string[],
): Partial<DeletionTableCounts> {
  if (conversationIds.length === 0) {
    return {};
  }
  return engine.transaction((tx) => {
    const taskIds = collectIds(
      tx,
      "SELECT id FROM tasks WHERE conversation_id = ?",
      conversationIds,
    );
    const entryIds = collectIds(
      tx,
      "SELECT id FROM entries WHERE conversation_id = ?",
      conversationIds,
    );
    const submissionIds = collectIds(
      tx,
      "SELECT id FROM submissions WHERE conversation_id = ?",
      conversationIds,
    );
    const documentIds = collectDocumentIds(tx, conversationIds, taskIds, clientRequestIds);
    const allRecordIds = [
      ...conversationIds.map(Number),
      ...taskIds,
      ...entryIds,
      ...submissionIds,
      ...documentIds,
    ].filter((id) => Number.isFinite(id) && id > 0);

    const revisionCount = deleteByIds(tx, "document_revisions", "document_id", documentIds);
    const documentCount = deleteByIds(tx, "documents", "id", documentIds);
    const submissionCount = deleteByIds(
      tx,
      "submissions",
      "conversation_id",
      conversationIds.map(Number),
    );
    const taskCount = deleteByIds(tx, "tasks", "conversation_id", conversationIds.map(Number));
    const entryCount = deleteByIds(tx, "entries", "conversation_id", conversationIds.map(Number));
    const conversationCount = deleteByIds(tx, "conversations", "id", conversationIds.map(Number));
    const knownRecordIdCount = deleteByIds(tx, "record_ids", "id", allRecordIds);
    // 涵蓋上一次中斷留下的索引文件與孤兒 record_ids；id 1 是引擎保留的 root。
    const orphanDocuments = deleteOrphanSessionIndexes(tx);
    const recordIdCount = knownRecordIdCount + deleteOrphanRecordIds(tx);

    return {
      engineConversations: conversationCount,
      engineEntries: entryCount,
      engineTasks: taskCount,
      engineSubmissions: submissionCount,
      engineDocuments: documentCount + orphanDocuments,
      engineDocumentRevisions: revisionCount,
      engineRecordIds: recordIdCount,
    };
  });
}

function collectDocumentIds(
  tx: Queryable,
  conversationIds: readonly string[],
  taskIds: readonly number[],
  clientRequestIds: readonly string[],
): number[] {
  const rows = tx.all<DocumentRow>(
    "SELECT id, kind, key_value, scope_kind, owner_id, record FROM documents",
  );
  const conversations = new Set(conversationIds);
  const tasks = new Set(taskIds.map(String));
  const requestIds = new Set(clientRequestIds);
  const result = new Set<number>();
  for (const row of rows) {
    if (row.scope_kind === "conversation" && conversations.has(String(row.owner_id))) {
      result.add(Number(row.id));
      continue;
    }
    if (row.scope_kind === "task" && tasks.has(String(row.owner_id))) {
      result.add(Number(row.id));
      continue;
    }
    if (row.scope_kind !== "session") {
      continue;
    }
    if (row.kind !== CLIENT_REQUEST_FORWARD_KIND && row.kind !== CLIENT_REQUEST_REVERSE_KIND) {
      continue;
    }
    const record = parseRecord(row.record);
    const conversationId = readString(record, "conversationId");
    const clientRequestId = readString(record, "clientRequestId");
    const key = parseScalar(row.key_value);
    if (
      (conversationId !== null && conversations.has(conversationId)) ||
      (clientRequestId !== null && requestIds.has(clientRequestId)) ||
      (typeof key === "string" && (conversations.has(key) || requestIds.has(key)))
    ) {
      result.add(Number(row.id));
    }
  }
  return [...result];
}

function collectIds(tx: Queryable, sql: string, conversationIds: readonly string[]): number[] {
  const ids: number[] = [];
  for (const conversationId of conversationIds) {
    for (const row of tx.all<IdRow>(sql, conversationId)) {
      ids.push(Number(row.id));
    }
  }
  return ids;
}

function deleteByIds(tx: Queryable, table: string, column: string, ids: readonly number[]): number {
  let deleted = 0;
  for (const id of ids) {
    if (!Number.isFinite(id)) {
      continue;
    }
    deleted += tx.run(`DELETE FROM ${table} WHERE ${column} = ?`, id).changes;
  }
  return deleted;
}

function listTaskIds(engine: Database, conversationIds: readonly string[]): string[] {
  const result: string[] = [];
  for (const conversationId of conversationIds) {
    for (const row of engine.all<IdRow>(
      "SELECT id FROM tasks WHERE conversation_id = ?",
      conversationId,
    )) {
      result.push(String(row.id));
    }
  }
  return result;
}

function deleteRegistryRows(
  tx: Queryable,
  conversationIds: readonly string[],
  taskIds: readonly string[],
  toolCallIds: readonly string[],
): number {
  let deleted = 0;
  for (const conversationId of conversationIds) {
    deleted += tx.run(
      "DELETE FROM file_registry WHERE owner_kind = 'conversation' AND owner_id = ?",
      conversationId,
    ).changes;
  }
  for (const taskId of taskIds) {
    deleted += tx.run(
      "DELETE FROM file_registry WHERE owner_kind = 'task' AND owner_id = ?",
      taskId,
    ).changes;
  }
  for (const toolCallId of toolCallIds) {
    deleted += tx.run(
      "DELETE FROM file_registry WHERE owner_kind = 'tool-call' AND owner_id = ?",
      toolCallId,
    ).changes;
  }
  return deleted;
}

function countNextTurnRows(tx: Queryable, conversationIds: readonly string[]): number {
  let count = 0;
  for (const conversationId of conversationIds) {
    const row = tx.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM next_turn_injections WHERE conversation_id = ?",
      conversationId,
    );
    count += Number(row?.n ?? 0);
  }
  return count;
}

/** 刪掉專屬卡片的狀態列；還有其他引用或釘在白板時不動。 */
function deleteCardStateIfUnreferenced(tx: Queryable, cardId: string): number {
  const refs = tx.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM conversation_cards WHERE card_id = ?",
    cardId,
  );
  if (Number(refs?.n ?? 0) > 0) {
    return 0;
  }
  const state = tx.get<{ pinned: number }>(
    "SELECT pinned FROM card_state WHERE card_id = ?",
    cardId,
  );
  if ((state?.pinned ?? 0) === 1) {
    return 0;
  }
  return tx.run("DELETE FROM card_state WHERE card_id = ?", cardId).changes;
}

function deleteOrphanSessionIndexes(tx: Queryable): number {
  const rows = tx.all<DocumentRow>(
    "SELECT id, kind, key_value, scope_kind, owner_id, record FROM documents WHERE scope_kind = 'session' AND kind IN (?, ?)",
    CLIENT_REQUEST_FORWARD_KIND,
    CLIENT_REQUEST_REVERSE_KIND,
  );
  const orphanIds: number[] = [];
  for (const row of rows) {
    const record = parseRecord(row.record);
    let conversationId = readString(record, "conversationId");
    if (conversationId === null && row.kind === CLIENT_REQUEST_REVERSE_KIND) {
      const key = parseScalar(row.key_value);
      conversationId = typeof key === "string" || typeof key === "number" ? String(key) : null;
    }
    if (conversationId === null) {
      continue;
    }
    const exists = tx.get<{ one: number }>(
      "SELECT 1 AS one FROM conversations WHERE id = ? LIMIT 1",
      Number(conversationId),
    );
    if (exists === undefined) {
      orphanIds.push(Number(row.id));
    }
  }
  if (orphanIds.length === 0) {
    return 0;
  }
  for (const documentId of orphanIds) {
    tx.run("DELETE FROM document_revisions WHERE document_id = ?", documentId);
    tx.run("DELETE FROM documents WHERE id = ?", documentId);
  }
  return orphanIds.length;
}

function deleteOrphanRecordIds(tx: Queryable): number {
  return tx.run(
    `DELETE FROM record_ids
     WHERE id <> 1
       AND id NOT IN (SELECT id FROM conversations)
       AND id NOT IN (SELECT id FROM entries)
       AND id NOT IN (SELECT id FROM tasks)
       AND id NOT IN (SELECT id FROM submissions)
       AND id NOT IN (SELECT id FROM documents)`,
  ).changes;
}

function collectRegistryFiles(
  registry: FileRegistry,
  conversationIds: readonly string[],
  taskIds: readonly string[],
  toolCallIds: readonly string[],
): string[] {
  const paths: string[] = [];
  for (const conversationId of conversationIds) {
    paths.push(...registry.listByOwner("conversation", conversationId).map((row) => row.relPath));
  }
  for (const taskId of taskIds) {
    paths.push(...registry.listByOwner("task", taskId).map((row) => row.relPath));
  }
  for (const toolCallId of toolCallIds) {
    paths.push(...registry.listByOwner("tool-call", toolCallId).map((row) => row.relPath));
  }
  return paths;
}

function deleteRegisteredFiles(
  layout: FolderLayout,
  relativePaths: readonly string[],
  onAfterFileDelete?: (relativePath: string) => void,
): void {
  for (const relativePath of relativePaths) {
    try {
      const absolutePath = layout.absolute(relativePath);
      removeFileSafely(layout, absolutePath);
    } catch {
      // 壞路徑或已不存在：掃描會留下可診斷的痕跡，不在刪除路徑再拋錯。
    }
    onAfterFileDelete?.(relativePath);
  }
}

function readParentId(row: ConversationRow): string | null {
  const record = parseRecord(row.record);
  const parent = record?.parent;
  if (parent !== null && typeof parent === "object" && !Array.isArray(parent)) {
    const conversationId = (parent as Record<string, unknown>).conversationId;
    if (typeof conversationId === "number" || typeof conversationId === "string") {
      return String(conversationId);
    }
  }
  return row.owner_conversation_id === null ? null : String(row.owner_conversation_id);
}

function parseRecord(value: string): Record<string, unknown> | null {
  const parsed = tryParseJson(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/** 索引文件的 key 以 JSON 字串保存；兼容純字串。 */
function parseScalar(value: string): string | number | null {
  const parsed = tryParseJson(value);
  if (typeof parsed === "string" || typeof parsed === "number") {
    return parsed;
  }
  if (value === "") {
    return null;
  }
  return value;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) {
    return null;
  }
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

/** 讀文字檔；讀不到回 null。卡片檔讀不到時略過原檔候選，回收會再掃描。 */
function loadText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 卡片檔裡出現的原檔雜湊；與回收共用 `assetIdsInText`。
 *
 * 保留這個名字給對話刪除的預覽使用：預覽與實際回收必須用同一條規則，
 * 才不會出現「預覽說有、回收卻不算」的情況。
 */
export function assetIdsInCardText(text: string): string[] {
  return assetIdsInText(text);
}

/** 這些雜湊實際存在哪些原檔；讀不到資料夾時回空集合。 */
export function existingAssetIds(layout: FolderLayout, assetIds: readonly string[]): Set<string> {
  if (assetIds.length === 0) return new Set();
  const wanted = new Set(assetIds.map((assetId) => assetId.toLowerCase()));
  try {
    return new Set(
      listAssetFiles(layout)
        .map((entry) => entry.assetId)
        .filter((assetId) => wanted.has(assetId)),
    );
  } catch {
    return new Set();
  }
}

function rowToIntent(row: IntentRow): ConversationDeletionIntent {
  return {
    rootId: row.root_id,
    conversationIds: parseArray(row.conversation_ids),
    clientRequestIds: parseArray(row.client_request_ids),
    cardIds: parseArray(row.card_ids),
    assetIds: parseArray(row.asset_ids),
    phase: row.phase === "vacuum" ? "vacuum" : "rows",
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}

function parseArray(value: string): string[] {
  const parsed = tryParseJson(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === "string");
}

function emptyCounts(): DeletionTableCounts {
  return {
    eventLog: 0,
    approvals: 0,
    turnIndex: 0,
    requestDedupe: 0,
    subagentRuns: 0,
    fileRegistry: 0,
    nextTurnInjections: 0,
    conversations: 0,
    conversationCards: 0,
    conversationContext: 0,
    contextEntries: 0,
    conversationUsage: 0,
    cardState: 0,
    engineConversations: 0,
    engineEntries: 0,
    engineTasks: 0,
    engineSubmissions: 0,
    engineDocuments: 0,
    engineDocumentRevisions: 0,
    engineRecordIds: 0,
  };
}

function emptyReport(rootId: string): DeletionReport {
  return {
    rootId,
    deleted: false,
    conversationIds: [],
    counts: emptyCounts(),
    stateSizeBefore: 0,
    stateSizeAfter: 0,
    engineSizeBefore: 0,
    engineSizeAfter: 0,
  };
}
