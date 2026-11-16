import { describe, expect, it } from "vitest";
import {
  applyAgentEvent,
  attachPermissionApproval,
  markUnknownAfterRestart,
  nextEventSeq,
  type ExternalAgentSessionRecord,
} from "../../src/external-agents/index.js";

const start = new Date("2026-01-01T00:00:00.000Z");

function baseRecord(): ExternalAgentSessionRecord {
  return {
    agentSessionId: "ast_test",
    agentKind: "opencode",
    workingDirectory: "/tmp/work",
    startedAt: start.toISOString(),
    updatedAt: start.toISOString(),
    status: "running",
    completedSteps: 0,
    lastEventSeq: 0,
    pendingPermission: null,
    resultUnknown: false,
  };
}

describe("applyAgentEvent", () => {
  it("進度累加並可重複套用同一個序號而不會往前跳", () => {
    let record = baseRecord();
    record = applyAgentEvent(record, { kind: "progress", completed: 2, total: 4, label: "步驟 2" }, 1, start).record;
    expect(record.progress).toEqual({ step: 2, label: "步驟 2", completed: 2, total: 4 });
    expect(record.completedSteps).toBe(2);
    const again = applyAgentEvent(record, { kind: "progress", completed: 3, total: 4, label: "步驟 3" }, 1, start);
    expect(again.applied).toBe(false);
    expect(again.record.progress?.completed).toBe(2);
  });

  it("進度不會讓已完成的步數倒退", () => {
    let record = baseRecord();
    record = applyAgentEvent(record, { kind: "progress", completed: 3, total: 4, label: "a" }, 1, start).record;
    record = applyAgentEvent(record, { kind: "progress", completed: 1, total: 4, label: "b" }, 2, start).record;
    expect(record.completedSteps).toBe(3);
    expect(record.progress?.label).toBe("b");
  });

  it("權限請求進入等待審批並帶上審批 id", () => {
    let record = baseRecord();
    record = applyAgentEvent(
      record,
      { kind: "permission", toolName: "Bash", input: { command: "ls" }, requestKey: "fake:r1", replyToken: "r1", description: "列出檔案" },
      nextEventSeq(record),
      start,
    ).record;
    expect(record.status).toBe("waiting-approval");
    expect(record.pendingPermission?.toolName).toBe("Bash");
    expect(record.pendingPermission?.approvalId).toBe("");
    record = attachPermissionApproval(record, "apv_123");
    expect(record.pendingPermission?.approvalId).toBe("apv_123");
  });

  it("完成事件清掉等待中的權限請求", () => {
    let record = baseRecord();
    record = applyAgentEvent(
      record,
      { kind: "permission", toolName: "Bash", input: {}, requestKey: "fake:r1", replyToken: "r1" },
      1,
      start,
    ).record;
    record = applyAgentEvent(record, { kind: "completed", message: "完成" }, 2, start).record;
    expect(record.status).toBe("completed");
    expect(record.pendingPermission).toBeNull();
  });

  it("等待審批時進度不會讓狀態跑掉", () => {
    let record = baseRecord();
    record = { ...record, status: "waiting-approval" as const, pendingPermission: {
      requestKey: "fake:r1", approvalId: "", toolName: "Bash", input: {}, replyToken: "r1",
    } };
    record = applyAgentEvent(record, { kind: "progress", completed: 1, total: 2, label: "x" }, 5, start).record;
    expect(record.status).toBe("waiting-approval");
  });

  it("重啟後把未完成的 session 標記成結果未知，而且不動已歸檔的 session", () => {
    const running = baseRecord();
    const restarted = markUnknownAfterRestart(running, start);
    expect(restarted.status).toBe("failed");
    expect(restarted.resultUnknown).toBe(true);
    expect(restarted.message).toContain("未知");
    const done: ExternalAgentSessionRecord = { ...running, status: "completed" };
    expect(markUnknownAfterRestart(done, start)).toBe(done);
  });
});
