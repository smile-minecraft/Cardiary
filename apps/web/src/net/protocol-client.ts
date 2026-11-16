/**
 * 網頁端的協定客戶端：一條 WebSocket、請求與回應按 `replyTo` 配對、事件原樣轉交。
 *
 * 認證方式有兩種：
 * - 沒有 Token（配對模式）：連上後不送 `system.hello`，只允許 `pairing.begin`
 *   與同連線的 `pairing.complete`；核准前領不到 Token。
 * - 有 Token：連上後先送 `system.hello`（Token 在 payload，不在 URL），
 *   驗證通過才開放其他請求。
 *
 * 重連由呼叫端決定；本類別只如實回報關閉事件。`close()` 標記為主動關閉，
 * 呼叫端收到 `intentional: true` 就不該重連。
 */

import type {
  ErrorCode,
  JSONObject,
  ServerFrame,
  SystemHelloResponsePayload,
} from "@cardiary/protocol";

/** 伺服器送出的事件（`kind: "event"`）；型別由 `type` 區分。 */
export type ServerEvent = Extract<ServerFrame, { kind: "event" }>;

const PROTOCOL_MIN = 1;
const PROTOCOL_MAX = 1;
const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 30_000;

/** 伺服器回的錯誤信封；`replyTo` 缺省代表連線層級的錯誤。 */
export class ProtocolRequestError extends Error {
  readonly code: ErrorCode | "connection_closed" | "timeout";
  readonly details: JSONObject | undefined;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode | "connection_closed" | "timeout",
    message: string,
    options: { details?: JSONObject; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ProtocolRequestError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

/** 測試替身要實作這個介面；正式環境用瀏覽器的 WebSocket。 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const browserWebSocket: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike;

/** 預設連線位址：同源 + `/v1/ws`，http→ws、https→wss。 */
export function defaultWebSocketUrl(): string {
  const scheme = globalThis.location?.protocol === "https:" ? "wss" : "ws";
  const host = globalThis.location?.host ?? "127.0.0.1";
  return `${scheme}://${host}/v1/ws`;
}

export interface HelloInfo {
  readonly connectionId: string;
  readonly epoch: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly protocolVersion: number;
}

export interface ProtocolClientHandlers {
  /** 配對模式：WebSocket 已開，可以送 `pairing.begin`。 */
  onReady?(): void;
  /** Token 模式：`system.hello` 通過，之後才可以送其他請求。 */
  onAuthenticated?(info: HelloInfo): void;
  /** Token 模式：`system.hello` 被拒（Token 錯誤或已撤銷）。 */
  onHelloFailed?(error: ProtocolRequestError): void;
  /** 伺服器送出的事件；型別由 `frame.type` 區分。 */
  onEvent?(frame: ServerEvent): void;
  onClose?(info: { code: number; reason: string; intentional: boolean }): void;
  /** 無法歸到某個請求的訊息；只用來顯示診斷，不影響流程。 */
  onDiagnostic?(message: string): void;
}

export interface ProtocolClientOptions {
  /** 裝置 Token；省略代表配對模式（不送 hello）。 */
  readonly token?: string | undefined;
  readonly instanceId: string;
  readonly clientVersion: string;
  readonly url?: string | undefined;
  readonly createWebSocket?: WebSocketFactory | undefined;
  readonly handlers?: ProtocolClientHandlers | undefined;
}

interface PendingRequest {
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: ProtocolRequestError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

let idCounter = 0;
function nextRequestId(): string {
  idCounter += 1;
  return `req_${Date.now().toString(36)}_${idCounter}`;
}

/** 重連間隔：250ms 起跳、逐次加倍、上限 5 秒。 */
export function reconnectDelay(attempt: number): number {
  const clamped = Math.max(0, Math.min(attempt, 10));
  return Math.min(5000, 250 * 2 ** clamped);
}

export class ProtocolClient {
  readonly #options: ProtocolClientOptions;
  readonly #handlers: ProtocolClientHandlers;
  readonly #pending = new Map<string, PendingRequest>();
  #socket: WebSocketLike | null = null;
  #helloId: string | null = null;
  #intentionalClose = false;
  #helloFailed = false;

  constructor(options: ProtocolClientOptions) {
    this.#options = options;
    this.#handlers = options.handlers ?? {};
  }

  get url(): string {
    return this.#options.url ?? defaultWebSocketUrl();
  }

  /** WebSocket 是否已開啟；配對頁用它來判斷何時可以送 pairing.begin。 */
  get isOpen(): boolean {
    return this.#socket?.readyState === 1;
  }

  /** 送出請求並等待回應；伺服器回錯誤信封時以 `ProtocolRequestError` 拒絕。 */
  request<TPayload>(type: string, payload: unknown): Promise<TPayload> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== 1) {
      return Promise.reject(
        new ProtocolRequestError("connection_closed", "連線尚未就緒。", { retryable: true }),
      );
    }
    const id = nextRequestId();
    const frame = { v: PROTOCOL_VERSION, kind: "request", id, type, payload };
    return new Promise<TPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new ProtocolRequestError("timeout", "請求等待回應逾時。", { retryable: true }));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as TPayload),
        reject,
        timer,
      });
      try {
        socket.send(JSON.stringify(frame));
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(
          new ProtocolRequestError(
            "connection_closed",
            error instanceof Error ? error.message : String(error),
            { retryable: true },
          ),
        );
      }
    });
  }

  /** 建立連線；token 模式送出 system.hello，配對模式只開連線。 */
  start(): void {
    const create = this.#options.createWebSocket ?? browserWebSocket;
    const socket = create(this.url);
    this.#socket = socket;
    this.#intentionalClose = false;
    this.#helloFailed = false;

    socket.onopen = () => {
      if (this.#options.token) {
        this.#sendHello();
      } else {
        this.#handlers.onReady?.();
      }
    };
    socket.onmessage = (event) => {
      this.#onMessage(event.data);
    };
    socket.onerror = () => {
      // 瀏覽器不提供原因；交給 onclose 處理，兩邊都會觸發。
    };
    socket.onclose = (event) => {
      this.#settlePending();
      this.#socket = null;
      this.#handlers.onClose?.({
        code: event.code,
        reason: event.reason,
        intentional: this.#intentionalClose,
      });
    };
  }

  /** 主動關閉；收到的 `intentional` 為 true，呼叫端不該再重連。 */
  close(): void {
    this.#intentionalClose = true;
    this.#helloFailed = true; // 不要再走 hello 失敗的分支。
    const socket = this.#socket;
    this.#socket = null;
    this.#settlePending();
    socket?.close(1000, "client_closing");
  }

  #sendHello(): void {
    const token = this.#options.token;
    if (!token) return;
    const id = nextRequestId();
    this.#helloId = id;
    const frame = {
      v: PROTOCOL_VERSION,
      kind: "request",
      id,
      type: "system.hello",
      payload: {
        auth: { token },
        protocol: { min: PROTOCOL_MIN, max: PROTOCOL_MAX },
        client: {
          name: "Cardiary Web",
          version: this.#options.clientVersion,
          platform: "web",
          instanceId: this.#options.instanceId,
        },
      },
    };
    this.#socket?.send(JSON.stringify(frame));
  }

  #onMessage(data: unknown): void {
    if (typeof data !== "string") {
      this.#handlers.onDiagnostic?.("收到非文字訊息，已忽略。");
      return;
    }
    let frame: { kind?: unknown; type?: unknown; replyTo?: unknown };
    try {
      frame = JSON.parse(data) as typeof frame;
    } catch {
      this.#handlers.onDiagnostic?.("收到無法解析的訊息，已忽略。");
      return;
    }
    if (typeof frame !== "object" || frame === null) {
      this.#handlers.onDiagnostic?.("收到非物件訊息，已忽略。");
      return;
    }
    const kind = frame.kind;
    if (kind === "response" && typeof frame.replyTo === "string") {
      this.#onResponse(frame as { replyTo: string; type?: string }, data);
      return;
    }
    if (kind === "error") {
      this.#onError(
        frame as {
          replyTo?: string;
          code?: string;
          message?: string;
          details?: JSONObject;
          retryable?: boolean;
        },
      );
      return;
    }
    if (kind === "event") {
      this.#handlers.onEvent?.(frame as unknown as ServerEvent);
      return;
    }
    this.#handlers.onDiagnostic?.(`收到未知的訊息種類：${String(kind)}`);
  }

  #onResponse(frame: { replyTo: string; type?: string }, raw: string): void {
    if (this.#helloId !== null && frame.replyTo === this.#helloId) {
      this.#helloId = null;
      let parsed: SystemHelloResponsePayload | undefined;
      try {
        parsed = (JSON.parse(raw) as { payload: SystemHelloResponsePayload }).payload;
      } catch {
        parsed = undefined;
      }
      if (!parsed) {
        this.#failHello(new ProtocolRequestError("internal", "system.hello 的回應無法解析。"));
        return;
      }
      this.#handlers.onAuthenticated?.({
        connectionId: parsed.connectionId,
        epoch: parsed.epoch,
        serverName: parsed.server.name,
        serverVersion: parsed.server.version,
        protocolVersion: parsed.protocol.version,
      });
      return;
    }
    const pending = this.#pending.get(frame.replyTo);
    if (!pending) return;
    this.#pending.delete(frame.replyTo);
    clearTimeout(pending.timer);
    try {
      const payload = (JSON.parse(raw) as { payload: unknown }).payload;
      pending.resolve(payload);
    } catch {
      pending.reject(new ProtocolRequestError("internal", "回應無法解析。"));
    }
  }

  #onError(frame: {
    replyTo?: string;
    code?: string;
    message?: string;
    details?: JSONObject;
    retryable?: boolean;
  }): void {
    const code = (frame.code ?? "internal") as ErrorCode;
    const message = frame.message ?? "主機回報錯誤。";
    const options: { details?: JSONObject; retryable?: boolean } = {
      retryable: frame.retryable === true,
    };
    if (frame.details !== undefined) options.details = frame.details;
    const error = new ProtocolRequestError(code, message, options);
    if (frame.replyTo !== undefined && this.#helloId === frame.replyTo) {
      this.#helloId = null;
      this.#failHello(error);
      return;
    }
    if (frame.replyTo !== undefined) {
      const pending = this.#pending.get(frame.replyTo);
      if (pending) {
        this.#pending.delete(frame.replyTo);
        clearTimeout(pending.timer);
        pending.reject(error);
        return;
      }
    }
    // 連線層級的錯誤（沒有 replyTo）：hello 之前送出的話走 hello 失敗。
    if (this.#helloId !== null) {
      this.#helloId = null;
      this.#failHello(error);
      return;
    }
    this.#handlers.onDiagnostic?.(`${code}：${message}`);
  }

  #failHello(error: ProtocolRequestError): void {
    this.#helloFailed = true;
    this.#handlers.onHelloFailed?.(error);
  }

  /** 連線結束：所有等待中的請求都以連線關閉拒絕。 */
  #settlePending(): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new ProtocolRequestError("connection_closed", "連線已關閉。", { retryable: true }),
      );
    }
    this.#pending.clear();
    if (this.#helloId !== null && this.#helloFailed) {
      this.#helloId = null;
    } else if (this.#helloId !== null) {
      // hello 在途中連線就斷了：視為 hello 失敗，讓呼叫端回到配對畫面。
      this.#helloId = null;
      this.#failHello(
        new ProtocolRequestError("connection_closed", "連線在驗證完成前關閉。", {
          retryable: true,
        }),
      );
    }
  }
}
