import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApprovalLedger, Storage, addDaysIso, newUlid, nowIso } from "../src/index.js";
import { byteSearch } from "../src/testing.js";
import { EngineFixture } from "./helpers/engine.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

const STATE_MARKER = "DELETED_MARKER_STATE_0f4c2f6a";
const ENGINE_MARKER = "DELETED_MARKER_ENGINE_7b8d1e2c";
const CACHE_MARKER = "DELETED_MARKER_CACHE_9a0b3c4d";
const TMP_MARKER = "DELETED_MARKER_TMP_5e6f7a8b";
const KEEP_MARKER = "KEEP_MARKER_1c2d3e4f";

interface Seeded {
  readonly tempRoot: TempRoot;
  readonly storage: Storage;
  readonly engine: EngineFixture;
  readonly clientRequestId: string;
}

function seed(): Seeded {
  const tempRoot = createTempRoot("deletion");
  cleanups.push(tempRoot.cleanup);
  const storage = openTestStorage(tempRoot);
  cleanups.push(() => storage.close());
  const engine = new EngineFixture(storage.engine.filePath);
  cleanups.push(() => engine.close());

  const root = 1;
  const branch = 2;
  const kept = 3;
  const clientRequestId = "req-delete-conversation";

  engine.insertConversation(root, { text: `${ENGINE_MARKER} root` });
  engine.insertConversation(branch, { parentId: root, text: `${ENGINE_MARKER} branch` });
  engine.insertConversation(kept, { text: `${KEEP_MARKER} kept` });
  engine.insertEntry(10, root, `${ENGINE_MARKER} entry-10`);
  engine.insertEntry(11, root, `${ENGINE_MARKER} entry-11`);
  engine.insertEntry(20, branch, `${ENGINE_MARKER} branch-entry`);
  engine.insertEntry(30, kept, `${KEEP_MARKER} kept-entry`);
  engine.insertTask(100, root, `${ENGINE_MARKER} task`);
  engine.insertSubmission(200, root, "msg-1", `${ENGINE_MARKER} submission`);
  engine.insertSubmission(300, kept, "msg-keep", `${KEEP_MARKER} submission`);
  engine.insertDocument({
    id: 400,
    kind: "cardiary.test.conversation",
    keyValue: "root",
    scopeKind: "conversation",
    ownerId: root,
    text: `${ENGINE_MARKER} conversation-doc`,
  });
  engine.insertDocument({
    id: 401,
    kind: "cardiary.test.conversation",
    keyValue: "branch",
    scopeKind: "conversation",
    ownerId: branch,
    text: `${ENGINE_MARKER} branch-doc`,
  });
  engine.insertDocument({
    id: 402,
    kind: "cardiary.test.conversation",
    keyValue: "kept",
    scopeKind: "conversation",
    ownerId: kept,
    text: `${KEEP_MARKER} kept-doc`,
  });
  engine.insertDocument({
    id: 410,
    kind: "cardiary.test.task",
    keyValue: "task",
    scopeKind: "task",
    ownerId: 100,
    text: `${ENGINE_MARKER} task-doc`,
  });
  engine.insertClientRequestIndexes(root, clientRequestId, 500, 501);
  engine.insertClientRequestIndexes(kept, "req-keep", 502, 503);
  for (let index = 0; index < 300; index += 1) {
    engine.insertEntry(1000 + index, root, `${ENGINE_MARKER} bulk-${"x".repeat(900)}`);
  }

  const oldEpoch = "01OLDEPOCH00000000000000000";
  storage.events.append({
    stream: `session:${root}`,
    kind: "stream.turn_started",
    payload: { marker: STATE_MARKER },
  });
  storage.events.append({
    stream: `session:${branch}`,
    kind: "stream.turn_started",
    payload: { marker: STATE_MARKER },
  });
  storage.events.append({
    stream: `session:${kept}`,
    kind: "stream.turn_started",
    payload: { marker: KEEP_MARKER },
  });
  storage.events.append({ stream: "system", kind: "system.status", payload: { ok: true } });
  for (let index = 0; index < 300; index += 1) {
    storage.events.append({
      stream: `session:${root}`,
      kind: "stream.tool_result",
      payload: { marker: STATE_MARKER, body: "x".repeat(900) },
    });
  }
  storage.state.run(
    `INSERT INTO event_log (stream, epoch, stream_seq, kind, payload, created_at)
     VALUES (?, ?, 900, 'stream.tool_result', ?, ?)`,
    `session:${root}`,
    oldEpoch,
    JSON.stringify({ marker: STATE_MARKER, epoch: "old" }),
    "2020-01-01T00:00:00.000Z",
  );

  const ledger = new ApprovalLedger(storage.state);
  const deletedApproval = ledger.record({
    id: newUlid(),
    approvalKey: "approval-deleted",
    sessionId: String(root),
    turnId: "turn_deleted",
    toolName: "bash",
    actionKind: "tool-execution",
    requestJson: JSON.stringify({ input: STATE_MARKER }),
    requestedAt: nowIso(),
  });
  ledger.commitDecision({
    approvalId: deletedApproval.record.id,
    verdict: "approve",
    decidedAt: "2020-01-01T00:00:00.000Z",
    decidedBy: "human",
  });
  ledger.record({
    id: newUlid(),
    approvalKey: "approval-kept",
    sessionId: String(kept),
    turnId: "turn_kept",
    toolName: "bash",
    actionKind: "tool-execution",
    requestJson: JSON.stringify({ input: KEEP_MARKER }),
    requestedAt: nowIso(),
  });

  storage.turns.record({
    turnId: "turn_deleted",
    conversationId: String(root),
    triggerMessageId: "message-deleted",
    startedAt: nowIso(),
  });
  storage.turns.record({
    turnId: "turn_kept",
    conversationId: String(kept),
    triggerMessageId: "message-kept",
    startedAt: nowIso(),
  });

  const dedupe = storage.dedupe.claim(`session-create:${clientRequestId}`, "session-create");
  storage.dedupe.setResource(dedupe.record.key, String(root));
  storage.dedupe.complete(dedupe.record.key, JSON.stringify({ marker: STATE_MARKER }));
  storage.dedupe.claim(`send-message:${root}:msg-pending`, "send-message");
  storage.dedupe.claim("opaque-resource-key", "send-message");
  storage.dedupe.setResource("opaque-resource-key", String(root));
  storage.dedupe.claim("send-message:3:msg-keep", "send-message");
  storage.dedupe.complete("send-message:3:msg-keep", JSON.stringify({ keep: true }));

  storage.state.run(
    "INSERT INTO subagent_runs (id, branch_id, parent_id, fork_entry_id, mode, status, created_at) VALUES (?, ?, ?, ?, 'background', 'completed', ?)",
    newUlid(),
    String(branch),
    String(root),
    "entry-1",
    nowIso(),
  );
  storage.state.run(
    "INSERT INTO subagent_runs (id, branch_id, parent_id, fork_entry_id, mode, status, created_at) VALUES (?, '4', '3', 'entry-2', 'background', 'completed', ?)",
    newUlid(),
    nowIso(),
  );
  storage.state.run(
    "INSERT INTO next_turn_injections (id, conversation_id, payload, created_at) VALUES (?, ?, ?, ?)",
    newUlid(),
    String(root),
    JSON.stringify({ marker: STATE_MARKER }),
    nowIso(),
  );
  storage.state.run(
    "INSERT INTO next_turn_injections (id, conversation_id, payload, created_at) VALUES (?, ?, ?, ?)",
    newUlid(),
    String(kept),
    JSON.stringify({ marker: KEEP_MARKER }),
    nowIso(),
  );
  storage.state.run(
    "INSERT INTO approval_allowlist (id, tool_name, scope_key, action_kind, created_at, created_by) VALUES (?, 'bash', '/project', 'tool-execution', ?, 'human')",
    newUlid(),
    nowIso(),
  );

  const tmpFile = path.join(tempRoot.folder, "tmp/conversation-1/output.txt");
  mkdirSync(path.dirname(tmpFile), { recursive: true });
  writeFileSync(tmpFile, TMP_MARKER);
  storage.registry.register({
    relPath: "tmp/conversation-1/output.txt",
    ownerKind: "conversation",
    ownerId: String(root),
  });
  const taskFile = path.join(tempRoot.folder, "tmp/task-100/output.txt");
  mkdirSync(path.dirname(taskFile), { recursive: true });
  writeFileSync(taskFile, TMP_MARKER);
  storage.registry.register({
    relPath: "tmp/task-100/output.txt",
    ownerKind: "task",
    ownerId: "100",
  });
  const keepFile = path.join(tempRoot.folder, "tmp/conversation-3/keep.txt");
  mkdirSync(path.dirname(keepFile), { recursive: true });
  writeFileSync(keepFile, KEEP_MARKER);
  storage.registry.register({
    relPath: "tmp/conversation-3/keep.txt",
    ownerKind: "conversation",
    ownerId: String(kept),
  });

  const cacheFile = path.join(tempRoot.folder, "cache/thumbs/root.png");
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, TMP_MARKER);
  storage.registry.register({
    relPath: "cache/thumbs/root.png",
    ownerKind: "conversation",
    ownerId: String(root),
  });

  storage.cache.exec("CREATE TABLE IF NOT EXISTS fts_probe (body TEXT)");
  storage.cache.run("INSERT INTO fts_probe (body) VALUES (?)", CACHE_MARKER);
  storage.logs.log("info", "deletion.test", { sessionId: String(root), count: 1 });
  // 量測主檔大小之前先把 WAL 落回，否則 before 只會看到空的 WAL 主檔。
  storage.state.checkpoint();
  storage.engine.checkpoint();

  return { tempRoot, storage, engine, clientRequestId };
}

describe("刪除對話", () => {
  it("刪主線連同支線、清五張表與索引，整個資料夾找不到標記，兩個資料庫都縮小", async () => {
    const { tempRoot, storage, engine, clientRequestId } = seed();
    let harnessOpen = true;
    const report = await storage.deletions.deleteConversation("1", {
      stopTools: async () => {
        harnessOpen = false;
      },
      closeHarness: async () => {
        harnessOpen = false;
      },
      openHarness: async () => {
        harnessOpen = true;
      },
    });
    expect(report.deleted).toBe(true);
    expect([...report.conversationIds].sort()).toEqual(["1", "2"]);
    expect(harnessOpen).toBe(true);

    // 引擎：五張表與 record_ids、索引文件。
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id IN (1, 2)")).toBe(0);
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id = 3")).toBe(1);
    expect(engine.count("SELECT COUNT(*) AS n FROM entries WHERE conversation_id IN (1, 2)")).toBe(
      0,
    );
    expect(engine.count("SELECT COUNT(*) AS n FROM tasks WHERE conversation_id IN (1, 2)")).toBe(0);
    expect(
      engine.count("SELECT COUNT(*) AS n FROM submissions WHERE conversation_id IN (1, 2)"),
    ).toBe(0);
    expect(
      engine.count(
        "SELECT COUNT(*) AS n FROM documents WHERE (scope_kind = 'conversation' AND owner_id IN (1, 2)) OR (scope_kind = 'task' AND owner_id = 100) OR id IN (500, 501)",
      ),
    ).toBe(0);
    expect(engine.count("SELECT COUNT(*) AS n FROM documents WHERE id IN (402, 502, 503)")).toBe(3);
    expect(
      engine.count(
        "SELECT COUNT(*) AS n FROM document_revisions WHERE document_id IN (400, 401, 410, 500, 501)",
      ),
    ).toBe(0);
    expect(
      engine.count(
        "SELECT COUNT(*) AS n FROM record_ids WHERE id IN (1, 2, 10, 11, 20, 100, 200, 400, 401, 410, 500, 501)",
      ),
    ).toBe(0);
    expect(
      engine.count("SELECT COUNT(*) AS n FROM record_ids WHERE id IN (3, 30, 300, 402, 502, 503)"),
    ).toBe(6);

    // Cardiary 表。
    expect(storage.state.countRows("conversation_deletions")).toBe(0);
    expect(storage.events.count("session:1")).toBe(0);
    expect(storage.events.count("session:2")).toBe(0);
    expect(storage.events.count("session:3")).toBeGreaterThan(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM event_log WHERE epoch = '01OLDEPOCH00000000000000000'",
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM approvals WHERE session_id IN ('1', '2')",
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE session_id = '3'")
        ?.n,
    ).toBe(1);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM turn_index WHERE conversation_id IN ('1', '2')",
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM request_dedupe WHERE key = ? OR key LIKE 'send-message:1:%' OR resource_id = '1'",
        `session-create:${clientRequestId}`,
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM request_dedupe WHERE key = 'send-message:3:msg-keep'",
      )?.n,
    ).toBe(1);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM subagent_runs WHERE branch_id IN ('1', '2') OR parent_id IN ('1', '2')",
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM next_turn_injections WHERE conversation_id IN ('1', '2')",
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM file_registry WHERE owner_kind = 'conversation' AND owner_id IN ('1', '2')",
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM file_registry WHERE owner_kind = 'task' AND owner_id = '100'",
      )?.n,
    ).toBe(0);
    expect(storage.state.countRows("approval_allowlist")).toBe(1);

    // 檔案：正本以外都掃，任何標記殘留都失敗。
    const hits = byteSearch(tempRoot.folder, [
      STATE_MARKER,
      ENGINE_MARKER,
      CACHE_MARKER,
      TMP_MARKER,
    ]);
    expect(hits).toEqual([]);
    expect(existsSync(path.join(tempRoot.folder, "tmp/conversation-1/output.txt"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "tmp/task-100/output.txt"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "cache/thumbs/root.png"))).toBe(false);

    // 大小：incremental_vacuum 後再 checkpoint，主檔真的下降。
    expect(report.stateSizeAfter).toBeLessThan(report.stateSizeBefore);
    expect(report.engineSizeAfter).toBeLessThan(report.engineSizeBefore);
    expect(report.stateSizeAfter).toBeLessThan(report.stateSizeBefore * 0.8);
    expect(report.engineSizeAfter).toBeLessThan(report.engineSizeBefore * 0.8);
    expect(storage.state.integrityCheck()).toBe("ok");
    expect(storage.engine.integrityCheck()).toBe("ok");
  });

  it("找不到對話列時仍清掉殘留索引與 record_ids", async () => {
    const { engine, storage } = seed();
    // 模擬上一次中斷：對話、entry、task、submission 列已刪，索引與 record_ids 留著。
    engine.db.exec("DELETE FROM conversations WHERE id IN (1, 2)");
    engine.db.exec("DELETE FROM entries WHERE conversation_id IN (1, 2)");
    engine.db.exec("DELETE FROM tasks WHERE conversation_id IN (1, 2)");
    engine.db.exec("DELETE FROM submissions WHERE conversation_id IN (1, 2)");
    const report = await storage.deletions.deleteConversation("1");
    expect(report.deleted).toBe(false);
    expect(engine.count("SELECT COUNT(*) AS n FROM documents WHERE id IN (500, 501)")).toBe(0);
    expect(
      engine.count(
        "SELECT COUNT(*) AS n FROM record_ids WHERE id IN (10, 11, 20, 100, 200, 500, 501)",
      ),
    ).toBe(0);
    // 保留對話的索引與 record_ids 不動。
    expect(engine.count("SELECT COUNT(*) AS n FROM documents WHERE id IN (502, 503)")).toBe(2);
    expect(
      engine.count("SELECT COUNT(*) AS n FROM record_ids WHERE id IN (30, 300, 402, 502, 503)"),
    ).toBe(5);
  });

  it("刪不存在的對話會重開 Harness，之後仍能開新回合", async () => {
    const { storage, engine } = seed();
    const harness = {
      open: false,
      newTurn(): boolean {
        if (!this.open) {
          throw new Error("harness is closed");
        }
        return true;
      },
    };
    const report = await storage.deletions.deleteConversation("999", {
      closeHarness: async () => {
        harness.open = false;
      },
      openHarness: async () => {
        harness.open = true;
      },
    });
    expect(report.deleted).toBe(false);
    expect(harness.open).toBe(true);
    expect(harness.newTurn()).toBe(true);
    engine.insertConversation(9, { text: "after-noop-delete" });
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id = 9")).toBe(1);
  });

  it("request_dedupe 只靠 resource_id 指向子樹也會被刪", async () => {
    const { storage } = seed();
    storage.dedupe.claim("resource-only-key", "send-message");
    storage.dedupe.setResource("resource-only-key", "1");
    await storage.deletions.deleteConversation("1");
    expect(storage.dedupe.lookup("resource-only-key")).toBeNull();
  });

  it("刪除是冪等的：再呼叫一次不丟錯，也不留下新的列", async () => {
    const { storage } = seed();
    await storage.deletions.deleteConversation("1");
    const approvalsBefore = storage.state.countRows("approvals");
    const second = await storage.deletions.deleteConversation("1");
    expect(second.deleted).toBe(false);
    expect(storage.state.countRows("conversation_deletions")).toBe(0);
    expect(storage.state.countRows("approvals")).toBe(approvalsBefore);
  });

  it("file_registry 的 tool-call 主人也會一起清掉", async () => {
    const { tempRoot, storage } = seed();
    const file = path.join(tempRoot.folder, "tmp/tool-call-1/output.txt");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, TMP_MARKER);
    storage.registry.register({
      relPath: "tmp/tool-call-1/output.txt",
      ownerKind: "tool-call",
      ownerId: "call-1",
    });
    await storage.deletions.deleteConversation("1", { toolCallIds: ["call-1"] });
    expect(existsSync(file)).toBe(false);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM file_registry WHERE owner_kind = 'tool-call' AND owner_id = 'call-1'",
      )?.n,
    ).toBe(0);
  });

  it("刪支線不影響主線", async () => {
    const { storage, engine } = seed();
    const report = await storage.deletions.deleteConversation("2");
    expect(report.conversationIds).toEqual(["2"]);
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id = 1")).toBe(1);
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id = 2")).toBe(0);
    expect(storage.events.count("session:1")).toBeGreaterThan(0);
    expect(storage.events.count("session:2")).toBe(0);
  });

  it("每日維護會做完整 VACUUM 並再 checkpoint，主檔再下降", async () => {
    const { storage } = seed();
    await storage.deletions.deleteConversation("1");
    const afterDelete = storage.state.fileSize();
    const report = storage.maintenance.daily();
    expect(report.stateSizeAfter).toBeLessThanOrEqual(afterDelete);
    expect(storage.state.integrityCheck()).toBe("ok");
    expect(storage.engine.integrityCheck()).toBe("ok");
  });

  it("保留策略只處理未被刪除的對話：30 天後才清，對話刪除則立即清", async () => {
    const { storage } = seed();
    const kept = new ApprovalLedger(storage.state).findByApprovalKey("approval-kept");
    expect(kept).not.toBeNull();
    storage.state.run(
      "UPDATE approvals SET status = 'approved', decided_at = ?, decided_by = 'human' WHERE id = ?",
      addDaysIso(nowIso(), -40),
      kept?.id,
    );
    await storage.deletions.deleteConversation("1");
    // 保留對話的審批仍在，直到回收才清。
    expect(new ApprovalLedger(storage.state).findByApprovalKey("approval-kept")).not.toBeNull();
    new ApprovalLedger(storage.state).prune({ now: new Date(), retainDays: 30 });
    expect(new ApprovalLedger(storage.state).findByApprovalKey("approval-kept")).toBeNull();
  });

  it("刪除對話會刪專屬卡片檔與狀態列，保留共享與釘選的卡片", async () => {
    const { tempRoot, storage } = seed();
    const cardsDirectory = path.join(tempRoot.folder, "cards");
    const assetsDirectory = path.join(tempRoot.folder, "assets");
    mkdirSync(cardsDirectory, { recursive: true });
    mkdirSync(assetsDirectory, { recursive: true });

    const exclusive = "01CARDEXCLUSIVE00000000001";
    const shared = "01CARDSHARED00000000000002";
    const pinned = "01CARDPINNED00000000000003";
    const assetOf = (cardId: string): string => createHash("sha256").update(cardId).digest("hex");

    const writeCard = (cardId: string): void => {
      const hash = assetOf(cardId);
      writeFileSync(
        path.join(cardsDirectory, `${cardId}.md`),
        [
          "---",
          `id: ${cardId}`,
          "kind: image",
          "title: 卡片",
          `created: ${nowIso()}`,
          `asset: assets/${hash}.png`,
          "---",
          "內容",
        ].join("\n"),
      );
      writeFileSync(path.join(assetsDirectory, `${hash}.png`), `asset-${cardId}`);
    };
    for (const cardId of [exclusive, shared, pinned]) {
      writeCard(cardId);
      storage.state.run(
        `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, pinned, updated_at)
         VALUES (?, 'default', 100, ?, 'live', ?, ?)`,
        cardId,
        nowIso(),
        cardId === pinned ? 1 : 0,
        nowIso(),
      );
    }
    const now = nowIso();
    storage.state.run(
      `INSERT INTO conversations (conversation_id, title, created_at, updated_at, last_activity_at)
       VALUES ('1', '主線', ?, ?, ?), ('2', '支線', ?, ?, ?), ('3', '保留', ?, ?, ?)`,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
    );
    const reference = (conversationId: string, cardId: string): void => {
      storage.state.run(
        `INSERT INTO conversation_cards
           (conversation_id, card_id, first_loaded_at, last_loaded_at, load_count)
         VALUES (?, ?, ?, ?, 1)`,
        conversationId,
        cardId,
        now,
        now,
      );
    };
    reference("1", exclusive);
    reference("2", exclusive);
    reference("1", shared);
    reference("3", shared);
    reference("1", pinned);

    const report = await storage.deletions.deleteConversation("1");
    expect(report.deleted).toBe(true);
    expect(report.counts.conversations).toBe(2);
    expect(report.counts.conversationCards).toBe(4);
    expect(report.counts.cardState).toBe(1);

    expect(existsSync(path.join(cardsDirectory, `${exclusive}.md`))).toBe(false);
    expect(existsSync(path.join(cardsDirectory, `${shared}.md`))).toBe(true);
    expect(existsSync(path.join(cardsDirectory, `${pinned}.md`))).toBe(true);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM card_state WHERE card_id = ?",
        exclusive,
      )?.n,
    ).toBe(0);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM card_state WHERE card_id = ?",
        shared,
      )?.n,
    ).toBe(1);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM card_state WHERE card_id = ?",
        pinned,
      )?.n,
    ).toBe(1);
    // 共享卡片仍保留另一個對話的引用；釘選卡片的引用已隨對話消失，但卡片還在。
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM conversation_cards WHERE card_id = ?",
        shared,
      )?.n,
    ).toBe(1);
    expect(
      storage.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM conversation_cards WHERE card_id = ?",
        pinned,
      )?.n,
    ).toBe(0);
    expect(storage.state.countRows("conversation_deletions")).toBe(0);
  });
});
