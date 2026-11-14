import type { Database, Queryable } from "./db.js";
import { ApprovalLedger } from "./approvals.js";
import { RequestDedupeStore } from "./dedupe.js";
import { StorageError } from "./errors.js";
import type { FolderLayout } from "./paths.js";
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
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
}

interface IntentRow {
  readonly root_id: string;
  readonly conversation_ids: string;
  readonly client_request_ids: string;
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
  readonly #now: () => Date;
  readonly #trace: (operation: string) => void;

  constructor(options: DeletionServiceOptions) {
    this.#state = options.state;
    this.#engine = options.engine;
    this.#registry = options.registry;
    this.#resetCacheIndex = options.resetCacheIndex;
    this.#now = options.now ?? (() => new Date());
    this.#trace = options.trace ?? (() => {});
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
    await hooks.closeHarness?.();

    const existing = this.getIntent(rootId);
    let intent = existing;
    if (intent === null) {
      const conversationIds = listConversationSubtree(this.#engine, rootId);
      if (conversationIds.length === 0) {
        return emptyReport(rootId);
      }
      const clientRequestIds = listClientRequestIds(this.#engine, conversationIds);
      intent = {
        rootId,
        conversationIds,
        clientRequestIds,
        phase: "rows",
        requestedAt: nowIso(this.#now),
        updatedAt: nowIso(this.#now),
      };
      this.insertIntent(intent);
    }

    const stateSizeBefore = this.#state.fileSize();
    const engineSizeBefore = this.#engine.fileSize();

    let counts = emptyCounts();
    if (intent.phase === "rows") {
      const taskIds = listTaskIds(this.#engine, intent.conversationIds);
      counts = this.deleteCardiaryRows(intent, taskIds, hooks.toolCallIds ?? []);
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

    const report: DeletionReport = {
      rootId,
      deleted: true,
      conversationIds: intent.conversationIds,
      counts,
      stateSizeBefore,
      stateSizeAfter: this.#state.fileSize(),
      engineSizeBefore,
      engineSizeAfter: this.#engine.fileSize(),
    };
    await hooks.openHarness?.();
    return report;
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

  private insertIntent(intent: ConversationDeletionIntent): void {
    this.#state.run(
      `INSERT INTO conversation_deletions
         (root_id, conversation_ids, client_request_ids, phase, requested_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      intent.rootId,
      JSON.stringify(intent.conversationIds),
      JSON.stringify(intent.clientRequestIds),
      intent.phase,
      intent.requestedAt,
      intent.updatedAt,
    );
    this.#trace("deletion:intent-written");
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

  private deleteCardiaryRows(
    intent: ConversationDeletionIntent,
    taskIds: readonly string[],
    toolCallIds: readonly string[],
  ): DeletionTableCounts {
    const events = new EventLog(this.#state, { now: this.#now });
    const approvals = new ApprovalLedger(this.#state, { now: this.#now });
    const turns = new TurnIndex(this.#state);
    const dedupe = new RequestDedupeStore(this.#state, { now: this.#now });
    const streams = intent.conversationIds.map((id) => `session:${id}` as const);
    const counts = { ...emptyCounts() };

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

      Object.assign(counts, {
        eventLog,
        approvals: approvalCount,
        turnIndex: turnCount,
        requestDedupe: dedupeCount,
        subagentRuns,
        fileRegistry,
        nextTurnInjections,
      });
    });

    // 刪列先於刪檔；中途當機只會留下孤兒檔案，掃描會處理。
    this.#registry.purgeOwner("conversation", intent.conversationIds);
    this.#registry.purgeOwner("task", taskIds);
    return counts;
  }

  private vacuum(intent: ConversationDeletionIntent): void {
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
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
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
    const recordIdCount = deleteByIds(tx, "record_ids", "id", allRecordIds);

    return {
      engineConversations: conversationCount,
      engineEntries: entryCount,
      engineTasks: taskCount,
      engineSubmissions: submissionCount,
      engineDocuments: documentCount,
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

function rowToIntent(row: IntentRow): ConversationDeletionIntent {
  return {
    rootId: row.root_id,
    conversationIds: parseArray(row.conversation_ids),
    clientRequestIds: parseArray(row.client_request_ids),
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
