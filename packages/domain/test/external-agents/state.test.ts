import { describe, expect, it } from "vitest";
import {
  applyAgentEvent,
  attachPermissionApproval,
  markStopped,
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
    record = applyAgentEvent(
      record,
      { kind: "progress", completed: 2, total: 4, label: "步驟 2" },
      1,
      start,
    ).record;
    expect(record.progress).toEqual({ step: 2, label: "步驟 2", completed: 2, total: 4 });
    expect(record.completedSteps).toBe(2);
    const again = applyAgentEvent(
      record,
      { kind: "progress", completed: 3, total: 4, label: "步驟 3" },
      1,
      start,
    );
    expect(again.applied).toBe(false);
    expect(again.record.progress?.completed).toBe(2);
  });

  it("進度不會讓已完成的步數倒退", () => {
    let record = baseRecord();
    record = applyAgentEvent(
      record,
      { kind: "progress", completed: 3, total: 4, label: "a" },
      1,
      start,
    ).record;
    record = applyAgentEvent(
      record,
      { kind: "progress", completed: 1, total: 4, label: "b" },
      2,
      start,
    ).record;
    expect(record.completedSteps).toBe(3);
    expect(record.progress?.label).toBe("b");
  });

  it("權限請求進入等待審批並帶上審批 id", () => {
    let record = baseRecord();
    record = applyAgentEvent(
      record,
      {
        kind: "permission",
        toolName: "Bash",
        input: { command: "ls" },
        requestKey: "fake:r1",
        replyToken: "r1",
        description: "列出檔案",
      },
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
    record = {
      ...record,
      status: "waiting-approval" as const,
      pendingPermission: {
        requestKey: "fake:r1",
        approvalId: "",
        toolName: "Bash",
        input: {},
        replyToken: "r1",
      },
    };
    record = applyAgentEvent(
      record,
      { kind: "progress", completed: 1, total: 2, label: "x" },
      5,
      start,
    ).record;
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

  it("重啟時保留還沒確認結束的行程身分，讓下次啟動能再認出並補殺", () => {
    const child = { pid: 4242, processGroupId: 4242, startedAt: "Thu Jan  1 00:00:00 2026" };
    const running: ExternalAgentSessionRecord = { ...baseRecord(), child };
    const restarted = markUnknownAfterRestart(running, start);
    expect(restarted.status).toBe("failed");
    expect(restarted.resultUnknown).toBe(true);
    // 結果未知不代表行程已結束；身分必須留著，重試才能收斂。
    expect(restarted.child).toEqual(child);
  });

  it("使用者停止時保留還沒確認結束的行程身分，讓下次啟動能再認出並補殺", () => {
    const child = { pid: 5252, processGroupId: 5252, startedAt: "Thu Jan  1 00:00:01 2026" };
    const running: ExternalAgentSessionRecord = { ...baseRecord(), child };
    const stopped = markStopped(running, "使用者停止", start);
    expect(stopped.status).toBe("stopped");
    // 狀態機不知道行程是否真的死了；清 child 是已確認退出的 host 路徑的責任。
    // 在這裡清掉會讓 stop() 寫到磁碟，重啟後認不出還活著的孤兒。
    expect(stopped.child).toEqual(child);
  });

  it("完成與失敗事件本身不假設行程已結束，保留 child 由 host 收尾時清", () => {
    const child = { pid: 6262, processGroupId: 6262, startedAt: "Thu Jan  1 00:00:02 2026" };
    const running: ExternalAgentSessionRecord = { ...baseRecord(), child };
    const completed = applyAgentEvent(
      running,
      { kind: "completed", message: "完成" },
      nextEventSeq(running),
      start,
    ).record;
    expect(completed.status).toBe("completed");
    expect(completed.child).toEqual(child);
    const failed = applyAgentEvent(
      running,
      { kind: "failed", message: "失敗" },
      nextEventSeq(running),
      start,
    ).record;
    expect(failed.status).toBe("failed");
    expect(failed.child).toEqual(child);
  });
});
