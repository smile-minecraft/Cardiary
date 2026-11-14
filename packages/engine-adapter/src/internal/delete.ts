import type { NodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";

/**
 * 刪除引擎裡一個對話子樹的所有列。
 *
 * 引擎 1.5.2 沒有刪除 API；這裡直接操作引擎的表，順序照 `storage` 第 3.10 節：
 * `document_revisions` → `documents` → `submissions` → `tasks` → `entries` →
 * `conversations`，最後清掉所有被刪 ID 的 `record_ids`。整個流程在同一個交易，
 * 呼叫前 Harness 必須關閉。
 *
 * 這個函式是冪等的：找不到列時仍會清掉殘留的 `record_ids`，重試安全。
 */
export async function deleteEngineSubtree(
  database: NodeSqliteDatabase,
  conversationIds: readonly number[],
): Promise<{ readonly deletedConversations: number }> {
  if (conversationIds.length === 0) {
    return { deletedConversations: 0 };
  }
  const placeholders = conversationIds.map(() => "?").join(", ");
  const params = [...conversationIds] as const;

  await database.exec("BEGIN IMMEDIATE");
  try {
    const taskIds = await idsOf(
      database,
      `SELECT id FROM tasks WHERE conversation_id IN (${placeholders})`,
      params,
    );
    const entryIds = await idsOf(
      database,
      `SELECT id FROM entries WHERE conversation_id IN (${placeholders})`,
      params,
    );
    const submissionIds = await idsOf(
      database,
      `SELECT id FROM submissions WHERE conversation_id IN (${placeholders})`,
      params,
    );

    const scopeClauses = [`(scope_kind = 'conversation' AND owner_id IN (${placeholders}))`];
    const scopeParams: number[] = [...conversationIds];
    if (taskIds.length > 0) {
      scopeClauses.push(
        `(scope_kind = 'task' AND owner_id IN (${taskIds.map(() => "?").join(", ")}))`,
      );
      scopeParams.push(...taskIds);
    }
    const documentWhere = scopeClauses.join(" OR ");
    const documentIds = await idsOf(
      database,
      `SELECT id FROM documents WHERE ${documentWhere}`,
      scopeParams,
    );

    if (documentIds.length > 0) {
      const documentPlaceholders = documentIds.map(() => "?").join(", ");
      await database.run(
        `DELETE FROM document_revisions WHERE document_id IN (${documentPlaceholders})`,
        ...documentIds,
      );
      await database.run(
        `DELETE FROM documents WHERE id IN (${documentPlaceholders})`,
        ...documentIds,
      );
    }
    await database.run(
      `DELETE FROM submissions WHERE conversation_id IN (${placeholders})`,
      ...params,
    );
    await database.run(`DELETE FROM tasks WHERE conversation_id IN (${placeholders})`, ...params);
    await database.run(`DELETE FROM entries WHERE conversation_id IN (${placeholders})`, ...params);
    const deletedConversations = await database.runCounted(
      `DELETE FROM conversations WHERE id IN (${placeholders})`,
      ...params,
    );

    const recordIds = [
      ...conversationIds,
      ...taskIds,
      ...entryIds,
      ...submissionIds,
      ...documentIds,
    ];
    if (recordIds.length > 0) {
      // record_ids 是引擎的 ID 所有權表；沒清掉會讓重建的 root 撞
      // "ID 1 already belongs to conversation"。
      const recordPlaceholders = recordIds.map(() => "?").join(", ");
      await database.run(
        `DELETE FROM record_ids WHERE id IN (${recordPlaceholders})`,
        ...recordIds,
      );
    }

    await database.exec("COMMIT");
    return { deletedConversations };
  } catch (error) {
    await database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 從引擎的 `conversations.record` 遞迴列出整個子樹。
 *
 * `fork` 只把父對話與分岔點寫在 record 的 `parent` 欄位；引擎沒有外鍵，
 * 子樹關係只能從 record 讀。
 */
export async function listConversationSubtree(
  database: NodeSqliteDatabase,
  rootId: number,
): Promise<number[]> {
  const rows = await database.all<{ id: number; record: string }>(
    "SELECT id, record FROM conversations",
  );
  const children = new Map<number, number[]>();
  const known = new Set<number>();
  for (const row of rows) {
    known.add(row.id);
    let parent: number | undefined;
    try {
      const record = JSON.parse(row.record) as { parent?: { conversationId?: number | string } };
      const raw = record.parent?.conversationId;
      parent = raw === undefined ? undefined : Number(raw);
    } catch {
      parent = undefined;
    }
    if (parent === undefined || Number.isNaN(parent)) {
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(row.id);
    children.set(parent, list);
  }

  const result: number[] = [];
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop() as number;
    if (result.includes(id)) {
      continue;
    }
    result.push(id);
    for (const child of children.get(id) ?? []) {
      pending.push(child);
    }
  }
  return result;
}

/** checkpoint、回收 free pages 與完整性檢查；刪除完成前的最後一步。 */
export async function compactAfterDelete(database: NodeSqliteDatabase): Promise<string> {
  await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await database.exec("PRAGMA incremental_vacuum");
  const row = await database.get<{ integrity_check: string }>("PRAGMA integrity_check");
  return row?.integrity_check ?? "unknown";
}

/** 讀一組整數 ID。 */
async function idsOf(
  database: NodeSqliteDatabase,
  sql: string,
  params: readonly number[],
): Promise<number[]> {
  const rows = await database.all<{ id: number }>(sql, ...params);
  return rows.map((row) => Number(row.id));
}
