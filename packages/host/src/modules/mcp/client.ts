/**
 * MCP 的 JSON-RPC 2.0 用戶端。
 *
 * stdio 伺服器只透過共用 `SpawnRegistry` 啟動，外面再包一層 Seatbelt；
 * HTTP 伺服器由主機自己連線，只允許 `allowedHosts` 內的主機，重新導向
 * 每一跳都重新比對。兩條路徑都在任何限制無法生效時拒絕啟動。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { McpServerRecord } from "@cardiary/domain";
import { isAllowedHost } from "@cardiary/domain";

import type { SpawnRegistry } from "../../spawn/wrapper.js";
import { createMcpStdioSandbox } from "./sandbox.js";

/** MCP 工具的描述；只保留 Cardiary 會用到的欄位。 */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  /** tools/list 回傳的原始 _meta；用來找出綁定的 ui:// 介面資源。 */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** 一次工具呼叫的結果。 */
export interface McpCallResult {
  readonly content: readonly unknown[];
  readonly isError: boolean;
  readonly text: string;
}

/** 用戶端介面；測試可以注入假的實作，不必真的開子行程。 */
export interface McpClient {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpCallResult>;
  /** 讀取 MCP 資源（例如 ui:// 介面），回傳 resources/read 的原始結果。 */
  readResource(uri: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpClientContext {
  readonly folderRoot: string;
  readonly spawn: SpawnRegistry;
  readonly logger: { debug(message: string): void; warn(message: string): void };
  readonly homeDir?: string;
  /** HTTP 請求的逾期毫秒數；測試可縮短，正式執行沿用 30 秒。 */
  readonly requestTimeoutMs?: number;
  /**
   * 這次啟動是否經核准取得該伺服器自己的持久資料目錄
   * （`modules/mcp/<serverId>/`）的寫入授權；只有 stdio 沙盒用得到。
   */
  readonly persistentData?: boolean;
}

export type McpClientFactory = (server: McpServerRecord, context: McpClientContext) => McpClient;

/** 連線或協定失敗。 */
export class McpClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpClientError";
    this.code = code;
  }
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_TOOL_PAGES = 20;

/** 依設定建立用戶端；不認識的傳輸方式直接拒絕。 */
export function createMcpClient(server: McpServerRecord, context: McpClientContext): McpClient {
  if (server.transport === "stdio") {
    return new StdioMcpClient(server, context);
  }
  return new HttpMcpClient(server, context.requestTimeoutMs);
}

// ── stdio ──────────────────────────────────────────────────────────────────

class StdioMcpClient implements McpClient {
  readonly #server: McpServerRecord;
  readonly #context: McpClientContext;
  #rpc: StdioRpc | null = null;
  /** 初始化 promise：所有並行呼叫都等它，失敗才清空以便重試。 */
  #connecting: Promise<void> | null = null;
  /** 關閉 promise：所有並行 close 共用，等到子行程真正結束才 resolve。 */
  #closing: Promise<void> | null = null;
  #closed = false;

  constructor(server: McpServerRecord, context: McpClientContext) {
    this.#server = server;
    this.#context = context;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    await this.#connect();
    return this.#listTools();
  }

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpCallResult> {
    await this.#connect();
    const result = await this.#rpc!.request("tools/call", { name, arguments: args });
    return normalizeCallResult(result);
  }

  async readResource(uri: string): Promise<unknown> {
    await this.#connect();
    return this.#rpc!.request("resources/read", { uri });
  }

  close(): Promise<void> {
    if (this.#closing !== null) return this.#closing;
    this.#closed = true;
    const rpc = this.#rpc;
    // 馬上清掉對外可見的 rpc，但把真正的關行程交給共用 promise；第二個
    // close() 也等同一個 promise，不會在子行程還活著時提前回來。
    this.#rpc = null;
    this.#connecting = null;
    rpc?.dispose();
    this.#closing = rpc?.close() ?? Promise.resolve();
    return this.#closing;
  }

  async #connect(): Promise<void> {
    if (this.#closed) {
      throw new McpClientError("closed", "MCP 用戶端已關閉");
    }
    // 初始化還在進行時，即使 #rpc 已從 spawn 起就指派，仍要等同一個
    // #connecting，否則第二個並行呼叫會在 initialize 回應前就送 tools/*。
    if (this.#connecting !== null) {
      return this.#connecting;
    }
    if (this.#rpc !== null) {
      return;
    }
    this.#connecting = this.#start().catch((error: unknown) => {
      this.#connecting = null;
      throw error;
    });
    return this.#connecting;
  }

  async #start(): Promise<void> {
    const command = this.#server.command;
    if (command === undefined || command.length === 0) {
      throw new McpClientError("invalid_config", "stdio 伺服器缺少 command");
    }
    const sandbox = createMcpStdioSandbox({
      folderRoot: this.#context.folderRoot,
      serverId: this.#server.serverId,
      ...(this.#context.homeDir === undefined ? {} : { homeDir: this.#context.homeDir }),
      ...(this.#context.persistentData === true ? { persistentData: true } : {}),
    });
    if (sandbox === null) {
      // 沒有沙盒就不啟動：不能假裝網路限制有效。
      throw new McpClientError(
        "sandbox_unavailable",
        "無法套用 stdio 沙盒（需要 macOS 的 sandbox-exec），伺服器不啟動",
      );
    }
    const workingDir = path.join(this.#context.folderRoot, "tmp", "mcp", this.#server.serverId);
    const home = path.join(workingDir, "home");
    mkdirSync(home, { recursive: true });
    const child = this.#context.spawn.spawn({
      command: sandbox.executable,
      args: ["-p", sandbox.profile, command, ...(this.#server.args ?? [])],
      cwd: workingDir,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: home,
        TMPDIR: workingDir,
        MCP_TRANSPORT: "stdio",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.#context.logger.debug(`MCP ${this.#server.serverId} stderr: ${chunk.toString("utf8")}`);
    });
    const rpc = new StdioRpc(child, this.#server.serverId);
    // 從 spawn 起就持有 rpc：spawn 與這個指派之間沒有 await，close() 不會在
    // 初始化途中交錯進來而看不到 child。初始化失敗時 catch 會清掉這個指派。
    this.#rpc = rpc;
    try {
      await rpc.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Cardiary", version: "0.1.0" },
      });
      if (this.#closed) {
        throw new McpClientError("closed", "MCP 用戶端已關閉");
      }
      rpc.notify("notifications/initialized", {});
    } catch (error) {
      if (this.#rpc === rpc) this.#rpc = null;
      rpc.dispose();
      await rpc.close();
      throw error instanceof McpClientError
        ? error
        : new McpClientError("initialize_failed", `MCP 初始化失敗：${errorMessage(error)}`);
    }
  }

  async #listTools(): Promise<McpToolDescriptor[]> {
    const rpc = this.#rpc;
    if (rpc === null) {
      throw new McpClientError("not_connected", "MCP 尚未連線");
    }
    const seen = new Set<string>();
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await rpc.request("tools/list", cursor === undefined ? {} : { cursor });
      const parsed = parseToolsList(result);
      for (const tool of parsed.tools) {
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          tools.push(tool);
        }
      }
      if (parsed.nextCursor === undefined) {
        return tools;
      }
      cursor = parsed.nextCursor;
    }
    throw new McpClientError("too_many_pages", "MCP 工具清單超過分頁上限");
  }
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

class StdioRpc {
  readonly #child: ReturnType<SpawnRegistry["spawn"]>;
  readonly #serverId: string;
  readonly #pending = new Map<number, PendingRequest>();
  #buffer = "";
  #nextId = 1;
  #closed = false;
  #closing: Promise<void> | null = null;

  constructor(child: ReturnType<SpawnRegistry["spawn"]>, serverId: string) {
    this.#child = child;
    this.#serverId = serverId;
    child.stdout?.on("data", (chunk: Buffer) => {
      this.#ingest(chunk.toString("utf8"));
    });
    void child.exited.then(() => {
      this.#closed = true;
      this.#rejectAll(new McpClientError("process_exited", "MCP 子行程已結束"));
    });
  }

  request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new McpClientError("process_exited", "MCP 子行程已結束"));
    }
    const id = this.#nextId;
    this.#nextId += 1;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new McpClientError("timeout", `MCP 伺服器 ${this.#serverId} 沒有回應 ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#write(payload);
    });
  }

  notify(method: string, params: Readonly<Record<string, unknown>>): void {
    this.#write({ jsonrpc: "2.0", method, params });
  }

  dispose(): void {
    this.#closed = true;
    this.#rejectAll(new McpClientError("closed", "MCP 用戶端已關閉"));
  }

  async close(): Promise<void> {
    // 初始化失敗的 catch 與外層 close() 可能同時關同一個 rpc；重複呼叫要
    // 共用同一次關行程，且等到 child 真正結束才回，避免留下孤兒。
    if (this.#closing !== null) return this.#closing;
    this.#closing = this.#doClose();
    return this.#closing;
  }

  async #doClose(): Promise<void> {
    this.#child.closeInput();
    this.#child.signal("SIGTERM");
    const exited = await Promise.race([this.#child.exited, delay(1_000).then(() => null)]);
    if (exited === null) {
      this.#child.signal("SIGKILL");
      await this.#child.exited;
    }
  }

  #write(payload: unknown): void {
    if (this.#closed) {
      return;
    }
    this.#child.write(`${JSON.stringify(payload)}\n`);
  }

  #ingest(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.length > 0) {
        this.#handleLine(line);
      }
      newline = this.#buffer.indexOf("\n");
    }
  }

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (Array.isArray(message)) {
      for (const entry of message) {
        this.#handleMessage(entry);
      }
      return;
    }
    this.#handleMessage(message);
  }

  #handleMessage(message: unknown): void {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const record = message as Record<string, unknown>;
    const id = record.id;
    if (typeof id === "number" && this.#pending.has(id)) {
      const pending = this.#pending.get(id)!;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      if (record.error !== undefined) {
        pending.reject(new McpClientError("rpc_error", formatRpcError(record.error)));
      } else {
        pending.resolve(record.result);
      }
      return;
    }
    if (typeof record.method === "string" && (typeof id === "number" || typeof id === "string")) {
      // 伺服器主動發請求；Cardiary 沒有提供 sampling 或 roots，直接回方法不存在。
      this.#write({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Cardiary 不支援由伺服器發起的請求" },
      });
    }
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

// ── HTTP ───────────────────────────────────────────────────────────────────

class HttpMcpClient implements McpClient {
  readonly #server: McpServerRecord;
  readonly #timeoutMs: number;
  /** 進行中請求的控制器；`close()` 用它中止所有還沒回來的 fetch。 */
  readonly #controllers = new Set<AbortController>();
  #sessionId: string | null = null;
  #nextId = 1;
  #initialized = false;
  #connecting: Promise<void> | null = null;
  #closed = false;

  constructor(server: McpServerRecord, timeoutMs: number = REQUEST_TIMEOUT_MS) {
    this.#server = server;
    this.#timeoutMs = timeoutMs;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    await this.#connect();
    const seen = new Set<string>();
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await this.#request("tools/list", cursor === undefined ? {} : { cursor });
      const parsed = parseToolsList(result);
      for (const tool of parsed.tools) {
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          tools.push(tool);
        }
      }
      if (parsed.nextCursor === undefined) {
        return tools;
      }
      cursor = parsed.nextCursor;
    }
    throw new McpClientError("too_many_pages", "MCP 工具清單超過分頁上限");
  }

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpCallResult> {
    await this.#connect();
    return normalizeCallResult(await this.#request("tools/call", { name, arguments: args }));
  }

  async readResource(uri: string): Promise<unknown> {
    await this.#connect();
    return this.#request("resources/read", { uri });
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#sessionId = null;
    this.#initialized = false;
    this.#connecting = null;
    // 中止所有還沒回來的請求。fetch 的訊號同時切掉等 headers 與讀 body，
    // 卡住的 `#send()` 會立刻以 AbortError 結束，`launch.task` 才能收斂。
    for (const controller of this.#controllers) {
      controller.abort();
    }
    this.#controllers.clear();
  }

  async #connect(): Promise<void> {
    if (this.#closed) {
      throw new McpClientError("closed", "MCP 用戶端已關閉");
    }
    if (this.#initialized) {
      return;
    }
    if (this.#connecting !== null) {
      return this.#connecting;
    }
    this.#connecting = this.#initialize().catch((error: unknown) => {
      this.#connecting = null;
      throw error;
    });
    return this.#connecting;
  }

  async #initialize(): Promise<void> {
    if (this.#server.url === undefined) {
      throw new McpClientError("invalid_config", "http 伺服器缺少 url");
    }
    const id = this.#nextId++;
    const result = await this.#send(
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "Cardiary", version: "0.1.0" },
        },
      },
      id,
    );
    if (typeof result !== "object" || result === null) {
      throw new McpClientError("initialize_failed", "MCP 初始化回應不是物件");
    }
    await this.#notify("notifications/initialized", {});
    this.#initialized = true;
  }

  async #request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const id = this.#nextId++;
    return this.#send({ jsonrpc: "2.0", id, method, params }, id);
  }

  async #notify(method: string, params: Readonly<Record<string, unknown>>): Promise<void> {
    await this.#send({ jsonrpc: "2.0", method, params });
  }

  /**
   * 送一個請求並讀完回應；fetch 與讀取 body 都在同一個有界訊號下。
   * 每個請求各自一個控制器：`close()` 可以一次中止所有還沒回來的請求，
   * 不論卡在等 headers 還是等 body。
   */
  async #send(message: Record<string, unknown>, expectedId?: number): Promise<unknown> {
    if (this.#server.url === undefined) {
      throw new McpClientError("invalid_config", "http 伺服器缺少 url");
    }
    if (this.#closed) {
      throw new McpClientError("closed", "MCP 用戶端已關閉");
    }
    const controller = new AbortController();
    this.#controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetchFollowingAllowedHosts(
        this.#server.url,
        message,
        controller.signal,
      );
      return await responseResult(response, expectedId);
    } catch (error) {
      if (error instanceof McpClientError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        // close() 刻意中止與逾時中止都要當成失敗，不能當成成功回應。
        throw this.#closed
          ? new McpClientError("closed", "MCP 用戶端已關閉")
          : new McpClientError("timeout", `MCP 伺服器 ${this.#server.serverId} 沒有在期限內回應`);
      }
      throw new McpClientError("request_failed", `MCP 請求失敗：${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
      this.#controllers.delete(controller);
    }
  }

  async #fetchFollowingAllowedHosts(
    start: string,
    message: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    let target = new URL(start);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedHost(target.hostname, this.#server.allowedHosts)) {
        throw new McpClientError(
          "host_not_allowed",
          `MCP 連線目的主機不在允許清單內：${target.hostname}`,
        );
      }
      const response = await fetch(target, {
        method: "POST",
        redirect: "manual",
        signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(this.#sessionId === null ? {} : { "mcp-session-id": this.#sessionId }),
        },
        body: JSON.stringify(message),
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (location === null) {
          throw new McpClientError("redirect_without_location", "MCP 伺服器重新導向但沒有位址");
        }
        target = new URL(location, target);
        // 每一跳都重新比對；協定可以從 https 降到 http，但主機必須在清單內。
        continue;
      }
      this.#readSessionId(response);
      return response;
    }
    throw new McpClientError("too_many_redirects", "MCP 伺服器重新導向次數過多");
  }

  #readSessionId(response: Response): void {
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId !== null && sessionId.length > 0) {
      this.#sessionId = sessionId;
    }
  }
}

// ── 共用 ───────────────────────────────────────────────────────────────────

function parseToolsList(result: unknown): {
  readonly tools: readonly McpToolDescriptor[];
  readonly nextCursor?: string;
} {
  if (typeof result !== "object" || result === null) {
    throw new McpClientError("invalid_response", "tools/list 回應不是物件");
  }
  const record = result as Record<string, unknown>;
  const rawTools = record.tools;
  if (!Array.isArray(rawTools)) {
    throw new McpClientError("invalid_response", "tools/list 沒有 tools 陣列");
  }
  const tools: McpToolDescriptor[] = [];
  for (const entry of rawTools) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const tool = entry as Record<string, unknown>;
    if (typeof tool.name !== "string" || tool.name.length === 0) {
      continue;
    }
    tools.push({
      name: tool.name,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      ...(typeof tool.inputSchema === "object" && tool.inputSchema !== null
        ? { inputSchema: tool.inputSchema as Record<string, unknown> }
        : {}),
      ...(isRecord(tool._meta) ? { meta: tool._meta } : {}),
    });
  }
  return {
    tools,
    ...(typeof record.nextCursor === "string" && record.nextCursor.length > 0
      ? { nextCursor: record.nextCursor }
      : {}),
  };
}

function normalizeCallResult(result: unknown): McpCallResult {
  if (typeof result !== "object" || result === null) {
    throw new McpClientError("invalid_response", "tools/call 回應不是物件");
  }
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .map((entry) => {
      if (typeof entry === "object" && entry !== null) {
        const item = entry as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
      }
      return JSON.stringify(entry);
    })
    .join("\n");
  return {
    content,
    isError: record.isError === true,
    text,
  };
}

async function responseResult(response: Response, expectedId?: number): Promise<unknown> {
  if (!response.ok) {
    throw new McpClientError("http_error", `MCP 伺服器回應 HTTP ${String(response.status)}`);
  }
  // 通知（沒有 expectedId）不需要回應內容：JSON-RPC notification 依法沒有 id，
  // 伺服器常回 202/204 且 body 是空的。只要是 2xx 就當成功，不解析 JSON；
  // body 仍要取消，避免 200 帶 body 或 text/event-stream 的長連線留到逾時。
  if (expectedId === undefined) {
    // 通知的 2xx 回應可能帶 body 或串流；不解析內容，但要取消，
    // 避免 200 帶 body 或 text/event-stream 的連線留到逾時才釋放。
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (contentType.includes("text/event-stream")) {
    const messages = body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return undefined;
        }
      })
      .filter((value): value is unknown => value !== undefined);
    for (const message of messages) {
      const matched = matchResponse(message, expectedId);
      if (matched !== undefined) {
        return matched;
      }
    }
    throw new McpClientError("invalid_response", "MCP 事件串流沒有對應的回應");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new McpClientError("invalid_response", "MCP 回應不是合法 JSON");
  }
  const matched = matchResponse(parsed, expectedId);
  if (matched === undefined) {
    throw new McpClientError("invalid_response", "MCP 回應 id 不符");
  }
  return matched;
}

/** 回傳 `result`；錯誤或找不到時丟 `McpClientError`。 */
function matchResponse(message: unknown, expectedId?: number): unknown {
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const record = message as Record<string, unknown>;
  if (expectedId !== undefined && record.id !== expectedId) {
    return undefined;
  }
  if (record.error !== undefined) {
    throw new McpClientError("rpc_error", formatRpcError(record.error));
  }
  return record.result;
}

function formatRpcError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "未知錯誤";
    const code = typeof record.code === "number" ? record.code : "?";
    return `MCP 錯誤 ${String(code)}：${message}`;
  }
  return `MCP 錯誤：${String(error)}`;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
