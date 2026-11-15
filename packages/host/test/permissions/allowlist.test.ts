import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { localToolAction } from "../../src/permissions/actions.js";
import { ApprovalAllowlistStore } from "../../src/permissions/allowlist.js";
import { openPermissionFixture, type PermissionFixture } from "./support.js";

let fixture: PermissionFixture | null = null;

function open(): { fixture: PermissionFixture; store: ApprovalAllowlistStore } {
  fixture = openPermissionFixture();
  return { fixture, store: new ApprovalAllowlistStore(fixture.storage.state) };
}

afterEach(() => {
  fixture?.cleanup();
  fixture = null;
});

describe("白名單的讀寫", () => {
  it("寫入後可以讀回；同一個 (工具, 目錄) 只有一列", () => {
    const { fixture, store } = open();
    const first = store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    expect(first.toolName).toBe("write_file");
    expect(first.scopeKey).toBe(fixture.project);
    expect(first.actionKind).toBe("fs.write");
    const second = store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-2",
      now: new Date(Date.now() + 1000),
    });
    expect(second.id).toBe(first.id);
    expect(second.createdBy).toBe("client-2");
    expect(store.list()).toHaveLength(1);
  });

  it("只對路徑邊界之內有效：project 不涵蓋 project-other", () => {
    const { fixture, store } = open();
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    const base = {
      toolName: "write_file",
      actionKind: "fs.write",
      scopeKey: fixture.project,
    };
    expect(store.match({ ...base, path: join(fixture.project, "a.md") })).not.toBeNull();
    expect(store.match({ ...base, path: fixture.project })).not.toBeNull();
    expect(store.match({ ...base, path: join(fixture.root, "project-other", "a.md") })).toBeNull();
    expect(store.match({ ...base, path: join(fixture.outside, "a.md") })).toBeNull();
  });

  it("工具或動作種類不同就不命中", () => {
    const { fixture, store } = open();
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    expect(
      store.match({
        toolName: "read_file",
        actionKind: "fs.write",
        scopeKey: fixture.project,
        path: join(fixture.project, "a.md"),
      }),
    ).toBeNull();
    expect(
      store.match({
        toolName: "write_file",
        actionKind: "fs.read",
        scopeKey: fixture.project,
        path: join(fixture.project, "a.md"),
      }),
    ).toBeNull();
  });

  it("不限目錄的 '*' 對任何路徑都命中", () => {
    const { store } = open();
    store.grant({
      toolName: "cards_patch",
      scopeKey: "*",
      actionKind: "cards.patch",
      createdBy: "client-1",
    });
    expect(
      store.match({ toolName: "cards_patch", actionKind: "cards.patch", scopeKey: "*" }),
    ).not.toBeNull();
  });

  it("撤銷只刪那一列", () => {
    const { fixture, store } = open();
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    expect(store.revoke("write_file", fixture.project)).toBe(true);
    expect(store.revoke("write_file", fixture.project)).toBe(false);
    expect(store.list()).toHaveLength(0);
  });

  it("刪除對話與 30 天保留清理之後，白名單仍在", () => {
    const { fixture, store } = open();
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    const now = new Date("2026-01-01T00:00:00.000Z");
    fixture.storage.approvals.record({
      id: "apr_1",
      approvalKey: "key-1",
      sessionId: "session-1",
      turnId: "turn-1",
      toolName: "write_file",
      actionKind: "fs.write",
      requestJson: "{}",
      requestedAt: now.toISOString(),
    });
    fixture.storage.approvals.commitDecision({
      approvalId: "apr_1",
      verdict: "deny",
      decidedAt: new Date("2026-01-02T00:00:00.000Z").toISOString(),
      decidedBy: "client-1",
    });
    expect(fixture.storage.approvals.deleteForSessions(["session-1"])).toBe(1);
    expect(fixture.storage.approvals.prune({ now: new Date("2026-03-01T00:00:00.000Z") })).toBe(0);
    expect(store.find("write_file", fixture.project)).not.toBeNull();
  });

  it("代理沒有寫入白名單的路徑：沒有任何工具能把輸入轉成白名單寫入", () => {
    const toolNames = [
      "read_file",
      "write_file",
      "list_directory",
      "run_command",
      "grant_allowlist",
      "write_allowlist",
      "approval_allowlist.grant",
    ];
    for (const toolName of toolNames) {
      const action = localToolAction(toolName, {
        path: "/tmp/x",
        content: "x",
        command: "echo x",
      });
      if (action !== null) {
        expect(action.kind).not.toContain("allowlist");
      }
    }
    expect(localToolAction("grant_allowlist", { toolName: "write_file" })).toBeNull();
    expect(localToolAction("write_allowlist", { scopeKey: "*" })).toBeNull();
  });
});
