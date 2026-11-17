/**
 * 外部代理的子行程指令、環境與供應商協定的訊息編碼。
 *
 * 這裡只放「怎麼啟動」和「訊息怎麼長」；狀態、審批與耐久紀錄在 `service.ts`。
 * 指令預設是產品的二進位，契約測試用環境變數換成假代理腳本：
 * `CARDIARY_AGENT_COMMAND_OPENCODE`／`CARDIARY_AGENT_COMMAND_CLAUDE_CODE`
 * 指向假代理的絕對路徑（可執行，例如帶 shebang 的 Node 腳本）。
 *
 * 兩種代理都講 ACP：OpenCode 直接用 `opencode acp`；Claude 用官方
 * `@agentclientprotocol/claude-agent-acp` adapter，以本機 Node 執行它的
 * `dist/index.js`。adapter 是本機相依，不在啟動時用 npx 下載。
 */
import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ExternalAgentKind } from "@cardiary/domain";

/** 依種類覆寫指令的環境變數名；測試與除錯用，產品不設。 */
export const AGENT_COMMAND_ENV = {
  opencode: "CARDIARY_AGENT_COMMAND_OPENCODE",
  "claude-code": "CARDIARY_AGENT_COMMAND_CLAUDE_CODE",
} as const;

/** 官方 Claude ACP adapter 的套件名（精確版號鎖在 host/package.json）。 */
const CLAUDE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp";

let cachedClaudeAcpEntry: string | undefined;

/**
 * 解析官方 Claude ACP adapter 的 CLI 進入點（`dist/index.js`）。
 *
 * 從 host 套件的位置解析，所以本機開發（`src/`）、建置後（`dist/`）與 App
 * 打包（`pnpm --filter @cardiary/host deploy --prod`）都能找到同一份本機相依。
 * 只用 createRequire 解析套件的 `package.json`（exports 有開放），再拼上進入點；
 * 不在啟動時下載，也不依賴 npx。
 */
export function resolveClaudeAcpEntry(): string {
  if (cachedClaudeAcpEntry) return cachedClaudeAcpEntry;
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve(`${CLAUDE_ACP_PACKAGE}/package.json`);
  cachedClaudeAcpEntry = join(dirname(manifestPath), "dist/index.js");
  return cachedClaudeAcpEntry;
}

/**
 * 解析 adapter 要執行的 `claude` CLI 路徑。
 *
 * 依序試環境變數、Homebrew 與 /usr/local/bin，只回傳實際存在且可執行的路徑。
 * Finder 啟動的 App PATH 精簡，仍要能找到 claude；都找不到回 undefined，讓呼叫端退回 "claude"。
 */
export function resolveClaudeCliPath(): string | undefined {
  const candidates = [
    process.env.CARDIARY_CLAUDE_CLI,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate.length === 0) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 這個候選路徑不存在或不可執行，試下一個。
    }
  }
  return undefined;
}

/** 依種類解析實際要啟動的二進位；只回傳指令，不含 sandbox 外殼。 */
export function resolveAgentCommand(kind: ExternalAgentKind): string {
  const override = process.env[AGENT_COMMAND_ENV[kind]];
  if (override && override.length > 0) return override;
  // Claude 的 adapter 是 Node 程式，用當前 Node（App 內是內嵌的 Node）執行。
  return kind === "opencode" ? "opencode" : process.execPath;
}

/** 依種類回傳啟動參數。控制面板/權限請求由 ACP 的 session/request_permission 處理，不用命令列旗標。 */
export function agentArgs(kind: ExternalAgentKind): readonly string[] {
  if (kind === "opencode") return ["acp"];
  const override = process.env[AGENT_COMMAND_ENV[kind]];
  if (override && override.length > 0) return [];
  return [resolveClaudeAcpEntry()];
}

export interface AgentEnvInput {
  /** 代理的專屬家目錄（`cache/agents/<session>/home`）。 */
  readonly home: string;
  /** 每次執行專屬的暫存目錄（`tmp/agents/<session>`）。 */
  readonly tmpDir: string;
  /** 主機的 PATH；adapter 需要找到 `node` 與機上的 `claude` CLI。 */
  readonly pathEnv: string | undefined;
  /** Claude Code 的登入權杖；有值才注入子行程，不曾出現在紀錄或日誌。 */
  readonly credential?: string;
  /** 覆蓋 adapter 要執行的 `claude` CLI 路徑；預設用 PATH 上的 `claude`。 */
  readonly claudeCliPath?: string;
}

/**
 * 子行程的完整環境。
 *
 * 不從主機的環境繼承：主機進程裡可能有 token，洩漏給代理沒有好處。
 * 只帶 PATH 與語系，加上導向專屬目錄的 HOME／XDG 變數。
 *
 * Claude Code 的登入權杖由橋接層從憑證檔讀出，只注入子行程環境（`CLAUDE_CODE_OAUTH_TOKEN`），
 * 不寫入工作階段紀錄，也不進日誌；橋接層不碰 Keychain 或 broker。
 * `CLAUDE_CODE_EXECUTABLE` 指向 adapter 要執行的 `claude` CLI，可用 `claudeCliPath` 覆蓋。
 * adapter 固定講 ACP v1；補上標準身份變數 USER，但不設 `CLAUDE_CONFIG_DIR`。
 * adapter 仍會寫 `~/.claude`（此處是代理專屬家目錄）與
 * `~/Library/Caches/claude-cli-nodejs`，這兩個目錄在 sandbox 裡有窄放行，
 * 其餘一律拒絕並列入儲存空間統計。真正的登入是否可用需實測，本階段不宣稱已解決。
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
  } else {
    // 官方 adapter 固定講 ACP v1，避免 v2 協商；USER 是無敏感內容的標準身份變數。
    env.CLAUDE_AGENT_ACP_PROTOCOL = "v1";
    env.USER = process.env.USER ?? "cardiary";
    env.CLAUDE_CODE_EXECUTABLE = input.claudeCliPath ?? resolveClaudeCliPath() ?? "claude";
    if (input.credential) env.CLAUDE_CODE_OAUTH_TOKEN = input.credential;
  }
  return env;
}

// ---- ACP（OpenCode 與 Claude Code 共用） --------------------------------

/** ACP 的 JSON-RPC 請求 id；橋接層自己配對，兩種代理都走這層。 */
export const ACP_IDS = {
  initialize: 1,
  sessionNew: 2,
  setModel: 3,
  setMode: 4,
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

export function encodeAcpSessionNew(cwd: string, options?: { claudeCode?: boolean }): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: ACP_IDS.sessionNew,
    method: "session/new",
    params: {
      cwd,
      mcpServers: [],
      ...(options?.claudeCode
        ? {
            _meta: {
              claudeCode: {
                options: { allowDangerouslySkipPermissions: false },
              },
            },
          }
        : {}),
    },
  })}\n`;
}

export function encodeAcpSetModel(model: string, acpSessionId: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: ACP_IDS.setModel,
    method: "session/set_config_option",
    params: { sessionId: acpSessionId, configId: "model", value: model },
  })}\n`;
}

export function encodeAcpSetMode(acpSessionId: string, mode: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: ACP_IDS.setMode,
    method: "session/set_config_option",
    params: { sessionId: acpSessionId, configId: "mode", value: mode },
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

/**
 * ACP 對 `session/request_permission` 的回覆。
 *
 * `optionId` 必須是伺服器在 options[] 裡實際給的值（OpenCode 2.2.7 是
 * `once`/`always`/`reject`；官方 Claude adapter 也有自己的 optionId），不能用
 * `kind`（`allow_once` 等）代替，否則會被當成拒絕，整回合以 stopReason=cancelled 結束。
 */
export function encodeAcpPermissionReply(requestId: number | string, optionId: string): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    result: { outcome: { outcome: "selected", optionId } },
  })}\n`;
}
