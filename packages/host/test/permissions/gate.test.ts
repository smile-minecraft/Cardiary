import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolPermissionRequest } from "@cardiary/engine-adapter";
import { detectCaseSensitivity } from "@cardiary/domain";

import { ApprovalAllowlistStore } from "../../src/permissions/allowlist.js";
import { ALLOWLIST_DETAIL_LABELS, createToolPermissionGate } from "../../src/permissions/gate.js";
import { alwaysAllowTarget } from "../../src/permissions/decisions.js";
import { openPermissionFixture, type PermissionFixture } from "./support.js";

let fixture: PermissionFixture;
let store: ApprovalAllowlistStore;

beforeEach(() => {
  fixture = openPermissionFixture();
  store = new ApprovalAllowlistStore(fixture.storage.state);
  writeFileSync(join(fixture.project, "notes.md"), "notes");
  mkdirSync(join(fixture.project, "sub"));
  writeFileSync(join(fixture.folder, "cards", "a.md"), "card");
});

afterEach(() => {
  fixture.cleanup();
});

function gate() {
  return createToolPermissionGate({
    workingDir: fixture.project,
    folderRoot: fixture.folder,
    allowlist: store,
  });
}

function request(toolName: string, input: unknown): ToolPermissionRequest {
  return {
    conversationId: "c1",
    turnId: "t1",
    toolCallId: "call-1",
    toolName,
    input: input as never,
    replay: "unsafe",
    permissionMode: "hard-rules",
  };
}

async function evaluate(toolName: string, input: unknown) {
  return gate().evaluate(request(toolName, input));
}

describe("權限閘道的順序", () => {
  it("讀工作目錄的檔案自動放行", async () => {
    expect(await evaluate("read_file", { path: "notes.md" })).toEqual({ kind: "allow" });
  });

  it("寫檔建立審批，並帶上動作種類與允許範圍", async () => {
    const verdict = await evaluate("write_file", { path: "new.md", content: "x" });
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind !== "ask-human") return;
    expect(verdict.risk).toBe("medium");
    expect(verdict.timeoutMs).toBeGreaterThan(0);
    const details = verdict.action.details ?? [];
    expect(
      details.find((detail) => detail.label === ALLOWLIST_DETAIL_LABELS.actionKind)?.value,
    ).toBe("fs.write");
    expect(details.find((detail) => detail.label === ALLOWLIST_DETAIL_LABELS.scopeKey)?.value).toBe(
      fixture.project,
    );
    expect(verdict.action.toolInput).toEqual({ path: "new.md", content: "x" });
  });

  it("禁止項直接拒絕，不建立審批", async () => {
    const verdict = await evaluate("read_file", { path: ".ssh/id_ed25519" });
    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") {
      expect(verdict.reason).toContain("deny.credentials");
    }
  });

  it("不認得的工具一律詢問，而且不提供一律允許", async () => {
    const verdict = await evaluate("unknown_tool", { anything: true });
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind !== "ask-human") return;
    expect(verdict.risk).toBe("high");
    const request = {
      id: "apr-x",
      status: "pending" as const,
      requestedAt: new Date().toISOString(),
      expiresAt: null,
      approvalKey: "k",
      draft: {
        action: verdict.action,
        risk: verdict.risk,
        requestedBy: { kind: "tool" as const, toolName: "unknown_tool" },
      },
    };
    expect(alwaysAllowTarget(request)).toBeNull();
  });

  it("指令：唯讀查詢放行，其餘詢問，串接與子殼層依規則", async () => {
    expect(await evaluate("run_command", { command: "git status" })).toEqual({ kind: "allow" });
    const push = await evaluate("run_command", { command: "git push" });
    expect(push.kind === "ask-human" && push.risk).toBe("high");
    const folderGate = createToolPermissionGate({
      workingDir: fixture.folder,
      folderRoot: fixture.folder,
      allowlist: store,
    });
    const chained = await folderGate.evaluate(
      request("run_command", { command: "git status; rm -rf cards" }),
    );
    expect(chained.kind).toBe("deny");
    const subshell = await evaluate("run_command", { command: "bash -c 'cat .env'" });
    expect(subshell.kind).toBe("deny");
    const plainSubshell = await evaluate("run_command", { command: "bash -c 'echo hi'" });
    expect(plainSubshell.kind).toBe("ask-human");
  });

  it("cwd 不合法時拒絕", async () => {
    const verdict = await evaluate("run_command", { command: "ls", cwd: "a\0b" });
    expect(verdict.kind).toBe("deny");
  });
});

describe("白名單只覆蓋詢問，不覆蓋禁止", () => {
  it("同工具同目錄的下一次寫檔不再詢問", async () => {
    expect((await evaluate("write_file", { path: "new.md", content: "x" })).kind).toBe("ask-human");
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    expect(await evaluate("write_file", { path: "new.md", content: "x" })).toEqual({
      kind: "allow",
    });
    expect(await evaluate("write_file", { path: "sub/a.md", content: "x" })).toEqual({
      kind: "allow",
    });
  });

  it("目錄之外的路徑仍然詢問", async () => {
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    expect(
      (await evaluate("write_file", { path: join(fixture.outside, "a.md"), content: "x" })).kind,
    ).toBe("ask-human");
  });

  it("有白名單時，憑證與系統目錄仍然拒絕", async () => {
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    store.grant({
      toolName: "read_file",
      scopeKey: fixture.project,
      actionKind: "fs.read",
      createdBy: "client-1",
    });
    expect((await evaluate("write_file", { path: ".env", content: "x" })).kind).toBe("deny");
    expect((await evaluate("read_file", { path: ".env" })).kind).toBe("deny");
    expect((await evaluate("write_file", { path: "/etc/hosts", content: "x" })).kind).toBe("deny");
  });

  it("run_command 的白名單不能推翻正本區整批刪除", async () => {
    store.grant({
      toolName: "run_command",
      scopeKey: fixture.folder,
      actionKind: "shell.exec",
      createdBy: "client-1",
    });
    const gateAtFolder = createToolPermissionGate({
      workingDir: fixture.folder,
      folderRoot: fixture.folder,
      allowlist: store,
    });
    expect(
      (await gateAtFolder.evaluate(request("run_command", { command: "npm install", cwd: "." })))
        .kind,
    ).toBe("allow");
    expect(
      (await gateAtFolder.evaluate(request("run_command", { command: "rm -rf cards" }))).kind,
    ).toBe("deny");
  });

  it("run_command 的白名單不能放行保護目標的寫入", async () => {
    store.grant({
      toolName: "run_command",
      scopeKey: fixture.project,
      actionKind: "shell.exec",
      createdBy: "client-1",
    });
    const state = join(fixture.folder, "state", "cardiary.sqlite");
    const card = join(fixture.folder, "cards", "a.md");
    const commands = [
      `cp payload.sqlite ${state}`,
      `mv ${state} /tmp/cardiary-mv`,
      `tee ${state}`,
      `install payload.sqlite ${state}`,
      `sed -i '' s/a/b/ ${card}`,
      `rsync -a notes.md ${state}`,
      `find -- ${join(fixture.folder, "cards")} -delete`,
    ];
    for (const command of commands) {
      const verdict = await evaluate("run_command", { command });
      expect({ command, kind: verdict.kind }).toEqual({ command, kind: "deny" });
    }
    // 對照組：一般的寫入仍然照白名單放行。
    expect(await evaluate("run_command", { command: "cp notes.md copy.md" })).toEqual({
      kind: "allow",
    });
  });

  it("白名單的動作種類不同時不命中", async () => {
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.project,
      actionKind: "fs.read",
      createdBy: "client-1",
    });
    expect((await evaluate("write_file", { path: "new.md", content: "x" })).kind).toBe("ask-human");
  });

  it("目錄的白名單不能放行大小寫變體的狀態資料庫", async () => {
    store.grant({
      toolName: "write_file",
      scopeKey: fixture.folder,
      actionKind: "fs.write",
      createdBy: "client-1",
    });
    const folderGate = createToolPermissionGate({
      workingDir: fixture.folder,
      folderRoot: fixture.folder,
      allowlist: store,
    });
    // 對照組：白名單確實生效，卡片可以寫。
    expect(
      (await folderGate.evaluate(request("write_file", { path: "cards/a.md", content: "x" }))).kind,
    ).toBe("allow");
    const variant = await folderGate.evaluate(
      request("write_file", { path: "STATE/cardiary.sqlite", content: "x" }),
    );
    if (detectCaseSensitivity(fixture.folder) === "case-insensitive") {
      // 大小寫不敏感時是同一個狀態庫檔案，不能被「一律允許」放行。
      expect(variant.kind).toBe("deny");
      const upper = await folderGate.evaluate(
        request("write_file", { path: "STATE/CARDIARY.SQLITE", content: "x" }),
      );
      expect(upper.kind).toBe("deny");
    } else {
      // 大小寫敏感時是資料夾之內的不同檔案，走白名單。
      expect(variant.kind).toBe("allow");
    }
  });

  it("刪除的審批帶解析後的路徑", async () => {
    const deleteGate = createToolPermissionGate({
      workingDir: fixture.project,
      folderRoot: fixture.folder,
      allowlist: store,
      resolveAction: (toolName, input) =>
        toolName === "delete_path"
          ? {
              kind: "fs.delete",
              path: (input as { readonly path: string }).path,
              recursive: false,
            }
          : null,
    });
    const verdict = await deleteGate.evaluate(request("delete_path", { path: "sub/link.md" }));
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind !== "ask-human") return;
    const details = verdict.action.details ?? [];
    expect(details.find((detail) => detail.label === "解析後的路徑")?.value).toBe(
      join(fixture.project, "sub", "link.md"),
    );
  });
});
