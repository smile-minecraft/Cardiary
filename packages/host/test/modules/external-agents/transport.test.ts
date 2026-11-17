import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

import {
  AGENT_COMMAND_ENV,
  ACP_IDS,
  agentArgs,
  agentEnv,
  encodeAcpCancel,
  encodeAcpInitialize,
  encodeAcpPermissionReply,
  encodeAcpPrompt,
  encodeAcpSessionNew,
  encodeAcpSetMode,
  encodeAcpSetModel,
  resolveAgentCommand,
  resolveClaudeAcpEntry,
  resolveClaudeCliPath,
} from "../../../src/modules/external-agents/transport.js";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.values(AGENT_COMMAND_ENV)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("外部代理指令與環境", () => {
  it("沒有覆寫時 Opencode 用 opencode、Claude 用本機 Node 執行 adapter", () => {
    delete process.env[AGENT_COMMAND_ENV.opencode];
    delete process.env[AGENT_COMMAND_ENV["claude-code"]];

    expect(resolveAgentCommand("opencode")).toBe("opencode");
    expect(resolveAgentCommand("claude-code")).toBe(process.execPath);
  });

  it("環境變數覆寫只影響對應的種類", () => {
    process.env[AGENT_COMMAND_ENV.opencode] = "/tmp/fake-opencode";

    expect(resolveAgentCommand("opencode")).toBe("/tmp/fake-opencode");
    expect(resolveAgentCommand("claude-code")).toBe(process.execPath);
  });

  it("Claude 的啟動參數是本機 adapter 的 dist/index.js，不是 stream-json 旗標", () => {
    delete process.env[AGENT_COMMAND_ENV["claude-code"]];
    const entry = resolveClaudeAcpEntry();
    expect(entry.endsWith(join("claude-agent-acp", "dist", "index.js"))).toBe(true);
    expect(agentArgs("claude-code")).toEqual([entry]);
    expect(agentArgs("opencode")).toEqual(["acp"]);
  });

  it("命令覆寫時不帶 adapter 參數，讓假代理 wrapper 自己吃 stdin", () => {
    process.env[AGENT_COMMAND_ENV["claude-code"]] = "/tmp/fake-claude";
    expect(resolveAgentCommand("claude-code")).toBe("/tmp/fake-claude");
    expect(agentArgs("claude-code")).toEqual([]);
  });

  it("代理環境只帶必要變數，不繼承主機可能藏有 token 的環境", () => {
    const env = agentEnv("opencode", {
      home: "/cache/agent/home",
      tmpDir: "/tmp/agent",
      pathEnv: "/opt/bin:/usr/bin",
    });

    expect(env.PATH).toBe("/opt/bin:/usr/bin");
    expect(env.HOME).toBe("/cache/agent/home");
    expect(env.TMPDIR).toBe("/tmp/agent");
    expect(env.OPENCODE_CONFIG_DIR).toBe("/cache/agent/home/.config/opencode");
    expect(env.CARDIARY_TEST_FAULTS).toBeUndefined();
    expect(env.CARDIARY_AGENT_COMMAND_OPENCODE).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it("Claude 固定 ACP v1、補 USER 身份，預設用解析出的 claude CLI，但不帶 token、不設 CLAUDE_CONFIG_DIR", () => {
    vi.stubEnv("CARDIARY_CLAUDE_CLI", process.execPath);
    try {
      const env = agentEnv("claude-code", {
        home: "/cache/agent/home",
        tmpDir: "/tmp/agent",
        pathEnv: undefined,
      });

      expect(env.CLAUDE_AGENT_ACP_PROTOCOL).toBe("v1");
      expect(env.USER).toBe(process.env.USER ?? "cardiary");
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(env.CLAUDE_CODE_EXECUTABLE).toBe(process.execPath);
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
      expect(env.PATH).toBe("/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resolveClaudeCliPath 優先用環境變數，環境變數不可執行時退回內建路徑", () => {
    vi.stubEnv("CARDIARY_CLAUDE_CLI", process.execPath);
    expect(resolveClaudeCliPath()).toBe(process.execPath);

    vi.stubEnv("CARDIARY_CLAUDE_CLI", "/nonexistent/claude");
    const fallback = resolveClaudeCliPath();
    // 內建路徑只回傳確實存在且可執行的；沒有任何內建 CLI 時回 undefined。
    if (fallback !== undefined) {
      expect(["/opt/homebrew/bin/claude", "/usr/local/bin/claude"]).toContain(fallback);
    }
    vi.unstubAllEnvs();
  });

  it("Claude 傳入 credential 時才注入 OAuth 權杖，且只進子行程環境", () => {
    const env = agentEnv("claude-code", {
      home: "/cache/agent/home",
      tmpDir: "/tmp/agent",
      pathEnv: undefined,
      credential: "sk-ant-testcredential123456",
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-testcredential123456");
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it("Claude 傳入 claudeCliPath 時覆蓋預設的 claude", () => {
    const env = agentEnv("claude-code", {
      home: "/cache/agent/home",
      tmpDir: "/tmp/agent",
      pathEnv: undefined,
      claudeCliPath: "/opt/bin/claude",
    });

    expect(env.CLAUDE_CODE_EXECUTABLE).toBe("/opt/bin/claude");
  });

  it("OpenCode 環境不得有 Claude 權杖或執行檔設定", () => {
    const env = agentEnv("opencode", {
      home: "/cache/agent/home",
      tmpDir: "/tmp/agent",
      pathEnv: undefined,
      credential: "sk-ant-testcredential123456",
      claudeCliPath: "/opt/bin/claude",
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
  });
});

describe("ACP 協定訊息編碼（OpenCode 與 Claude 共用）", () => {
  it("ACP 初始化用固定 id 1，session/new 帶工作目錄且不掛 MCP", () => {
    const initialize = parse(encodeAcpInitialize());
    expect(initialize).toMatchObject({
      jsonrpc: "2.0",
      id: ACP_IDS.initialize,
      method: "initialize",
      params: { protocolVersion: 1 },
    });

    const sessionNew = parse(encodeAcpSessionNew("/work"));
    expect(sessionNew).toMatchObject({
      jsonrpc: "2.0",
      id: ACP_IDS.sessionNew,
      method: "session/new",
      params: { cwd: "/work", mcpServers: [] },
    });
  });

  it("只有 Claude 的 session/new 關閉跳過權限選項", () => {
    expect(parse(encodeAcpSessionNew("/work", { claudeCode: true }))).toEqual({
      jsonrpc: "2.0",
      id: ACP_IDS.sessionNew,
      method: "session/new",
      params: {
        cwd: "/work",
        mcpServers: [],
        _meta: { claudeCode: { options: { allowDangerouslySkipPermissions: false } } },
      },
    });
    expect(parse(encodeAcpSessionNew("/work", { claudeCode: false }))).toEqual({
      jsonrpc: "2.0",
      id: ACP_IDS.sessionNew,
      method: "session/new",
      params: { cwd: "/work", mcpServers: [] },
    });
  });

  it("session/prompt 帶 sessionId 與文字，id 固定在 100 給橋接層認", () => {
    expect(parse(encodeAcpPrompt("sess_1", "整理這份文件"))).toEqual({
      jsonrpc: "2.0",
      id: 100,
      method: "session/prompt",
      params: { sessionId: "sess_1", prompt: [{ type: "text", text: "整理這份文件" }] },
    });
  });

  it("ACP set_model 必須帶 sessionId，否則 OpenCode 回 Invalid params", () => {
    expect(parse(encodeAcpSetModel("opencode/iceman-free", "sess_9"))).toEqual({
      jsonrpc: "2.0",
      id: ACP_IDS.setModel,
      method: "session/set_config_option",
      params: {
        sessionId: "sess_9",
        configId: "model",
        value: "opencode/iceman-free",
      },
    });
  });

  it("ACP set_mode 用 configId mode 帶 sessionId，id 固定在 4", () => {
    expect(parse(encodeAcpSetMode("sess_9", "acceptEdits"))).toEqual({
      jsonrpc: "2.0",
      id: ACP_IDS.setMode,
      method: "session/set_config_option",
      params: {
        sessionId: "sess_9",
        configId: "mode",
        value: "acceptEdits",
      },
    });
  });

  it("cancel 是通知（無 id），帶 sessionId", () => {
    expect(parse(encodeAcpCancel("sess_9"))).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "sess_9" },
    });
  });

  it("ACP 權限回覆用伺服器實際给的 optionId，不是 kind 字串，且 id 保留原型", () => {
    // OpenCode 2.2.7 回的 optionId 是 once/always/reject，kind 才是 allow_once 等。
    // 官方 Claude adapter 也有自己的 optionId；回錯會被當成拒絕，整回合被取消。
    expect(parse(encodeAcpPermissionReply("42", "once"))).toEqual({
      jsonrpc: "2.0",
      id: "42",
      result: { outcome: { outcome: "selected", optionId: "once" } },
    });
    expect(parse(encodeAcpPermissionReply(42, "reject"))).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { outcome: { outcome: "selected", optionId: "reject" } },
    });
  });
});

function parse(line: string): Record<string, unknown> {
  expect(line.endsWith("\n")).toBe(true);
  return JSON.parse(line.trim()) as Record<string, unknown>;
}
