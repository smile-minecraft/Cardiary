import { afterEach, describe, expect, it } from "vitest";

import {
  ApprovalAllowlist,
  ApprovalLedger,
  Storage,
  canonicalJson,
  newUlid,
  taskApprovalKey,
  toolApprovalKey,
} from "../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "approvals"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function open(tempRoot: TempRoot): Storage {
  const storage = openTestStorage(tempRoot);
  cleanups.push(() => storage.close());
  return storage;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: newUlid(),
    approvalKey: "key-1",
    scope: "tool" as const,
    sessionId: "session-1",
    turnId: "turn_1",
    toolName: "bash",
    actionKind: "tool-execution",
    requestJson: JSON.stringify({ input: "ls" }),
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function insertRaw(storage: Storage, overrides: Record<string, unknown>): void {
  const base = {
    id: newUlid(),
    approval_key: "raw-key",
    scope: "tool",
    session_id: null,
    turn_id: null,
    tool_name: "bash",
    subject_id: null,
    tool_call_id: null,
    action_kind: "tool-execution",
    status: "approved",
    request_json: "{}",
    decision_json: null,
    requested_at: new Date().toISOString(),
    expires_at: null,
    decided_at: new Date().toISOString(),
    decided_by: "human",
  };
  const row = { ...base, ...overrides } as Record<string, unknown>;
  storage.state.run(
    `INSERT INTO approvals (
       id, approval_key, scope, session_id, turn_id, tool_name, subject_id, tool_call_id,
       action_kind, status, request_json, decision_json, requested_at, expires_at, decided_at, decided_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.approval_key,
    row.scope,
    row.session_id,
    row.turn_id,
    row.tool_name,
    row.subject_id,
    row.tool_call_id,
    row.action_kind,
    row.status,
    row.request_json,
    row.decision_json,
    row.requested_at,
    row.expires_at,
    row.decided_at,
    row.decided_by,
  );
}

describe("record 的先讀後插", () => {
  it("沒有列時插入 pending；同一個鍵重送只留一筆", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const first = ledger.record(request());
    expect(first.status).toBe("pending");
    expect(first.inserted).toBe(true);
    const second = ledger.record(request({ id: newUlid() }));
    expect(second.status).toBe("pending");
    expect(second.inserted).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(ledger.countPendingForKey("key-1")).toBe(1);
  });

  it("預置 approved 再 record 不得新增 pending", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const first = ledger.record(request());
    ledger.commitDecision({
      approvalId: first.record.id,
      verdict: "approve",
      decidedAt: new Date().toISOString(),
      decidedBy: "human:test",
    });
    const before = storage.state.countRows("approvals");
    const second = ledger.record(request({ id: newUlid() }));
    expect(second.status).toBe("approved");
    expect(second.inserted).toBe(false);
    expect(storage.state.countRows("approvals")).toBe(before);
  });

  it("預置 denied 再 record 直接回拒絕", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const first = ledger.record(request());
    ledger.commitDecision({
      approvalId: first.record.id,
      verdict: "deny",
      decidedAt: new Date().toISOString(),
      decidedBy: "human:test",
    });
    const second = ledger.record(request({ id: newUlid() }));
    expect(second.status).toBe("denied");
    expect(second.inserted).toBe(false);
  });

  it("pending 已過期：先標成 expired，再插入新的 pending", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const first = ledger.record(request({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const second = ledger.record(request({ id: newUlid() }));
    expect(second.status).toBe("pending");
    expect(second.inserted).toBe(true);
    expect(second.record.id).not.toBe(first.record.id);
    expect(ledger.get(first.record.id)?.status).toBe("expired");
    expect(ledger.countPendingForKey("key-1")).toBe(1);
    expect(storage.state.countRows("approvals")).toBe(2);
  });

  it("已 expired 的鍵可以重新詢問", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const first = ledger.record(request());
    ledger.withdraw(first.record.id, new Date().toISOString());
    const second = ledger.record(request({ id: newUlid() }));
    expect(second.status).toBe("pending");
    expect(second.inserted).toBe(true);
    expect(ledger.get(first.record.id)?.status).toBe("withdrawn");
  });
});

describe("commitDecision", () => {
  it("先寫入者勝出；第二個決定回 already-decided 並帶回第一個決定", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const pending = ledger.record(request());
    const first = ledger.commitDecision({
      approvalId: pending.record.id,
      verdict: "approve",
      decidedAt: "2026-11-14T00:00:00.000Z",
      decidedBy: "human:first",
    });
    expect(first.outcome).toBe("committed");
    const second = ledger.commitDecision({
      approvalId: pending.record.id,
      verdict: "deny",
      decidedAt: "2026-11-14T00:00:01.000Z",
      decidedBy: "human:second",
    });
    expect(second.outcome).toBe("already-decided");
    if (second.outcome === "already-decided") {
      expect(second.record.status).toBe("approved");
      expect(second.record.decidedBy).toBe("human:first");
    }
  });

  it("找不到時回 not-found", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    expect(
      ledger.commitDecision({
        approvalId: "missing",
        verdict: "approve",
        decidedAt: new Date().toISOString(),
        decidedBy: "human",
      }).outcome,
    ).toBe("not-found");
  });
});

describe("查詢", () => {
  it("pendingApproval 每個會話各取最新一筆", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const older = ledger.record(
      request({ sessionId: "s1", approvalKey: "k1", requestedAt: "2026-11-14T00:00:00.000Z" }),
    );
    const newer = ledger.record(
      request({ sessionId: "s1", approvalKey: "k2", requestedAt: "2026-11-14T00:00:01.000Z" }),
    );
    ledger.record(request({ sessionId: "s2", approvalKey: "k3" }));
    expect(ledger.pendingForSession("s1")?.id).toBe(newer.record.id);
    expect(ledger.pendingForSession("s2")?.approvalKey).toBe("k3");
    expect(ledger.listPending({ sessionId: "s1" }).map((row) => row.id)).toEqual([
      newer.record.id,
      older.record.id,
    ]);
  });

  it("findByApprovalKey 先找 pending，沒有才取最新一列", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    insertRaw(storage, {
      approval_key: "pending-first",
      status: "approved",
      requested_at: "2026-11-14T00:00:00.000Z",
    });
    insertRaw(storage, {
      approval_key: "pending-first",
      status: "pending",
      requested_at: "2026-11-13T00:00:00.000Z",
      decided_at: null,
      decided_by: null,
    });
    expect(ledger.findByApprovalKey("pending-first")?.status).toBe("pending");

    insertRaw(storage, {
      approval_key: "same-ms",
      status: "approved",
      requested_at: "2026-11-14T00:00:00.000Z",
    });
    insertRaw(storage, {
      approval_key: "same-ms",
      status: "expired",
      requested_at: "2026-11-14T00:00:00.000Z",
    });
    // requested_at 相同時用 rowid DESC：後插入的 expired 才是最新。
    expect(ledger.findByApprovalKey("same-ms")?.status).toBe("expired");
  });

  it("scope 與欄位的 CHECK 會擋掉矛盾組合", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    expect(() =>
      ledger.record(request({ scope: "task", toolName: null, subjectId: null })),
    ).toThrowError(/CHECK/);
    expect(() => ledger.record(request({ scope: "tool", toolName: null }))).toThrowError(/CHECK/);
    expect(() =>
      ledger.record(request({ scope: "task", toolName: "bash", subjectId: "subject" })),
    ).toThrowError(/CHECK/);
    const task = ledger.record(
      request({
        scope: "task",
        toolName: null,
        subjectId: "module-1",
        actionKind: "module-enable",
        approvalKey: "task-key",
      }),
    );
    expect(task.record.scope).toBe("task");
    expect(task.record.actionKind).toBe("module-enable");
    expect(task.record.subjectId).toBe("module-1");
  });

  it("30 天保留只刪已決定且過期的列", () => {
    const storage = open(temp());
    const ledger = new ApprovalLedger(storage.state);
    const pending = ledger.record(request({ approvalKey: "keep-pending" }));
    const decided = ledger.record(request({ approvalKey: "old-decided" }));
    ledger.commitDecision({
      approvalId: decided.record.id,
      verdict: "approve",
      decidedAt: "2020-01-01T00:00:00.000Z",
      decidedBy: "human",
    });
    expect(ledger.get(pending.record.id)?.status).toBe("pending");
    ledger.prune({ now: new Date(), retainDays: 30 });
    expect(ledger.get(decided.record.id)).toBeNull();
    expect(ledger.get(pending.record.id)?.status).toBe("pending");
  });
});

describe("approval_key 與白名單", () => {
  it("工具審批鍵對鍵的順序不敏感，輸出 64 個小寫十六進位字元", () => {
    const base = {
      conversationId: "conversation-1",
      turnId: "turn_1",
      toolName: "bash",
    };
    const left = toolApprovalKey({ ...base, input: { b: 2, a: 1 } });
    const right = toolApprovalKey({ ...base, input: { a: 1, b: 2 } });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    const taskLeft = taskApprovalKey({
      taskKind: "module-enable",
      subjectId: "module-1",
      payload: { b: 2, a: 1 },
    });
    const taskRight = taskApprovalKey({
      taskKind: "module-enable",
      subjectId: "module-1",
      payload: { a: 1, b: 2 },
    });
    expect(taskLeft).toBe(taskRight);
    expect(taskLeft).toMatch(/^[0-9a-f]{64}$/);
  });

  it("approval_allowlist 是設定：可讀、沒有對話欄位", () => {
    const storage = open(temp());
    const allowlist = new ApprovalAllowlist(storage.state);
    storage.state.run(
      "INSERT INTO approval_allowlist (id, tool_name, scope_key, action_kind, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      newUlid(),
      "bash",
      "/Users/example/project",
      "tool-execution",
      new Date().toISOString(),
      "human:test",
    );
    expect(allowlist.find("bash", "/Users/example/project")?.toolName).toBe("bash");
    expect(allowlist.list()).toHaveLength(1);
    const columns = storage.state
      .all<{ name: string }>("PRAGMA table_info(approval_allowlist)")
      .map((row) => row.name);
    expect(columns).not.toContain("session_id");
    expect(columns).not.toContain("conversation_id");
    expect(columns).not.toContain("turn_id");
    expect(columns).not.toContain("expires_at");
  });
});
