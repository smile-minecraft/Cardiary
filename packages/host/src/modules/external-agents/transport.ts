/**
 * 外部代理的子行程指令、環境與供應商協定的訊息編碼。
 *
 * 這裡只放「怎麼啟動」和「訊息怎麼長」；狀態、審批與耐久紀錄在 `service.ts`。
 * 指令預設是產品的二進位，契約測試用環境變數換成假代理腳本：
 * `CARDIARY_AGENT_COMMAND_OPENCODE`／`CARDIARY_AGENT_COMMAND_CLAUDE_CODE`
 * 指向假代理的絕對路徑（可執行，例如帶 shebang 的 Node 腳本）。
 */
import type { ExternalAgentKind } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";

/** 依種類覆寫指令的環境變數名；測試與除錯用，產品不設。 */
export const AGENT_COMMAND_ENV = {
  opencode: "CARDIARY_AGENT_COMMAND_OPENCODE",
  "claude-code": "CARDIARY_AGENT_COMMAND_CLAUDE_CODE",
} as const;

/** 依種類解析實際要啟動的二進位；只回傳指令，不含 sandbox 外殼。 */
export function resolveAgentCommand(kind: ExternalAgentKind): string {
  const override = process.env[AGENT_COMMAND_ENV[kind]];
  if (override && override.length > 0) return override;
  return kind === "opencode" ? "opencode" : "claude";
}

/** 依種類回傳啟動參數。Claude Code 必須帶 `--permission-prompt-tool stdio`，否則權限請求會被靜默拒絕。 */
export function agentArgs(kind: ExternalAgentKind): readonly string[] {
  if (kind === "opencode") return ["acp"];
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-prompt-tool",
    "stdio",
    // MCP 伺服器一律不載入；spike 實測這樣能把資料夾外寫入壓到預期的目錄。
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
  ];
}

export interface AgentEnvInput {
  /** 代理的專屬家目錄（`cache/agents/<session>/home`）。 */
  readonly home: string;
  /** 每次執行專屬的暫存目錄（`tmp/agents/<session>`）。 */
  readonly tmpDir: string;
  /** 主機的 PATH；子行程要找得到 `opencode`／`claude` 與 `node`。 */
  readonly pathEnv: string | undefined;
}

/**
 * 子行程的完整環境。
 *
 * 不從主機的環境繼承：主機進程裡可能有 token，洩漏給代理沒有好處。
 * 只帶 PATH 與語系，加上導向專屬目錄的 HOME／XDG 變數。
 *
 * Claude Code 不帶 `CLAUDE_CONFIG_DIR`（spike 實測指到其他目錄會變成
 * 未登入），它依舊會寫 `~/.claude` 與 `~/Library/Caches/claude-cli-nodejs`，
 * 這兩個固定目錄在 sandbox 裡有窄放行，其餘一律拒絕並列入儲存空間統計。
 */
export function agentEnv(kind: ExternalAgentKind, input: AgentEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: input.pathEnv ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    HOME: input.home,
    TMPDIR: input.tmpDir,
    XDG_CONFIG_HOME: `${input.home}/.config`,
    XDG_DATA_HOME: `${input.home}/.local/share`,
    XDG_CACHE_HOME: `${input.home}/.cache`,
    XDG_STATE_HOME: `${input.home}/.local/state`,
  };
  if (kind === "opencode") {
    // 明確指向配置目錄；OpenCode 在這裡讀 opencode.json（橋接層會預寫 ask 規則）。
    env.OPENCODE_CONFIG_DIR = `${input.home}/.config/opencode`;
  }
  return env;
}

// ---- OpenCode ACP -------------------------------------------------------

/** ACP 的 JSON-RPC 請求 id；橋接層自己配對，Claude Code 沒有這一層。 */
export const ACP_IDS = {
  initialize: 1,
  sessionNew: 2,
  setModel: 3,
} as const;

export function encodeAcpInitialize(): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: ACP_IDS.initialize,
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      info: { name: "cardiary", version: "1.0.0" },
    },
  })}\n`;
}

export function encodeAcpSessionNew(cwd: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: ACP_IDS.sessionNew,
    method: "session/new",
    params: { cwd, mcpServers: [] },
  })}\n`;
}

export function encodeAcpSetModel(model: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: ACP_IDS.setModel,
    method: "session/set_config_option",
    params: { configId: "model", value: model },
  })}\n`;
}

export function encodeAcpPrompt(acpSessionId: string, text: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: 100,
    method: "session/prompt",
    params: { sessionId: acpSessionId, prompt: [{ type: "text", text }] },
  })}\n`;
}

export function encodeAcpCancel(acpSessionId: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    method: "session/cancel",
    params: { sessionId: acpSessionId },
  })}\n`;
}

/** ACP 對 `session/request_permission` 的回覆；`allow` 對應 allow_once，`deny` 對應 reject_once。 */
export function encodeAcpPermissionReply(requestId: number | string, allow: boolean): string {
  const outcome = allow
    ? { outcome: "selected", optionId: "allow_once" }
    : { outcome: "selected", optionId: "reject_once" };
  return `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { outcome } })}\n`;
}

// ---- Claude Code stream-json --------------------------------------------

export const CLAUDE_INITIALIZE_ID = "initialize-1";

export function encodeClaudeInitialize(): string {
  return `${JSON.stringify({
    type: "control_request",
    request_id: CLAUDE_INITIALIZE_ID,
    request: { subtype: "initialize" },
  })}\n`;
}

export function encodeClaudeUser(text: string): string {
  return `${JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  })}\n`;
}

/** Claude Code 對 `can_use_tool` 的回覆；允許要帶回 `updatedInput`，拒絕要帶理由。 */
export function encodeClaudePermissionReply(
  requestId: string,
  decision: "allow" | "deny",
  options: { readonly updatedInput?: JsonValue; readonly message?: string },
): string {
  const response: Record<string, JsonValue> =
    decision === "allow"
      ? { behavior: "allow", updatedInput: options.updatedInput ?? {} }
      : { behavior: "deny", message: options.message ?? "使用者拒絕這個動作" };
  return `${JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response },
  })}\n`;
}

export function encodeClaudeInterrupt(requestId: string): string {
  return `${JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype: "interrupt" },
  })}\n`;
}
