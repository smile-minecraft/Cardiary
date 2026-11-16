/**
 * 委派的最後一層判斷：從人的設定、模型回覆到稽核的整合測試。
 *
 * 這裡用永遠回 `ask-human` 的基底閘道，專門驗證委派層沒有把東西放行。
 * 硬規則的 `deny`／`allow` 不在這層改動，由既有的閘道測試負責。
 */

import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ToolPermissionGate, ToolPermissionRequest } from "@cardiary/engine-adapter";

import { AgentAudit } from "../../src/permissions/agent-audit.js";
import { AgentPermissions } from "../../src/permissions/agent-permissions.js";
import {
  createDelegatingGate,
  DelegatedApproval,
  type DelegationReviewer,
} from "../../src/permissions/delegation.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(options: { maxAuditBytes?: number } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-delegation-")));
  roots.push(root);
  const state = join(root, "state");
  const project = join(root, "project");
  mkdirSync(state);
  mkdirSync(project);
  const diagnostics: string[] = [];
  const permissions = new AgentPermissions(state, {
    diagnostic: (text) => diagnostics.push(text),
  });
  const audit = new AgentAudit(state, options.maxAuditBytes);
  let probability: number | undefined = 1;
  let modelId: string | null = "model-1";
  const reviewer: DelegationReviewer = async () => ({ probability, modelId });
  let now = 0;
  const approval = new DelegatedApproval({
    permissions,
    audit,
    reviewer,
    roots: { workingDir: project, folderRoot: project },
    now: () => now,
  });
  const base: ToolPermissionGate = {
    async evaluate(request) {
      return {
        kind: "ask-human",
        risk: "medium",
        action: {
          kind: "tool-execution",
          summary: "測試動作",
          toolName: request.toolName as never,
          toolInput: request.input,
        },
      };
    },
  };
  const gate = createDelegatingGate(base, approval);
  const request = (
    toolName: string,
    input: unknown,
    conversationId = "c1",
  ): ToolPermissionRequest => ({
    conversationId,
    turnId: "t1",
    toolCallId: "call-1",
    toolName: toolName as never,
    input: input as never,
    replay: "unsafe",
    permissionMode: "hard-rules",
  });
  return {
    root,
    state,
    project,
    permissions,
    audit,
    diagnostics,
    gate,
    request,
    setProbability: (value: number | undefined) => {
      probability = value;
    },
    setModelId: (value: string | null) => {
      modelId = value;
    },
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe("委派的預設與封閉清單", () => {
  it("預設全關時，連機率 1 的委派動作也退回人工", async () => {
    const fixture = setup();
    expect(
      await fixture.gate.evaluate(fixture.request("read_file", { path: "notes.md" })),
    ).toMatchObject({
      kind: "ask-human",
    });
    expect(
      await fixture.gate.evaluate(
        fixture.request("run_command", { command: "git status", cwd: fixture.project }),
      ),
    ).toMatchObject({ kind: "ask-human" });
    expect(
      await fixture.gate.evaluate(fixture.request("card_create", { kind: "note" })),
    ).toMatchObject({
      kind: "ask-human",
    });
  });

  it("開啟類別後，只有授權範圍內的唯讀動作放行", async () => {
    const fixture = setup();
    fixture.permissions.setCategory("read-only-files", true, [fixture.project]);
    expect(await fixture.gate.evaluate(fixture.request("read_file", { path: "notes.md" }))).toEqual(
      {
        kind: "allow",
      },
    );
    // 授權路徑之外：類別開了也不生效。
    expect(
      await fixture.gate.evaluate(fixture.request("read_file", { path: "/etc/passwd" })),
    ).toMatchObject({ kind: "ask-human" });
  });

  it("永遠禁止項即使所有類別都開、機率 1 也不放行", async () => {
    const fixture = setup();
    for (const category of [
      "read-only-files",
      "git-readonly",
      "create-card",
      "own-notification",
    ] as const) {
      fixture.permissions.setCategory(category, true, []);
    }
    fixture.permissions.setCategory("read-only-files", true, [fixture.project]);
    fixture.permissions.setCategory("git-readonly", true, [fixture.project]);
    const forbidden: ReadonlyArray<[string, unknown]> = [
      ["write_file", { path: "notes.md", content: "x" }], // fs.write
      ["run_command", { command: "rm -rf cards", cwd: fixture.project }], // 非唯讀 shell
      ["run_command", { command: "git push", cwd: fixture.project }], // 非唯讀 git
      ["run_command", { command: "git status; rm -rf x", cwd: fixture.project }], // 串接指令
      ["http_get", { url: "https://example.com" }], // 對外網路
      ["mcp_call", { serverId: "s", toolName: "t" }], // MCP
      ["external_agent", { agent: "a", command: "c" }], // 外部代理
      ["settings_change", { key: "allowlist", level: "approval" }], // 權限設定
      ["unknown_tool", {}], // 不認識的工具
    ];
    for (const [toolName, input] of forbidden) {
      const verdict = await fixture.gate.evaluate(fixture.request(toolName, input));
      expect(verdict.kind, `${toolName} 不得自動放行`).toBe("ask-human");
    }
  });
});

describe("System One 的機率判定", () => {
  function enableReadOnly(fixture: ReturnType<typeof setup>) {
    fixture.permissions.setCategory("read-only-files", true, [fixture.project]);
  }

  it("p=0.90 放行，p=0.70 與中間值退回人工並附理由", async () => {
    const fixture = setup();
    enableReadOnly(fixture);
    const read = () => fixture.gate.evaluate(fixture.request("read_file", { path: "notes.md" }));

    fixture.setProbability(0.9);
    expect(await read()).toEqual({ kind: "allow" });

    fixture.setProbability(0.8999);
    const middle = await read();
    expect(middle.kind).toBe("ask-human");
    if (middle.kind === "ask-human") {
      expect(middle.action.details?.some((d) => String(d.value).includes("把握不足"))).toBe(true);
    }

    fixture.setProbability(0.7);
    expect((await read()).kind).toBe("ask-human");
    fixture.setProbability(0.6999);
    expect((await read()).kind).toBe("ask-human");
  });

  it("格式錯誤、逾時、缺回應（沒有機率）一律退回人工", async () => {
    const fixture = setup();
    enableReadOnly(fixture);
    for (const value of [undefined, Number.NaN, -1, 1.01]) {
      fixture.setProbability(value);
      expect(
        (await fixture.gate.evaluate(fixture.request("read_file", { path: "notes.md" }))).kind,
        `p=${value}`,
      ).toBe("ask-human");
    }
  });

  it("每場對話最多 20 次，超過後重新詢問", async () => {
    const fixture = setup();
    enableReadOnly(fixture);
    const read = () => fixture.gate.evaluate(fixture.request("read_file", { path: "notes.md" }));
    for (let i = 0; i < 20; i += 1) {
      expect(await read()).toEqual({ kind: "allow" });
    }
    const exhausted = await read();
    expect(exhausted.kind).toBe("ask-human");
    if (exhausted.kind === "ask-human") {
      expect(exhausted.action.details?.some((d) => String(d.value).includes("次數已用完"))).toBe(
        true,
      );
    }
    // 另一場對話有獨立的額度。
    expect(
      await fixture.gate.evaluate(fixture.request("read_file", { path: "notes.md" }, "c2")),
    ).toEqual({ kind: "allow" });
  });
});

describe("全部允許模式", () => {
  it("到期自動失效", async () => {
    const fixture = setup();
    fixture.permissions.grantAllowAll({ tools: ["read_file"], paths: [fixture.project] }, 0);
    const read = () => fixture.gate.evaluate(fixture.request("read_file", { path: "notes.md" }));
    fixture.setNow(899_999);
    expect(await read()).toEqual({ kind: "allow" });
    fixture.setNow(900_000);
    expect((await read()).kind).toBe("ask-human");
  });

  it("工具或路徑在範圍外不生效", async () => {
    const fixture = setup();
    fixture.permissions.grantAllowAll({ tools: ["read_file"], paths: [fixture.project] }, 0);
    expect(
      (
        await fixture.gate.evaluate(
          fixture.request("write_file", { path: "notes.md", content: "x" }),
        )
      ).kind,
    ).toBe("ask-human");
    expect(
      (await fixture.gate.evaluate(fixture.request("read_file", { path: "/etc/passwd" }))).kind,
    ).toBe("ask-human");
  });

  it("全部允許也不涵蓋禁止項：非唯讀 shell、設定、MCP、外部代理", async () => {
    const fixture = setup();
    fixture.permissions.grantAllowAll(
      {
        tools: ["run_command", "settings_change", "mcp_call", "external_agent"],
        paths: [fixture.project],
      },
      0,
    );
    const cases: ReadonlyArray<[string, unknown]> = [
      ["run_command", { command: "rm -rf cards", cwd: fixture.project }],
      ["settings_change", { key: "allowlist", level: "approval" }],
      ["mcp_call", { serverId: "s", toolName: "t" }],
      ["external_agent", { agent: "a", command: "c" }],
    ];
    for (const [toolName, input] of cases) {
      expect((await fixture.gate.evaluate(fixture.request(toolName, input))).kind, toolName).toBe(
        "ask-human",
      );
    }
  });

  it("全部允許也不涵蓋僅限人類的狀態檔：MCP 設定、狀態庫、資料夾設定", async () => {
    const fixture = setup();
    fixture.permissions.grantAllowAll({ tools: ["write_file"], paths: [fixture.project] }, 0);
    // 同一份授權對一般檔案有效，證明放行不是因為授權根本沒生效。
    expect(
      (
        await fixture.gate.evaluate(
          fixture.request("write_file", { path: "notes.md", content: "x" }),
        )
      ).kind,
    ).toBe("allow");
    const cases: ReadonlyArray<[string, unknown]> = [
      ["write_file", { path: "state/mcp-servers.json", content: "{}" }],
      ["write_file", { path: "State/MCP-Servers.Json", content: "{}" }],
      ["write_file", { path: "state/cardiary.sqlite", content: "{}" }],
      ["write_file", { path: "state/folder.json", content: "{}" }],
    ];
    for (const [toolName, input] of cases) {
      expect((await fixture.gate.evaluate(fixture.request(toolName, input))).kind, toolName).toBe(
        "ask-human",
      );
    }
  });
});

describe("稽核與損毀復原", () => {
  it("只記參數雜湊，不記參數原文", async () => {
    const fixture = setup();
    fixture.permissions.setCategory("read-only-files", true, [fixture.project]);
    const secret = "super-secret-parameter-value";
    expect(
      await fixture.gate.evaluate(
        fixture.request("read_file", { path: "notes.md", token: secret }),
      ),
    ).toEqual({ kind: "allow" });
    const content = readFileSync(join(fixture.state, "agent-audit.jsonl"), "utf8");
    expect(content).not.toContain(secret);
    expect(content).toContain("inputHash");
    expect(content).toContain('"reason":"System One 通過"');
  });

  it("超過上限輪替到 .1", () => {
    const fixture = setup({ maxAuditBytes: 450 });
    for (let i = 0; i < 8; i += 1) {
      fixture.audit.append({
        conversationId: "c1",
        tool: "read_file",
        input: { path: `notes-${i}.md` },
        reason: "System One 通過",
        probability: 1,
        modelId: "model-1",
      });
    }
    expect(readFileSync(join(fixture.state, "agent-audit.jsonl.1"), "utf8").length).toBeGreaterThan(
      0,
    );
  });

  it("設定檔損毀時全部關閉且記診斷，連機率 1 也不放行", async () => {
    const fixture = setup();
    fixture.permissions.setCategory("read-only-files", true, [fixture.project]);
    // 直接寫壞檔案後重建服務，模擬磁碟上的資料損毀。
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(fixture.state, "agent-permissions.json"), "{broken");
    const recovered = new AgentPermissions(fixture.state, {
      diagnostic: (text) => fixture.diagnostics.push(text),
    });
    expect(recovered.status("c1", 0).categories).toEqual([]);
    expect(fixture.diagnostics.length).toBeGreaterThan(0);
    const approval = new DelegatedApproval({
      permissions: recovered,
      audit: fixture.audit,
      reviewer: async () => ({ probability: 1, modelId: "model-1" }),
      roots: { workingDir: fixture.project, folderRoot: fixture.project },
      now: () => 0,
    });
    const verdict = await approval.evaluate(fixture.request("read_file", { path: "notes.md" }), {
      kind: "ask-human",
      risk: "medium",
      action: { kind: "tool-execution", summary: "test" },
    });
    expect(verdict.kind).toBe("ask-human");
  });
});
