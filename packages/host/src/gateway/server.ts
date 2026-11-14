import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type {
  ApprovalRequest as EngineApprovalRequest,
  Clock,
  EngineErrorCode,
  JsonValue as EngineJsonValue,
  ConversationSummary,
  EngineEvent,
  EngineLogger,
} from "@cardiary/engine-adapter";
import type {
  ApprovalRequestedEvent,
  ApprovalRequest as ProtocolApprovalRequest,
  AssistantTranscriptEntry,
  JSONObject,
  JSONValue,
  ModuleEvent,
  ServerFrame,
  SessionSnapshot,
  SessionSummary,
  StreamingMessage,
  ToolDiagnostic,
  ToolOutput,
  ToolTranscriptEntry,
  TranscriptEntry,
  TurnPhase,
  TurnState,
  UserTranscriptEntry,
} from "@cardiary/protocol";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import type { HostEngine } from "../engine/types.js";
import {
  isStorageFailure,
  protocolDiagnostic,
  protocolError,
  protocolErrorFromEngine,
  type ProtocolErrorInfo,
} from "../errors.js";
import type { DedupeRecord, StorageBundle } from "../storage/interfaces.js";
import { constantTimeEqual, isValidToken } from "../tokens.js";
import {
  PROTOCOL_MAX,
  PROTOCOL_MIN,
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
} from "../version.js";
import { ClientConnection } from "./connection.js";
import { DEFAULT_LIMITS, type GatewayLimits } from "./limits.js";
import { systemStatus, type HostStatusInput } from "./status.js";
import { StreamLog, type StoredEvent } from "./streams.js";
import { StreamingBuffer } from "./textBuffer.js";

export type ModuleHandler = (payload: JSONObject) => Promise<JSONObject>;

export interface GatewayOptions {
  readonly engine: HostEngine;
  readonly storage: StorageBundle;
  readonly epoch: string;
  readonly clientToken: string;
  readonly logger: EngineLogger;
  readonly status: () => HostStatusInput;
  readonly clock?: Clock;
  readonly limits?: Partial<GatewayLimits>;
  /** 新對話釘選的工具組版本。 */
  readonly toolBundles?: () => readonly {
    readonly bundleId: string;
    readonly generation: number;
  }[];
  /** 固定前綴；由主機組好，轉接層不拆解。 */
  readonly systemContext?: () => string;
  readonly moduleHandlers?: ReadonlyMap<string, ModuleHandler>;
  /** 緊急全部暫停時取消工具子行程；由服務接上共用 spawn wrapper。 */
  readonly cancelToolProcesses?: (deadlineMs: number) => Promise<number>;
  /** 測試用故障注入：讓第一個 request_dedupe complete 不寫入，模擬中斷窗口。 */
  readonly faultSkipDedupeComplete?: boolean;
}

export class RequestFailure extends Error {
  readonly info: ProtocolErrorInfo;

  constructor(info: ProtocolErrorInfo) {
    super(info.message);
    this.name = "RequestFailure";
    this.info = info;
  }
}

interface TurnView {
  readonly turnId: string;
  phase: TurnPhase;
  readonly startedAt: string;
  endedAt?: string;
  error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

interface ToolCallView {
  readonly toolCallId: string;
  readonly name: string;
  readonly input: JSONObject;
  readonly turnId: string;
  readonly createdAt: string;
  outcome: {
    readonly status: "ok" | "error";
    readonly output: ToolOutput;
    readonly diagnostics: readonly { readonly code: string; readonly message?: string }[];
  } | null;
}

interface PendingAssistant {
  readonly messageId: string;
  readonly turnId: string;
  readonly text: string;
  readonly createdAt: string;
}

interface SessionState {
  readonly sessionId: string;
  readonly subscription: { close(): void };
  readonly turns: Map<string, TurnView>;
  readonly toolCalls: Map<string, ToolCallView>;
  readonly messageTurns: Map<string, string>;
  readonly messageStatus: Map<string, "complete" | "interrupted" | "failed">;
  readonly turnTrigger: Map<string, string>;
  activeTurnId: string | null;
  pendingApprovalId: string | null;
  pendingAssistant: PendingAssistant | null;
  messageCount: number;
  closed: boolean;
}

interface ParsedRequest {
  readonly id: string;
  readonly type: string;
  readonly payload: JSONObject;
}

type Unknown = Record<string, unknown>;

/**
 * 客戶端協定閘道：WebSocket 訊息、版本協商、客戶端 Token、串流序號、
 * 快照與補送、審批、緊急暫停與模組事件外殼。
 *
 * 只綁 `127.0.0.1`；控制面不在這裡。
 */
export class Gateway {
  readonly #options: GatewayOptions;
  readonly limits: GatewayLimits;
  readonly streamLog: StreamLog;
  readonly #buffer: StreamingBuffer;
  readonly #logger: EngineLogger;
  readonly #clock: Clock;
  readonly #connections = new Map<string, ClientConnection>();
  readonly #sessions = new Map<string, SessionState>();
  readonly #sessionPending = new Map<string, Promise<SessionState>>();
  readonly #moduleHandlers = new Map<string, ModuleHandler>();
  readonly #requestCache = new Map<string, Map<string, ServerFrame | Unknown>>();
  readonly #messageCounts = new Map<string, number>();
  readonly #pendingDecided = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  #storageFailureHandler: ((detail: string) => void) | null = null;
  #storageFailed = false;
  #faultSkipComplete: boolean;
  #http: Server | null = null;
  #wss: WebSocketServer | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #accepting = true;
  #inFlight = 0;
  #closed = false;
  #port = 0;
  #stopped = false;

  constructor(options: GatewayOptions) {
    this.#options = options;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.streamLog = new StreamLog(options.storage.events, options.epoch);
    this.#buffer = new StreamingBuffer(this.limits.streamingBufferBytes);
    this.#logger = options.logger;
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#faultSkipComplete = options.faultSkipDedupeComplete === true;
    for (const [namespace, handler] of options.moduleHandlers ?? []) {
      this.#moduleHandlers.set(namespace, handler);
    }
  }

  get port(): number {
    return this.#port;
  }

  get epoch(): string {
    return this.#options.epoch;
  }

  registerModuleNamespace(namespace: string, handler: ModuleHandler): void {
    this.#moduleHandlers.set(namespace, handler);
  }

  /** 由服務接上：儲存失效時停止寫入、送 notify.fatal、關閉客戶端。 */
  setStorageFailureHandler(handler: (detail: string) => void): void {
    this.#storageFailureHandler = handler;
  }

  #reportStorageFailure(error: unknown): void {
    if (this.#storageFailed) return;
    this.#storageFailed = true;
    const detail = errorMessage(error);
    this.#logger.error("儲存失效，停止寫入", { detail });
    this.#storageFailureHandler?.(detail);
  }

  async listen(port = 0): Promise<number> {
    if (this.#http) return this.#port;
    const http = createServer((request, response) => {
      this.#handleHttp(request, response);
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: this.limits.maxFrameBytes });
    http.on("upgrade", (request, socket, head) => {
      if (!this.#accepting) {
        socket.destroy();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/v1/ws") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        this.#onConnection(request, ws);
      });
    });
    this.#http = http;
    this.#wss = wss;
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, "127.0.0.1", () => {
        http.removeListener("error", reject);
        resolve();
      });
    });
    const address = http.address();
    this.#port = typeof address === "object" && address !== null ? address.port : 0;
    this.#heartbeat = setInterval(() => {
      this.heartbeatTick();
    }, this.limits.heartbeatSeconds * 1000);
    this.#heartbeat.unref?.();
    return this.#port;
  }

  /** pause／shutdown：停止受理新的客戶端請求，既有連線保留。 */
  stopAccepting(): void {
    this.#accepting = false;
  }

  allowAccepting(): void {
    if (this.#stopped) return;
    this.#accepting = true;
  }

  get accepting(): boolean {
    return this.#accepting;
  }

  /** 一輪心跳：沒有回 pong 的連線直接關閉，其餘送 ping。 */
  heartbeatTick(): void {
    for (const connection of this.#connections.values()) {
      if (connection.closed) continue;
      if (!connection.alive) {
        connection.close(1011, "heartbeat_timeout");
        continue;
      }
      connection.alive = false;
      try {
        connection.ws.ping();
      } catch {
        connection.close(1011, "heartbeat");
      }
    }
  }

  /** 儲存失效時關閉所有客戶端連線；close code 由呼叫端指定（1011）。 */
  closeClientConnections(code: number, reason: string): void {
    for (const connection of this.#connections.values()) {
      connection.close(code, reason);
    }
  }

  get activeSessions(): number {
    return this.#sessions.size;
  }

  /** 進行中的任務數：事件處理中或回合進行中。 */
  get activeTasks(): number {
    let running = 0;
    for (const session of this.#sessions.values()) {
      if (session.activeTurnId) running += 1;
    }
    return running + this.#inFlight;
  }

  /** 有進行中回合的會話；pause 與 pause_all 回報用。 */
  interruptedSessionIds(): string[] {
    const ids: string[] = [];
    for (const session of this.#sessions.values()) {
      if (session.activeTurnId) ids.push(session.sessionId);
    }
    return ids;
  }

  /** 等在途事件、事件寫入與連線輸出都排空；pause 與 shutdown 用。 */
  async drain(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.#inFlight === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await this.streamLog.runExclusive(async () => undefined);
    await Promise.all([...this.#connections.values()].map((connection) => connection.flush()));
  }

  /** 送出並落地一則 `system.status`；回傳序號。 */
  async emitSystemStatus(status?: ReturnType<typeof systemStatus>): Promise<number> {
    const payload = status ?? systemStatus(this.#options.status());
    const stored = await this.streamLog.append({
      stream: "system",
      kind: "system.status",
      payload: payload as unknown as JSONObject,
      at: this.#clock.now().toISOString(),
    });
    this.#broadcast(stored);
    return stored.seq;
  }

  /** 模組事件外殼：`module.<ns>.<name>` 一對一轉成 `ModuleEvent`。 */
  async emitModuleEvent(input: {
    readonly type: string;
    readonly stream: string;
    readonly data: JSONObject;
    readonly schemaVersion?: string;
  }): Promise<number> {
    if (!/^module\.[a-z0-9-]+\.[a-z0-9.-]+$/.test(input.type)) {
      throw new Error(`模組事件型別不合法：${input.type}`);
    }
    const payload: JSONObject = {
      data: input.data,
      ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }),
    };
    const stored = await this.streamLog.append({
      stream: input.stream,
      kind: input.type,
      payload,
      at: this.#clock.now().toISOString(),
    });
    this.#broadcast(stored);
    return stored.seq;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopped = true;
    this.#accepting = false;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    for (const session of this.#sessions.values()) {
      session.closed = true;
      session.subscription.close();
    }
    this.#sessions.clear();
    for (const connection of this.#connections.values()) {
      connection.close(1001, "server_closing");
    }
    this.#connections.clear();
    if (this.#wss) this.#wss.close();
    if (this.#http) {
      await new Promise<void>((resolve) => {
        this.#http?.close(() => {
          resolve();
        });
      });
    }
    await this.#options.storage.events.flush();
  }

  // ---- 連線與驗證 -------------------------------------------------------

  #onConnection(request: IncomingMessage, ws: WebSocket): void {
    const origin = request.headers.origin;
    const headerAuth = parseBearer(request.headers.authorization);
    const connection = new ClientConnection({
      id: `conn_${Math.random().toString(36).slice(2, 10)}`,
      ws,
      maxBufferedBytes: this.limits.maxBufferedBytes,
      sendTimeoutMs: this.limits.sendTimeoutMs,
      onClose: () => {
        this.#connections.delete(connection.id);
      },
    });
    connection.version = 0;
    this.#connections.set(connection.id, connection);
    this.#requestCache.set(connection.id, new Map());

    const reject = (code: "auth_invalid" | "not_authenticated", message: string): void => {
      void connection
        .send({ v: 1, kind: "error", code, message, retryable: false })
        .then(() => connection.close(1008, "auth"));
    };

    if (origin !== undefined && !isLoopbackOrigin(origin)) {
      reject("auth_invalid", "不接受的來源。");
      return;
    }
    if (headerAuth !== null && !isValidToken(headerAuth)) {
      reject("auth_invalid", "Token 格式不正確。");
      return;
    }
    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      void this.#onFrame(connection, text, headerAuth);
    });
    // 第一則訊息必須是 system.hello。
    setTimeout(() => {
      if (!connection.authenticated && !connection.closed) {
        reject("not_authenticated", "連線後必須先送出 system.hello。");
      }
    }, 10_000).unref?.();
  }

  async #onFrame(
    connection: ClientConnection,
    text: string,
    headerAuth: string | null,
  ): Promise<void> {
    if (this.#closed) return;
    if (Buffer.byteLength(text, "utf8") > this.limits.maxFrameBytes) {
      await this.#sendError(connection, protocolError("payload_too_large", "訊息超過大小上限。"));
      connection.close(1009, "payload_too_large");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      await this.#sendError(connection, protocolError("invalid_message", "訊息不是合法 JSON。"));
      connection.close(1008, "invalid_message");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      await this.#sendError(connection, protocolError("invalid_message", "訊息必須是 JSON 物件。"));
      connection.close(1008, "invalid_message");
      return;
    }
    const frame = parsed as Unknown;
    if (frame.kind !== "request") {
      await this.#sendError(connection, protocolError("invalid_message", "客戶端只能送出請求。"));
      connection.close(1008, "invalid_message");
      return;
    }
    if (frame.v !== PROTOCOL_VERSION) {
      await this.#sendError(
        connection,
        protocolError("incompatible_version", "訊息版本與協商結果不同。", {
          details: { serverMin: PROTOCOL_MIN, serverMax: PROTOCOL_MAX },
        }),
      );
      connection.close(1008, "incompatible_version");
      return;
    }
    const id = frame.id;
    const type = frame.type;
    const payload = frame.payload;
    if (typeof id !== "string" || typeof type !== "string") {
      await this.#sendError(connection, protocolError("invalid_message", "請求缺少 id 或 type。"));
      return;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      await this.#sendError(
        connection,
        protocolError("invalid_message", "請求的 payload 必須是物件。", {
          details: { field: "payload" },
        }),
        id,
      );
      return;
    }
    const cache = this.#requestCache.get(connection.id);
    const cached = cache?.get(id);
    if (cached) {
      await connection.send(cached);
      return;
    }
    const request: ParsedRequest = { id, type, payload: payload as JSONObject };

    if (type === "system.hello") {
      await this.#handleHello(connection, request, headerAuth);
      return;
    }
    if (!connection.authenticated) {
      await this.#sendError(
        connection,
        protocolError("not_authenticated", "尚未完成 system.hello。"),
        id,
      );
      return;
    }
    if (!this.#accepting) {
      await this.#sendError(
        connection,
        protocolError("unavailable", "主機暫停中，暫不接受請求。", {
          details: { reason: "paused" },
        }),
        id,
      );
      return;
    }

    let response: ServerFrame | Unknown;
    try {
      response = await this.#dispatch(connection, request);
    } catch (error) {
      if (error instanceof RequestFailure) {
        await this.#sendError(connection, error.info, id);
        return;
      }
      if (isStorageFailure(error)) {
        // 儲存失效要先於引擎錯誤碼處理：storage-unavailable 也在引擎碼表裡，
        // 但這條必須走致命路徑（notify.fatal、1011、exit 70），不能只回錯誤。
        this.#reportStorageFailure(error);
        await this.#sendError(
          connection,
          protocolError("unavailable", "儲存已停止寫入。", { details: { reason: "storage" } }),
          id,
        );
        return;
      }
      if (isEngineError(error)) {
        await this.#sendError(connection, protocolErrorFromEngine(error.code, error.message), id);
        return;
      }
      this.#logger.error("請求處理失敗", { type, message: errorMessage(error) });
      await this.#sendError(connection, protocolError("internal", "主機發生未預期的錯誤。"), id);
      return;
    }
    if (isHandled(response)) return;
    cache?.set(id, response);
    if (cache && cache.size > 128) {
      const first = cache.keys().next();
      if (!first.done) cache.delete(first.value);
    }
    await connection.send(response);
  }

  async #handleHello(
    connection: ClientConnection,
    request: ParsedRequest,
    headerAuth: string | null,
  ): Promise<void> {
    if (connection.authenticated || connection.version !== 0) {
      await this.#sendError(
        connection,
        protocolError("invalid_message", "重複的 system.hello。"),
        request.id,
      );
      return;
    }
    const payload = request.payload as Unknown;
    const protocol = payload.protocol as Unknown | undefined;
    const client = payload.client as Unknown | undefined;
    const auth = payload.auth as Unknown | undefined;
    if (
      typeof protocol !== "object" ||
      protocol === null ||
      typeof protocol.min !== "number" ||
      typeof protocol.max !== "number" ||
      typeof client !== "object" ||
      client === null ||
      typeof client.name !== "string" ||
      typeof client.version !== "string" ||
      typeof client.platform !== "string" ||
      typeof client.instanceId !== "string"
    ) {
      await this.#sendError(
        connection,
        protocolError("invalid_message", "system.hello 缺少必填欄位。"),
        request.id,
      );
      return;
    }
    const messageToken =
      typeof auth === "object" && auth !== null && typeof auth.token === "string"
        ? auth.token
        : null;
    if (
      headerAuth !== null &&
      messageToken !== null &&
      !constantTimeEqual(headerAuth, messageToken)
    ) {
      await this.#sendError(
        connection,
        protocolError("auth_invalid", "標頭與訊息帶了不同的 Token。"),
      );
      connection.close(1008, "auth_invalid");
      return;
    }
    const token = headerAuth ?? messageToken;
    if (token === null || !constantTimeEqual(token, this.#options.clientToken)) {
      connection.authFailures += 1;
      await this.#sendError(connection, protocolError("auth_invalid", "Token 不正確。"));
      if (connection.authFailures >= 3) connection.close(1008, "auth_invalid");
      return;
    }
    const overlapLow = Math.max(protocol.min, PROTOCOL_MIN);
    const overlapHigh = Math.min(protocol.max, PROTOCOL_MAX);
    if (overlapLow > overlapHigh) {
      await this.#sendError(
        connection,
        protocolError("incompatible_version", "沒有共同的協定版本。", {
          details: { serverMin: PROTOCOL_MIN, serverMax: PROTOCOL_MAX },
        }),
        request.id,
      );
      connection.close(1008, "incompatible_version");
      return;
    }
    connection.authenticated = true;
    connection.version = overlapHigh;
    connection.clientInstanceId = client.instanceId;
    const resume = payload.resume as Unknown | undefined;
    if (typeof resume === "object" && resume !== null && typeof resume.systemSeq === "number") {
      connection.resumeSystemSeq = resume.systemSeq;
    }
    const response = {
      v: PROTOCOL_VERSION,
      kind: "response",
      replyTo: request.id,
      type: "system.hello",
      payload: {
        protocol: { version: overlapHigh, min: PROTOCOL_MIN, max: PROTOCOL_MAX },
        server: { name: SERVER_NAME, version: SERVER_VERSION },
        connectionId: connection.id,
        limits: {
          maxFrameBytes: this.limits.maxFrameBytes,
          replayWindow: this.limits.replayWindow,
          heartbeatSeconds: this.limits.heartbeatSeconds,
        },
        capabilities: { modules: true, files: false },
        epoch: this.epoch,
      },
    };
    await connection.send(response);
  }

  async #dispatch(
    connection: ClientConnection,
    request: ParsedRequest,
  ): Promise<ServerFrame | Unknown> {
    switch (request.type) {
      case "system.subscribe":
        return this.#subscribeSystem(connection, request);
      case "system.unsubscribe":
        connection.subscriptions.delete("system");
        return response(request.id, "system.unsubscribe", { stream: "system" });
      case "session.create":
        return this.#createSession(request);
      case "session.list":
        return this.#listSessions(request);
      case "session.send_message":
        return this.#sendMessage(connection, request);
      case "session.interrupt":
        return this.#interrupt(request);
      case "session.subscribe":
        return this.#subscribeSession(connection, request);
      case "session.unsubscribe": {
        const sessionId = requiredString(request.payload, "sessionId");
        connection.subscriptions.delete(`session:${sessionId}`);
        return response(request.id, "session.unsubscribe", {
          sessionId,
          unsubscribed: true,
        });
      }
      case "session.get_history":
        return this.#getHistory(request);
      case "approval.decide":
        return this.#decideApproval(connection, request);
      case "approval.pause_all":
        return this.#pauseAll(request);
      default:
        if (request.type.startsWith("module.")) {
          return this.#moduleRequest(connection, request);
        }
        throw new RequestFailure(
          protocolError("unsupported", `主機不支援 ${request.type}。`, {
            details: { field: "type" },
          }),
        );
    }
  }

  // ---- 訂閱 -------------------------------------------------------------

  async #subscribeSystem(connection: ClientConnection, request: ParsedRequest): Promise<Unknown> {
    const lastSeq = optionalNumber(request.payload, "lastSeq");
    const epoch = optionalString(request.payload, "epoch");
    const snapshot = systemStatus(this.#options.status());
    const stream = "system";
    let resyncRequired = false;
    let boundary = 0;
    const replay: StoredEvent[] = [];
    await this.streamLog.runExclusive(async () => {
      boundary = await this.streamLog.boundaryAsync(stream);
      resyncRequired = await this.#needsResync(stream, lastSeq, epoch, boundary);
      if (!resyncRequired && lastSeq !== undefined) {
        const events = await this.streamLog.readReplay(stream, lastSeq + 1, boundary);
        if (events === null) {
          resyncRequired = true;
        } else {
          replay.push(...events);
        }
      }
      const frame = {
        v: PROTOCOL_VERSION,
        kind: "response",
        replyTo: request.id,
        type: "system.subscribe",
        payload: {
          stream,
          seq: boundary,
          epoch: this.epoch,
          resyncRequired,
          ...(resyncRequired ? { snapshot } : {}),
        },
      };
      await connection.send(frame);
      for (const event of replay) await connection.send(eventFrame(event));
      connection.subscriptions.add(stream);
    });
    return { __handled: true };
  }

  async #subscribeSession(connection: ClientConnection, request: ParsedRequest): Promise<Unknown> {
    const sessionId = requiredString(request.payload, "sessionId");
    const lastSeq = optionalNumber(request.payload, "lastSeq");
    const epoch = optionalString(request.payload, "epoch");
    const historyLimit = Math.min(
      optionalNumber(request.payload, "historyLimit") ?? this.limits.snapshotHistoryLimit,
      this.limits.snapshotHistoryLimit,
    );
    const state = await this.#ensureSession(sessionId);
    const stream = `session:${sessionId}`;
    let resyncRequired = false;
    const replay: StoredEvent[] = [];
    await this.streamLog.runExclusive(async () => {
      const boundary = await this.streamLog.boundaryAsync(stream);
      resyncRequired = await this.#needsResync(stream, lastSeq, epoch, boundary);
      if (!resyncRequired && lastSeq !== undefined) {
        const events = await this.streamLog.readReplay(stream, lastSeq + 1, boundary);
        if (events === null) {
          resyncRequired = true;
        } else {
          replay.push(...events);
        }
      }
      const snapshot = resyncRequired ? await this.#sessionSnapshot(state, historyLimit) : null;
      const frame = {
        v: PROTOCOL_VERSION,
        kind: "response",
        replyTo: request.id,
        type: "session.subscribe",
        payload: {
          sessionId,
          stream,
          seq: boundary,
          epoch: this.epoch,
          resyncRequired,
          ...(snapshot ? { snapshot } : {}),
        },
      };
      await connection.send(frame);
      for (const event of replay) await connection.send(eventFrame(event));
      connection.subscriptions.add(stream);
    });
    return { __handled: true };
  }

  async #needsResync(
    stream: string,
    lastSeq: number | undefined,
    epoch: string | undefined,
    boundary: number,
  ): Promise<boolean> {
    if (lastSeq === undefined) return true;
    if (epoch === undefined || epoch !== this.epoch) return true;
    if (lastSeq > boundary) return true;
    if (lastSeq === boundary) return false;
    if (boundary - lastSeq > this.limits.replayWindow) return true;
    const oldest = await this.#options.storage.events.oldestSeq(stream, this.epoch);
    if (oldest === null) return true;
    return lastSeq + 1 < oldest;
  }

  // ---- 會話 -------------------------------------------------------------

  async #ensureSession(sessionId: string): Promise<SessionState> {
    const existing = this.#sessions.get(sessionId);
    if (existing && !existing.closed) return existing;
    const pending = this.#sessionPending.get(sessionId);
    if (pending) return pending;
    const load = (async (): Promise<SessionState> => {
      const summary = await this.#options.engine.getConversation(sessionId);
      if (!summary) {
        throw new RequestFailure(protocolError("not_found", "找不到這場會話。"));
      }
      const subscription = this.#options.engine.subscribe({ conversationId: sessionId });
      const state: SessionState = {
        sessionId,
        subscription: { close: () => subscription.close() },
        turns: new Map(),
        toolCalls: new Map(),
        messageTurns: new Map(),
        messageStatus: new Map(),
        turnTrigger: new Map(),
        activeTurnId: null,
        pendingApprovalId: null,
        pendingAssistant: null,
        messageCount: 0,
        closed: false,
      };
      this.#sessions.set(sessionId, state);
      void this.#consumeEngineEvents(state, subscription.events);
      return state;
    })();
    this.#sessionPending.set(sessionId, load);
    try {
      return await load;
    } finally {
      this.#sessionPending.delete(sessionId);
    }
  }

  async #consumeEngineEvents(
    state: SessionState,
    events: AsyncIterable<EngineEvent>,
  ): Promise<void> {
    try {
      for await (const event of events) {
        if (state.closed) return;
        this.#inFlight += 1;
        try {
          await this.#handleEngineEvent(state, event);
        } catch (error) {
          if (isStorageFailure(error)) {
            this.#reportStorageFailure(error);
            state.closed = true;
            return;
          }
          this.#logger.error("處理引擎事件失敗", {
            sessionId: state.sessionId,
            kind: event.kind,
            message: errorMessage(error),
          });
        } finally {
          this.#inFlight -= 1;
        }
      }
    } catch (error) {
      if (!state.closed) {
        this.#logger.warn("引擎事件流結束", {
          sessionId: state.sessionId,
          message: errorMessage(error),
        });
      }
    }
  }

  async #handleEngineEvent(state: SessionState, event: EngineEvent): Promise<void> {
    const stream = `session:${state.sessionId}`;
    switch (event.kind) {
      case "turn.started": {
        const triggerMessageId =
          state.turnTrigger.get(event.turnId) ?? deriveTriggerMessageId(event.turnId);
        const startedAt = event.at;
        state.turns.set(event.turnId, { turnId: event.turnId, phase: "running", startedAt });
        state.activeTurnId = event.turnId;
        await this.#appendEvent(
          state,
          stream,
          "stream.turn_started",
          {
            sessionId: state.sessionId,
            turnId: event.turnId,
            triggerMessageId,
            startedAt,
          },
          async () => {
            await this.#options.storage.turnIndex.record(
              state.sessionId,
              triggerMessageId,
              event.turnId,
            );
          },
        );
        await this.#appendTurnState(state, stream, event.turnId, "running", startedAt);
        return;
      }
      case "assistant.text.delta": {
        this.#buffer.append({
          sessionId: state.sessionId,
          messageId: event.messageId,
          turnId: event.turnId,
          startedAt: event.at,
          delta: event.text,
        });
        const frame = {
          v: PROTOCOL_VERSION,
          kind: "event",
          type: "stream.text_delta",
          stream,
          seq: this.streamLog.boundary(stream),
          emittedAt: event.at,
          payload: {
            sessionId: state.sessionId,
            turnId: event.turnId,
            messageId: event.messageId,
            delta: event.text,
          },
        };
        this.#broadcastFrame(stream, frame);
        return;
      }
      case "message.appended": {
        if (event.message.role === "assistant") {
          const text = textOf(event.message.content);
          state.pendingAssistant = {
            messageId: event.message.id,
            turnId: event.turnId ?? state.activeTurnId ?? "",
            text,
            createdAt: event.message.createdAt,
          };
        }
        return;
      }
      case "tool.started": {
        await this.#flushAssistant(state, stream, "complete");
        state.toolCalls.set(event.callId, {
          toolCallId: event.callId,
          name: event.toolName,
          input: toProtocolJson(event.input) as JSONObject,
          turnId: event.turnId,
          createdAt: event.at,
          outcome: null,
        });
        await this.#appendEvent(state, stream, "stream.tool_call", {
          sessionId: state.sessionId,
          turnId: event.turnId,
          toolCallId: event.callId,
          name: event.toolName,
          title: `執行 ${event.toolName}`,
          input: toProtocolJson(event.input) as JSONObject,
        });
        return;
      }
      case "tool.finished": {
        const diagnostics: ToolDiagnostic[] = (event.outcome.diagnostics ?? []).map((diagnostic) =>
          protocolDiagnostic(diagnostic),
        );
        const output = toolOutput(event.outcome);
        const status = event.outcome.ok ? "ok" : "error";
        const view = state.toolCalls.get(event.callId);
        if (view) {
          view.outcome = { status, output, diagnostics };
        }
        await this.#appendEvent(state, stream, "stream.tool_result", {
          sessionId: state.sessionId,
          turnId: event.turnId,
          toolCallId: event.callId,
          status,
          output: output as JSONObject,
          diagnostics: diagnostics as unknown as JSONObject[],
        });
        await this.#emitUiForTool(state, stream, event.turnId, event.callId, event.outcome);
        return;
      }
      case "approval.requested": {
        const projection = this.#approvalProjection(event.request);
        state.pendingApprovalId = projection.approvalId;
        const approvalTurnId = event.request.draft.turnId ?? "";
        const approvalView = state.turns.get(approvalTurnId);
        state.turns.set(approvalTurnId, {
          turnId: approvalTurnId,
          phase: "waiting_approval",
          startedAt: approvalView?.startedAt ?? event.at,
        });
        await this.#appendEvent(
          state,
          stream,
          "approval.requested",
          projection as unknown as JSONObject,
        );
        await this.#appendTurnState(
          state,
          stream,
          event.request.draft.turnId ?? "",
          "waiting_approval",
          event.at,
        );
        return;
      }
      case "approval.resolved": {
        const resolution = event.resolution;
        const gate = this.#pendingDecided.get(resolution.request.id);
        // 等 approval.decide 的回應送出後才送 approval.decided（沿用協定順序），
        // 但事件處理是同一個佇列，所以 decided 一定排在工具結果與 turn.completed 之前。
        if (gate) await gate.promise;
        const sessionId = resolution.request.draft.conversationId ?? state.sessionId;
        if (this.#isPendingApproval(state, resolution.request.id)) {
          state.pendingApprovalId = null;
        }
        const decided = resolution.outcome === "approved" || resolution.outcome === "denied";
        if (!decided) {
          // expired／withdrawn 沒有對應的協定 effect；只更新快照（pendingApproval
          // 消失），不送 approval.decided，避免把逾時或撤回誤報成「拒絕」。
          return;
        }
        const effect = resolution.outcome === "approved" ? "approve" : "reject";
        const decidedByClient = resolution.decision?.decidedBy.clientId;
        await this.#appendEvent(state, stream, "approval.decided", {
          approvalId: resolution.request.id,
          sessionId,
          effect,
          decidedAt: resolution.decision?.decidedAt ?? event.at,
          decidedBy:
            decidedByClient === undefined
              ? { kind: "system" }
              : { kind: "client", clientId: decidedByClient },
        });
        const turnId = resolution.request.draft.turnId;
        if (turnId !== undefined && state.activeTurnId === turnId) {
          await this.#appendTurnState(state, stream, turnId, "running", event.at);
        }
        return;
      }
      case "turn.completed": {
        const status = turnCompletedStatus(event.status);
        if (!state.pendingAssistant) {
          const streaming = this.#buffer.current(state.sessionId);
          if (streaming && streaming.turnId === event.turnId && streaming.text.length > 0) {
            state.pendingAssistant = {
              messageId: streaming.messageId,
              turnId: streaming.turnId,
              text: streaming.text,
              createdAt: streaming.startedAt,
            };
          }
        }
        await this.#flushAssistant(state, stream, status);
        this.#buffer.clear(state.sessionId);
        state.activeTurnId = null;
        const view = state.turns.get(event.turnId);
        const startedAt = view?.startedAt ?? event.at;
        const error = event.failure
          ? {
              code: event.failure.code,
              message: event.failure.message,
              retryable: false,
            }
          : undefined;
        state.turns.set(event.turnId, {
          turnId: event.turnId,
          phase: status === "complete" ? "completed" : status,
          startedAt,
          endedAt: event.at,
          ...(error ? { error } : {}),
        });
        await this.#appendEvent(state, stream, "stream.turn_state", {
          turnId: event.turnId,
          state: status === "complete" ? "completed" : status,
          startedAt,
          endedAt: event.at,
          ...(error ? { error } : {}),
        });
        return;
      }
      default:
        return;
    }
  }

  #beginDecisionGate(approvalId: string): () => void {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#pendingDecided.set(approvalId, { promise, resolve: release });
    return () => {
      const entry = this.#pendingDecided.get(approvalId);
      if (!entry) return;
      this.#pendingDecided.delete(approvalId);
      entry.resolve();
    };
  }

  #isPendingApproval(state: SessionState, approvalId: string): boolean {
    return state.pendingApprovalId === approvalId;
  }

  async #appendTurnState(
    state: SessionState,
    stream: string,
    turnId: string,
    phase: TurnPhase,
    startedAt: string,
  ): Promise<void> {
    const view = state.turns.get(turnId);
    await this.#appendEvent(state, stream, "stream.turn_state", {
      turnId,
      state: phase,
      startedAt: view?.startedAt ?? startedAt,
    });
  }

  async #appendEvent(
    state: SessionState,
    stream: string,
    kind: string,
    payload: JSONObject,
    projection?: () => void | Promise<void>,
  ): Promise<StoredEvent> {
    void state;
    const stored = await this.streamLog.append(
      {
        stream,
        kind,
        payload,
        at: this.#clock.now().toISOString(),
      },
      projection,
    );
    this.#broadcast(stored);
    return stored;
  }

  async #flushAssistant(
    state: SessionState,
    stream: string,
    status: "complete" | "interrupted" | "failed",
  ): Promise<void> {
    const pending = state.pendingAssistant;
    if (!pending) return;
    state.pendingAssistant = null;
    const entry: AssistantTranscriptEntry = {
      id: pending.messageId,
      role: "assistant",
      turnId: pending.turnId,
      createdAt: pending.createdAt,
      text: pending.text,
      status,
    };
    state.messageStatus.set(pending.messageId, status);
    state.messageTurns.set(pending.messageId, pending.turnId);
    state.messageCount += 1;
    this.#messageCounts.set(state.sessionId, (this.#messageCounts.get(state.sessionId) ?? 0) + 1);
    await this.#appendEvent(state, stream, "stream.message_completed", {
      sessionId: state.sessionId,
      turnId: pending.turnId,
      entry: entry as unknown as JSONObject,
    });
    this.#buffer.clearMessage(pending.messageId);
  }

  async #emitUiForTool(
    state: SessionState,
    stream: string,
    turnId: string,
    toolCallId: string,
    outcome: { ok: boolean; content?: readonly unknown[]; metadata?: unknown; message?: string },
  ): Promise<void> {
    if (outcome.ok) {
      for (const block of outcome.content ?? []) {
        const content = block as { type?: string; card?: unknown };
        if (content.type === "card" && content.card !== undefined) {
          await this.#appendEvent(state, stream, "stream.ui", {
            sessionId: state.sessionId,
            turnId,
            toolCallId,
            renderer: "module.cards.card",
            data: toProtocolJson(content.card as EngineJsonValue),
          });
        }
      }
    }
    const metadata = outcome.metadata;
    if (metadata === undefined) return;
    if (
      typeof metadata === "object" &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      typeof (metadata as Unknown).renderer === "string" &&
      "data" in (metadata as Unknown)
    ) {
      await this.#appendEvent(state, stream, "stream.ui", {
        sessionId: state.sessionId,
        turnId,
        toolCallId,
        renderer: (metadata as { renderer: string }).renderer,
        data: toProtocolJson((metadata as { data: EngineJsonValue }).data),
      });
      return;
    }
    this.#logger.warn("工具 metadata 不是 {renderer,data}，已略過介面資料", {
      sessionId: state.sessionId,
      toolCallId,
    });
  }

  #approvalProjection(request: EngineApprovalRequest): ProtocolApprovalRequest {
    const details = request.draft.action.details;
    const summary = details?.map((detail) => `${detail.label}：${detail.value}`).join("；");
    return {
      approvalId: request.id,
      sessionId: request.draft.conversationId ?? "",
      turnId: request.draft.turnId ?? "",
      ...(request.draft.toolCallId === undefined ? {} : { toolCallId: request.draft.toolCallId }),
      title: request.draft.action.summary,
      ...(summary === undefined || summary.length === 0 ? {} : { summary }),
      scope: {
        kind: "tool_call",
        target: request.draft.action.toolName ?? "tool",
        ...(request.draft.action.toolInput === undefined
          ? {}
          : { detail: toProtocolJson(request.draft.action.toolInput) }),
      },
      options: [
        { id: "approve", label: "核准", effect: "approve" },
        { id: "deny", label: "拒絕", effect: "reject" },
      ],
      requestedAt: request.requestedAt,
      ...(request.expiresAt === null ? {} : { expiresAt: request.expiresAt }),
    };
  }

  // ---- 快照 -------------------------------------------------------------

  async #oldestPending(sessionId: string): Promise<EngineApprovalRequest | null> {
    const pending = await this.#options.engine.approvals.listPending({
      conversationId: sessionId,
    });
    const sorted = [...pending].sort((left, right) => {
      if (left.requestedAt === right.requestedAt) return left.id.localeCompare(right.id);
      return left.requestedAt.localeCompare(right.requestedAt);
    });
    return sorted[0] ?? null;
  }

  async #sessionSnapshot(state: SessionState, historyLimit: number): Promise<SessionSnapshot> {
    const summary = await this.#options.engine.getConversation(state.sessionId);
    if (!summary) throw new RequestFailure(protocolError("not_found", "找不到這場會話。"));
    const entries = await this.#entries(state, historyLimit);
    const oldest = await this.#oldestPending(state.sessionId);
    const activeTurn = state.activeTurnId
      ? this.#turnState(state.turns.get(state.activeTurnId))
      : null;
    const streaming = state.activeTurnId ? this.#buffer.current(state.sessionId) : null;
    return {
      session: this.#sessionSummary(summary, state),
      entries,
      ...(activeTurn ? { activeTurn } : {}),
      ...(oldest ? { pendingApproval: this.#approvalProjection(oldest) } : {}),
      ...(streaming ? { streaming } : {}),
    };
  }

  #turnState(view: TurnView | undefined): TurnState | null {
    if (!view) return null;
    return {
      turnId: view.turnId,
      state: view.phase,
      startedAt: view.startedAt,
      ...(view.endedAt === undefined ? {} : { endedAt: view.endedAt }),
      ...(view.error === undefined ? {} : { error: view.error }),
    };
  }

  #sessionSummary(summary: ConversationSummary, state: SessionState): SessionSummary {
    const status = state.pendingApprovalId
      ? "waiting_approval"
      : state.activeTurnId
        ? "running"
        : "idle";
    return {
      id: summary.id,
      title: summary.title,
      status,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      messageCount: this.#messageCounts.get(summary.id) ?? state.messageCount,
    };
  }

  async #entries(state: SessionState, limit: number): Promise<TranscriptEntry[]> {
    const page = await this.#options.engine.readConversationHistory({
      conversationId: state.sessionId,
      limit,
    });
    const entries: TranscriptEntry[] = [];
    for (const message of page.messages) {
      const text = textOf(message.content);
      if (message.role === "user") {
        const turnId =
          state.messageTurns.get(message.id) ?? this.#turnFromTrigger(state, message.id) ?? "";
        const entry: UserTranscriptEntry = {
          id: message.id,
          role: "user",
          turnId,
          createdAt: message.createdAt,
          text,
        };
        entries.push(entry);
      } else if (message.role === "assistant") {
        const entry: AssistantTranscriptEntry = {
          id: message.id,
          role: "assistant",
          turnId: state.messageTurns.get(message.id) ?? "",
          createdAt: message.createdAt,
          text,
          status: state.messageStatus.get(message.id) ?? "complete",
        };
        entries.push(entry);
      }
    }
    for (const view of state.toolCalls.values()) {
      const entry: ToolTranscriptEntry = {
        id: view.toolCallId,
        role: "tool",
        turnId: view.turnId,
        createdAt: view.createdAt,
        toolCallId: view.toolCallId,
        name: view.name,
        input: view.input,
        ...(view.outcome ? { output: view.outcome.output } : {}),
        status: view.outcome ? (view.outcome.status === "ok" ? "complete" : "failed") : "streaming",
        diagnostics: (view.outcome?.diagnostics ?? []) as ToolDiagnostic[],
      };
      entries.push(entry);
    }
    entries.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return entries.slice(Math.max(0, entries.length - limit));
  }

  #turnFromTrigger(state: SessionState, messageId: string): string | null {
    for (const [turnId, trigger] of state.turnTrigger) {
      if (trigger === messageId) return turnId;
    }
    return null;
  }

  // ---- 會話請求 ---------------------------------------------------------

  async #createSession(request: ParsedRequest): Promise<Unknown> {
    const title = optionalString(request.payload, "title");
    const clientRequestId = optionalString(request.payload, "clientRequestId");
    const key = clientRequestId ? `session-create:${clientRequestId}` : null;
    if (key === null) {
      const summary = await this.#createConversation(title, undefined);
      return response(request.id, "session.create", { session: summary });
    }
    const dedupe = await this.#options.storage.dedupe.claim(key, "session-create");
    if (dedupe.outcome === "existing") {
      return this.#recoverCreateSession(dedupe.record, clientRequestId ?? "", request.id);
    }
    const summary = await this.#createConversation(title, clientRequestId);
    await this.#options.storage.dedupe.setResource(key, summary.id);
    const payload = { session: summary };
    if (this.#faultSkipComplete) {
      // 測試故障注入：模擬「引擎已建立、回應前中斷」，dedupe 停在 pending。
      this.#faultSkipComplete = false;
    } else {
      await this.#options.storage.dedupe.complete(key, payload as unknown as JSONValue);
    }
    return response(request.id, "session.create", payload);
  }

  async #createConversation(
    title: string | undefined,
    clientRequestId: string | undefined,
  ): Promise<SessionSummary> {
    const settings = await this.#options.engine.getModelSettings();
    const model = settings.roles.main;
    const summary = await this.#options.engine.createConversation({
      ...(title === undefined ? {} : { title }),
      ...(clientRequestId === undefined ? {} : { clientRequestId }),
      purpose: "conversation",
      model,
      systemContext: this.#options.systemContext?.() ?? "你是 Cardiary 的助理。",
      toolBundles: this.#options.toolBundles?.() ?? [],
      permissionMode: "hard-rules",
    });
    return {
      id: summary.id,
      title: summary.title,
      status: "idle",
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      messageCount: this.#messageCounts.get(summary.id) ?? 0,
    };
  }

  async #recoverCreateSession(
    record: DedupeRecord,
    clientRequestId: string,
    replyTo: string,
  ): Promise<Unknown> {
    if (record.state === "completed" && record.response !== null) {
      return response(replyTo, "session.create", record.response);
    }
    if (record.resourceId !== null) {
      const existing = await this.#options.engine.getConversation(record.resourceId);
      if (existing) {
        const summary = this.#summaryOf(existing);
        const payload = { session: summary };
        await this.#options.storage.dedupe.complete(record.key, payload as unknown as JSONValue);
        return response(replyTo, "session.create", payload);
      }
    }
    const found = await this.#options.engine.findConversationByClientRequestId(clientRequestId);
    if (found) {
      const payload = { session: this.#summaryOf(found) };
      await this.#options.storage.dedupe.complete(record.key, payload as unknown as JSONValue);
      return response(replyTo, "session.create", payload);
    }
    throw await this.#dedupeUnknown(record);
  }

  async #dedupeUnknown(record: { readonly claimedAt: string }): Promise<RequestFailure> {
    const age = this.#clock.now().getTime() - Date.parse(record.claimedAt);
    if (Number.isFinite(age) && age < 60_000) {
      return new RequestFailure(
        protocolError("conflict", "這個請求還在處理中，請稍後重試。", {
          details: { reason: "pending" },
        }),
      );
    }
    return new RequestFailure(
      protocolError("conflict", "無法判斷先前的請求是否已生效，請重新開啟會話確認。", {
        details: { reason: "result_unknown" },
      }),
    );
  }

  #summaryOf(summary: ConversationSummary): SessionSummary {
    return {
      id: summary.id,
      title: summary.title,
      status: "idle",
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      messageCount: this.#messageCounts.get(summary.id) ?? 0,
    };
  }

  async #listSessions(request: ParsedRequest): Promise<Unknown> {
    const limit = Math.min(
      optionalNumber(request.payload, "limit") ?? this.limits.historyLimit,
      500,
    );
    const cursor = optionalString(request.payload, "cursor");
    const offset = parseOffsetCursor(cursor);
    const list = await this.#options.engine.listConversations?.();
    const all = (list ?? []).filter((summary) => summary.visibility === "listed");
    const page = all.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return response(request.id, "session.list", {
      sessions: page.map((summary) => this.#summaryOf(summary)),
      ...(nextOffset < all.length ? { nextCursor: `off_${nextOffset}` } : {}),
    });
  }

  async #getHistory(request: ParsedRequest): Promise<Unknown> {
    const sessionId = requiredString(request.payload, "sessionId");
    const cursor = optionalString(request.payload, "cursor");
    const limit = Math.min(
      optionalNumber(request.payload, "limit") ?? this.limits.historyLimit,
      200,
    );
    const state = await this.#ensureSession(sessionId);
    const page = await this.#options.engine.readConversationHistory({
      conversationId: sessionId,
      ...(cursor === undefined ? {} : { before: cursor }),
      limit,
    });
    const entries: TranscriptEntry[] = [];
    for (const message of page.messages) {
      const text = textOf(message.content);
      if (message.role === "user") {
        entries.push({
          id: message.id,
          role: "user",
          turnId: state.messageTurns.get(message.id) ?? "",
          createdAt: message.createdAt,
          text,
        });
      } else if (message.role === "assistant") {
        entries.push({
          id: message.id,
          role: "assistant",
          turnId: state.messageTurns.get(message.id) ?? "",
          createdAt: message.createdAt,
          text,
          status: state.messageStatus.get(message.id) ?? "complete",
        });
      }
    }
    return response(request.id, "session.get_history", {
      entries,
      ...(page.nextBefore ? { nextCursor: page.nextBefore } : {}),
    });
  }

  async #sendMessage(connection: ClientConnection, request: ParsedRequest): Promise<Unknown> {
    const sessionId = requiredString(request.payload, "sessionId");
    const text = requiredString(request.payload, "text");
    const deliveryRaw = requiredString(request.payload, "delivery");
    if (deliveryRaw !== "queue" && deliveryRaw !== "interrupt") {
      throw new RequestFailure(
        protocolError("invalid_message", "delivery 只能是 queue 或 interrupt。", {
          details: { field: "delivery" },
        }),
      );
    }
    const clientMessageId = optionalString(request.payload, "clientMessageId");
    const state = await this.#ensureSession(sessionId);
    // M0 的會話快照只有一個 pendingApproval：還有未決定的審批時，不開始新回合，
    // 避免同一場會話同時出現兩筆待審批。排隊／插話在回合進行中不受影響。
    if (state.activeTurnId === null) {
      const oldest = await this.#oldestPending(sessionId);
      if (oldest) {
        throw new RequestFailure(
          protocolError("busy", "這場會話還有未決定的審批，請先決定。", {
            details: { reason: "pending_approval", approvalId: oldest.id },
          }),
        );
      }
    }
    const key = clientMessageId ? `send-message:${sessionId}:${clientMessageId}` : null;
    if (key !== null) {
      const dedupe = await this.#options.storage.dedupe.claim(key, "send-message");
      if (dedupe.outcome === "existing") {
        return this.#recoverSendMessage(
          dedupe.record,
          sessionId,
          clientMessageId ?? "",
          request.id,
        );
      }
    }
    const wasRunning = state.activeTurnId !== null;
    if (deliveryRaw === "interrupt" && wasRunning) {
      try {
        await this.#options.engine.cancelTurn({ conversationId: sessionId, reason: "interrupt" });
      } catch {
        // 已經結束的回合不需要再取消。
      }
    }
    const sendRequest = {
      conversationId: sessionId,
      content: [{ type: "text" as const, text }],
      delivery: "queue" as const,
      sender: { kind: "human" as const, clientId: connection.clientInstanceId || connection.id },
      ...(clientMessageId === undefined ? {} : { clientMessageId }),
    };
    const receipt = this.#options.engine.sendMessageWithClientId
      ? await this.#options.engine.sendMessageWithClientId(sendRequest)
      : await this.#options.engine.sendMessage(sendRequest);
    const disposition =
      deliveryRaw === "interrupt" && wasRunning
        ? "interrupted_then_started"
        : receipt.delivery === "queued"
          ? "queued"
          : "started";
    const payload = {
      sessionId,
      userMessageId: receipt.messageId,
      turnId: receipt.turnId ?? "",
      disposition,
      ...(disposition === "queued" && state.activeTurnId
        ? { queuedBehindTurnId: state.activeTurnId }
        : {}),
    };
    if (receipt.turnId) state.turnTrigger.set(receipt.turnId, receipt.messageId);
    state.messageTurns.set(receipt.messageId, receipt.turnId ?? "");
    state.messageCount += 1;
    this.#messageCounts.set(sessionId, (this.#messageCounts.get(sessionId) ?? 0) + 1);
    if (key !== null) {
      await this.#options.storage.dedupe.setResource(key, receipt.messageId);
      await this.#options.storage.dedupe.complete(key, payload as unknown as JSONValue);
    }
    return response(request.id, "session.send_message", payload);
  }

  async #recoverSendMessage(
    record: DedupeRecord,
    sessionId: string,
    clientMessageId: string,
    replyTo: string,
  ): Promise<Unknown> {
    if (record.state === "completed" && record.response !== null) {
      return {
        v: PROTOCOL_VERSION,
        kind: "response",
        replyTo,
        type: "session.send_message",
        payload: record.response,
      };
    }
    if (record.resourceId !== null) {
      const receipt = await this.#options.engine.findMessageByClientId(sessionId, clientMessageId);
      if (receipt && receipt.messageId === record.resourceId) {
        const payload = {
          sessionId,
          userMessageId: receipt.messageId,
          turnId: receipt.turnId ?? "",
          disposition: "started",
        };
        await this.#options.storage.dedupe.complete(record.key, payload as unknown as JSONValue);
        return {
          v: PROTOCOL_VERSION,
          kind: "response",
          replyTo,
          type: "session.send_message",
          payload,
        };
      }
    }
    const receipt = await this.#options.engine.findMessageByClientId(sessionId, clientMessageId);
    if (receipt) {
      const payload = {
        sessionId,
        userMessageId: receipt.messageId,
        turnId: receipt.turnId ?? "",
        disposition: "started",
      };
      await this.#options.storage.dedupe.complete(record.key, payload as unknown as JSONValue);
      return {
        v: PROTOCOL_VERSION,
        kind: "response",
        replyTo,
        type: "session.send_message",
        payload,
      };
    }
    throw await this.#dedupeUnknown(record);
  }

  async #interrupt(request: ParsedRequest): Promise<Unknown> {
    const sessionId = requiredString(request.payload, "sessionId");
    const state = await this.#ensureSession(sessionId);
    const wasRunning = state.activeTurnId !== null;
    if (!wasRunning) {
      return response(request.id, "session.interrupt", { sessionId, interrupted: false });
    }
    try {
      await this.#options.engine.cancelTurn({ conversationId: sessionId, reason: "interrupt" });
    } catch {
      return response(request.id, "session.interrupt", { sessionId, interrupted: false });
    }
    return response(request.id, "session.interrupt", { sessionId, interrupted: true });
  }

  // ---- 審批 -------------------------------------------------------------

  async #decideApproval(connection: ClientConnection, request: ParsedRequest): Promise<Unknown> {
    const approvalId = requiredString(request.payload, "approvalId");
    const optionId = requiredString(request.payload, "optionId");
    const note = optionalString(request.payload, "note");
    if (optionId !== "approve" && optionId !== "deny") {
      throw new RequestFailure(
        protocolError("invalid_message", "不支援的審批選項。", { details: { field: "optionId" } }),
      );
    }
    const existing = await this.#options.engine.approvals.get(approvalId);
    if (!existing) {
      throw new RequestFailure(protocolError("not_found", "找不到這筆審批。"));
    }
    const releaseDecision = this.#beginDecisionGate(approvalId);
    const result = await this.#options.engine.approvals.decide({
      requestId: approvalId,
      verdict: optionId === "approve" ? "approve" : "deny",
      decidedBy: { kind: "human", clientId: connection.clientInstanceId || connection.id },
      ...(note === undefined ? {} : { note }),
    });
    if (result.outcome === "not-found") {
      releaseDecision();
      throw new RequestFailure(protocolError("not_found", "找不到這筆審批。"));
    }
    if (result.outcome === "expired") {
      releaseDecision();
      throw new RequestFailure(
        protocolError("conflict", "這筆審批已經逾時。", {
          details: { reason: "approval_expired" },
        }),
      );
    }
    if (result.outcome === "withdrawn") {
      releaseDecision();
      throw new RequestFailure(
        protocolError("conflict", "這筆審批已經撤回。", { details: { reason: "withdrawn" } }),
      );
    }
    if (result.outcome === "already-decided") {
      releaseDecision();
      throw new RequestFailure(
        protocolError("conflict", "這筆審批已經有決定了。", {
          details: {
            decision: {
              verdict: result.decision.verdict,
              decidedAt: result.decision.decidedAt,
              effect: result.decision.verdict === "approve" ? "approve" : "reject",
            },
          },
        }),
      );
    }
    const decision = result.decision;
    const effect = decision.verdict === "approve" ? "approve" : "reject";
    const payload = {
      approvalId,
      effect,
      decidedAt: decision.decidedAt,
      persisted: true,
    };
    // 先回回應（決定已由 ledger 落地）；approval.decided 由引擎事件處理，
    // 透過 gate 排在這個回應之後、工具結果與 turn.completed 之前。
    await connection.send(response(request.id, "approval.decide", payload));
    releaseDecision();
    return { __handled: true };
  }

  async #pauseAll(request: ParsedRequest): Promise<Unknown> {
    const reason = optionalString(request.payload, "reason") ?? "使用者緊急暫停";
    const paused = await this.#options.engine.pauseAll(reason);
    // 比照 HostService.pause：工具子行程要真的被取消，不只手停回合。
    if (this.#options.cancelToolProcesses) {
      await this.#options.cancelToolProcesses(5000);
    }
    const interruptedSessionIds: string[] = [];
    for (const turn of paused.pausedTurns) {
      if (!interruptedSessionIds.includes(turn.conversationId)) {
        interruptedSessionIds.push(turn.conversationId);
      }
      const state = this.#sessions.get(turn.conversationId);
      if (state) state.activeTurnId = null;
    }
    return response(request.id, "approval.pause_all", {
      pausedAt: paused.startedAt,
      interruptedSessionIds,
    });
  }

  // ---- 模組 -------------------------------------------------------------

  async #moduleRequest(connection: ClientConnection, request: ParsedRequest): Promise<Unknown> {
    void connection;
    if (!/^module\.[a-z0-9-]+\.[a-z0-9.-]+$/.test(request.type)) {
      throw new RequestFailure(protocolError("invalid_message", "模組型別格式不正確。"));
    }
    const namespace = request.type.split(".")[1] ?? "";
    const handler = this.#moduleHandlers.get(namespace);
    if (!handler) {
      throw new RequestFailure(
        protocolError("not_found", `沒有已註冊的模組命名空間：${namespace}。`),
      );
    }
    const data = request.payload.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new RequestFailure(protocolError("invalid_message", "模組請求缺少 data 物件。"));
    }
    const result = await handler(data as JSONObject);
    return response(request.id, request.type, { data: result });
  }

  // ---- 輸出 -------------------------------------------------------------

  #broadcast(event: StoredEvent): void {
    const frame = eventFrame(event);
    this.#broadcastFrame(event.stream, frame);
  }

  #broadcastFrame(stream: string, frame: Unknown): void {
    for (const connection of this.#connections.values()) {
      if (!connection.authenticated) continue;
      if (!connection.subscriptions.has(stream)) continue;
      void connection.send(frame);
    }
  }

  async #sendError(
    connection: ClientConnection,
    info: ProtocolErrorInfo,
    replyTo?: string,
  ): Promise<void> {
    await connection.send({
      v: PROTOCOL_VERSION,
      kind: "error",
      ...(replyTo === undefined ? {} : { replyTo }),
      code: info.code,
      message: info.message,
      ...(info.details === undefined ? {} : { details: info.details }),
      retryable: info.retryable,
    });
  }

  // ---- HTTP -------------------------------------------------------------

  #handleHttp(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const sendJson = (status: number, body: unknown): void => {
      const data = JSON.stringify(body);
      response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(data),
        "cache-control": "no-store",
      });
      response.end(data);
    };
    const auth = parseBearer(request.headers.authorization);
    if (auth === null || !constantTimeEqual(auth, this.#options.clientToken)) {
      sendJson(401, {
        v: PROTOCOL_VERSION,
        kind: "error",
        code: "auth_invalid",
        message: "Token 不正確。",
        retryable: false,
      });
      return;
    }
    if (!url.pathname.startsWith("/v1/blobs/")) {
      sendJson(404, {
        v: PROTOCOL_VERSION,
        kind: "error",
        code: "not_found",
        message: "沒有這個端點。",
        retryable: false,
      });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(400, {
        v: PROTOCOL_VERSION,
        kind: "error",
        code: "unsupported",
        message: "HTTP 端點只傳大型內容，不做狀態變更。",
        retryable: false,
      });
      return;
    }
    sendJson(404, {
      v: PROTOCOL_VERSION,
      kind: "error",
      code: "not_found",
      message: "M0 還沒有任何大型內容端點。",
      retryable: false,
    });
  }
}

// ---- 輔助函式 -----------------------------------------------------------

function isHandled(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __handled?: boolean }).__handled === true
  );
}

export function response(replyTo: string, type: string, payload: unknown): Unknown {
  return { v: PROTOCOL_VERSION, kind: "response", replyTo, type, payload };
}

export function eventFrame(event: StoredEvent): Unknown {
  return {
    v: PROTOCOL_VERSION,
    kind: "event",
    type: event.kind,
    stream: event.stream,
    seq: event.seq,
    emittedAt: event.at,
    payload: event.payload,
  };
}

export function moduleEventFrame(event: StoredEvent): ModuleEvent {
  return {
    v: PROTOCOL_VERSION,
    kind: "event",
    type: event.kind,
    stream: event.stream,
    seq: event.seq,
    emittedAt: event.at,
    payload: event.payload as unknown as ModuleEvent["payload"],
  };
}

function requiredString(payload: JSONObject, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new RequestFailure(
      protocolError("invalid_message", `缺少必填欄位 ${field}。`, { details: { field } }),
    );
  }
  return value;
}

function optionalString(payload: JSONObject, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RequestFailure(
      protocolError("invalid_message", `${field} 必須是字串。`, { details: { field } }),
    );
  }
  return value;
}

function optionalNumber(payload: JSONObject, field: string): number | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestFailure(
      protocolError("invalid_message", `${field} 必須是數字。`, { details: { field } }),
    );
  }
  return value;
}

function toProtocolJson(value: EngineJsonValue): JSONValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => toProtocolJson(item));
  const result: Record<string, JSONValue> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toProtocolJson(item as EngineJsonValue);
  }
  return result;
}

/** 設計定案：`turnId = "turn_" + 觸發訊息 ID`；沒有對照時由這裡還原。 */
function deriveTriggerMessageId(turnId: string): string {
  return turnId.startsWith("turn_") ? turnId.slice(5) : turnId;
}

function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

function toolOutput(outcome: {
  readonly ok: boolean;
  readonly content?: readonly unknown[];
  readonly message?: string;
  readonly diagnostics?: readonly { readonly code: string }[];
}): ToolOutput {
  if (!outcome.ok) {
    return { text: outcome.message ?? "工具執行失敗" };
  }
  const texts: string[] = [];
  let data: JSONValue | undefined;
  for (const block of outcome.content ?? []) {
    const content = block as { type?: string; text?: string; value?: JSONValue };
    if (content.type === "text" && typeof content.text === "string") {
      texts.push(content.text);
    } else if (content.type === "json" && content.value !== undefined) {
      data = content.value;
    }
  }
  const truncated = (outcome.diagnostics ?? []).some(
    (diagnostic) => diagnostic.code === "output-truncated",
  );
  return {
    ...(texts.length > 0 ? { text: texts.join("\n") } : {}),
    ...(data === undefined ? {} : { data }),
    ...(truncated ? { truncated: true } : {}),
  };
}

function turnCompletedStatus(
  status: "completed" | "cancelled" | "paused" | "failed" | "interrupted",
): "complete" | "interrupted" | "failed" {
  if (status === "completed") return "complete";
  if (status === "failed") return "failed";
  return "interrupted";
}

type TurnPhaseAlias = TurnPhase;

function parseOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const value = Number.parseInt(cursor.replace(/^off_/, ""), 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseBearer(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "tauri:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

const ENGINE_ERROR_CODES = new Set([
  "conversation-not-found",
  "conversation-busy",
  "turn-not-found",
  "engine-paused",
  "engine-closed",
  "approval-not-found",
  "approval-expired",
  "approval-already-decided",
  "tool-not-registered",
  "model-unavailable",
  "storage-unavailable",
  "subagent-limit-reached",
  "subagent-depth-exceeded",
  "subagent-not-found",
  "context-injection-unsupported",
  "invalid-cursor",
  "invalid-request",
  "internal",
]);

function isEngineError(error: unknown): error is { code: EngineErrorCode; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    ENGINE_ERROR_CODES.has((error as { code: string }).code)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { GatewayLimits, StreamingMessage, ApprovalRequestedEvent, ToolPhase };

type ToolPhase = TurnPhaseAlias;
