import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_COMMAND_ENV,
  ACP_IDS,
  agentArgs,
  agentEnv,
  encodeAcpInitialize,
  encodeAcpPermissionReply,
  encodeAcpPrompt,
  encodeAcpSetModel,
  encodeClaudePermissionReply,
  encodeClaudeUser,
  resolveAgentCommand,
} from "../../../src/modules/external-agents/transport.js";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.values(AGENT_COMMAND_ENV)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("外部代理指令與環境", () => {
  it("沒有覆寫時用產品預設的二進位", () => {
    delete process.env[AGENT_COMMAND_ENV.opencode];
    delete process.env[AGENT_COMMAND_ENV["claude-code"]];

    expect(resolveAgentCommand("opencode")).toBe("opencode");
    expect(resolveAgentCommand("claude-code")).toBe("claude");
  });

  it("環境變數覆寫只影響對應的種類", () => {
    process.env[AGENT_COMMAND_ENV.opencode] = "/tmp/fake-opencode";

    expect(resolveAgentCommand("opencode")).toBe("/tmp/fake-opencode");
    expect(resolveAgentCommand("claude-code")).toBe("claude");
  });

  it("Claude Code 一定帶 permission-prompt-tool stdio，否則權限請求會被靜默拒絕", () => {
    const args = agentArgs("claude-code");
    const index = args.indexOf("--permission-prompt-tool");
    expect(index).toBeGreaterThan(-1);
    expect(args[index + 1]).toBe("stdio");
    expect(args).toContain("--strict-mcp-config");
    expect(agentArgs("opencode")).toEqual(["acp"]);
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

  it("Claude Code 不帶 CLAUDE_CONFIG_DIR；spike 實測指到別處會變成未登入", () => {
    const env = agentEnv("claude-code", {
      home: "/cache/agent/home",
      tmpDir: "/tmp/agent",
      pathEnv: undefined,
    });

    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
    expect(env.PATH).toBe("/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin");
  });
});

describe("供應商協定訊息編碼", () => {
  it("ACP 初始化用固定 id 1，session/new 帶工作目錄且不掛 MCP", () => {
    const initialize = parse(encodeAcpInitialize());
    expect(initialize).toMatchObject({
      jsonrpc: "2.0",
      id: ACP_IDS.initialize,
      method: "initialize",
      params: { protocolVersion: 1 },
    });

    const prompt = parse(encodeAcpPrompt("sess_1", "整理這份文件"));
    expect(prompt).toMatchObject({
      jsonrpc: "2.0",
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

  it("ACP 權限回覆用伺服器實際给的 optionId，不是 kind 字串", () => {
    // OpenCode 2.2.7 回的 optionId 是 once/always/reject，kind 才是 allow_once 等。
    // 回錯 optionId 會讓 OpenCode 當成拒絕，整回合被取消。
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

  it("Claude 的允許與拒絕都帶同一個 request_id，拒絕帶訊息給代理", () => {
    const allow = parse(encodeClaudePermissionReply("req_7", "allow", { updatedInput: { a: 1 } }));
    expect(allow).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req_7",
        response: { behavior: "allow", updatedInput: { a: 1 } },
      },
    });

    const deny = parse(encodeClaudePermissionReply("req_7", "deny", { message: "使用者拒絕" }));
    expect(deny).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req_7",
        response: { behavior: "deny", message: "使用者拒絕" },
      },
    });
  });

  it("Claude 的使用者訊息是 stream-json 的一行", () => {
    expect(parse(encodeClaudeUser("寫一個測試"))).toMatchObject({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "寫一個測試" }] },
    });
  });
});

function parse(line: string): Record<string, unknown> {
  expect(line.endsWith("\n")).toBe(true);
  return JSON.parse(line.trim()) as Record<string, unknown>;
}
