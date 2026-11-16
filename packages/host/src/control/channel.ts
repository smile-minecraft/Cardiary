import type { Readable } from "node:stream";
import type { EngineLogger } from "@cardiary/engine-adapter";
import type { JSONObject } from "@cardiary/protocol";

import { ControlError, isStorageFailure } from "../errors.js";
import { constantTimeEqual } from "../tokens.js";
import {
  BROKER_ROUTES,
  CONTROL_PROTOCOL,
  CONTROL_ROUTES,
  controlErrorResponse,
  controlResponse,
  parseInbound,
  type ControlRequest,
  type HelloFrame,
  type OutboundFrame,
} from "./frames.js";
import { DEFAULT_CONTROL_FRAME_BYTES, LineReader, type LineSink } from "./ndjson.js";

export interface ControlChannelOptions {
  readonly input: Readable;
  readonly writer: LineSink;
  /** 殼→服務的控制 Token。 */
  readonly token: string;
  /** 服務→殼的代理 Token。 */
  readonly brokerToken: string;
  readonly logger: EngineLogger;
  readonly maxFrameBytes?: number;
  readonly brokerTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  /** 通道關閉時通知呼叫端；`stdin_end` 表示殼不見了。 */
  readonly onClose?: (reason: string) => void;
  /** 路由處理中出現 StorageFailure 時的通報（由服務走 failStorage）。 */
  readonly onStorageFailure?: (detail: string) => Promise<void> | void;
}

interface PendingBrokerRequest {
  readonly id: string;
  readonly route: string;
  readonly payload: JSONObject;
  readonly timeoutMs: number;
  readonly resolve: (payload: JSONObject) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * 私有控制面（服務端）。
 *
 * 通道是服務 stdin／stdout 的匿名 pipe，沒有 listener、沒有檔案路徑、沒有
 * 額外 fd；每個 frame 都帶 Token，方向分開、常數時間比較。Token 不對或
 * `replyTo` 對不上在途請求就關閉通道，不送 payload。
 */
export class ControlChannel {
  readonly #options: ControlChannelOptions;
  readonly #handlers = new Map<string, (payload: JSONObject) => Promise<JSONObject>>();
  readonly #pending = new Map<string, PendingBrokerRequest>();
  readonly #brokerQueues = new Map<string, PendingBrokerRequest[]>();
  readonly #retiredBrokerIds = new Set<string>();
  readonly #inFlightRoutes = new Set<string>();
  #reader: LineReader | null = null;
  #closed = false;
  #handshakeDone = false;
  #handshake: { resolve: () => void; reject: (error: Error) => void } | null = null;
  #closeReason = "closed";

  constructor(options: ControlChannelOptions) {
    this.#options = options;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get handshakeDone(): boolean {
    return this.#handshakeDone;
  }

  onRequest(route: string, handler: (payload: JSONObject) => Promise<JSONObject>): void {
    this.#handlers.set(route, handler);
  }

  start(): void {
    if (this.#reader) return;
    this.#reader = new LineReader(this.#options.input, {
      maxFrameBytes: this.#options.maxFrameBytes ?? DEFAULT_CONTROL_FRAME_BYTES,
      onLine: (line) => {
        void this.#onLine(line);
      },
      onError: () => {
        this.#close("invalid_message");
      },
      onEnd: () => {
        this.#close("stdin_end");
      },
    });
  }

  /** 送出 `hello` 並等 `hello-ack`；之後才接受代理請求和通知。 */
  async handshake(): Promise<void> {
    const timeoutMs = this.#options.handshakeTimeoutMs ?? 5000;
    const frame: HelloFrame = {
      v: CONTROL_PROTOCOL,
      kind: "hello",
      role: "host-service",
      pid: process.pid,
      auth: { token: this.#options.brokerToken },
    };
    const wait = new Promise<void>((resolve, reject) => {
      this.#handshake = { resolve, reject };
    });
    const timer = setTimeout(() => {
      this.#handshake?.reject(new ControlError("timeout", "hello-ack 逾時"));
    }, timeoutMs);
    timer.unref?.();
    await this.#send(frame);
    try {
      await wait;
    } finally {
      clearTimeout(timer);
    }
    this.#handshakeDone = true;
  }

  async requestBroker(
    route: string,
    payload: JSONObject,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<JSONObject> {
    if (this.#closed) throw new ControlError("unavailable", "控制通道已關閉");
    if (!this.#handshakeDone) throw new ControlError("unavailable", "尚未完成 hello 交握");
    if (!BROKER_ROUTES.has(route)) {
      throw new ControlError("unsupported_route", `不在代理白名單：${route}`);
    }
    if (options?.signal?.aborted) throw new ControlError("cancelled", "代理請求已取消");
    const id = `brk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<JSONObject>((resolve, reject) => {
      const request: PendingBrokerRequest = {
        id,
        route,
        payload,
        timeoutMs: options?.timeoutMs ?? this.#options.brokerTimeoutMs ?? 5000,
        resolve,
        reject,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      };
      const queue = this.#brokerQueues.get(route) ?? [];
      queue.push(request);
      this.#brokerQueues.set(route, queue);
      if (request.signal) {
        request.onAbort = () => this.#cancelBroker(request);
        request.signal.addEventListener("abort", request.onAbort, { once: true });
      }
      if (queue.length === 1) this.#sendBroker(request);
    });
  }

  #sendBroker(request: PendingBrokerRequest): void {
    this.#pending.set(request.id, request);
    request.timer = setTimeout(() => {
      this.#rememberRetiredBroker(request.id);
      const queue = this.#brokerQueues.get(request.route) ?? [];
      this.#brokerQueues.delete(request.route);
      for (const entry of queue) {
        this.#cleanupBroker(entry);
        entry.reject(new ControlError("timeout", `代理路由逾時：${request.route}`));
      }
    }, request.timeoutMs);
    request.timer.unref?.();
    void this.#send({
      v: CONTROL_PROTOCOL,
      kind: "request",
      id: request.id,
      route: request.route,
      auth: { token: this.#options.brokerToken },
      payload: request.payload,
    });
  }

  #rememberRetiredBroker(id: string): void {
    this.#retiredBrokerIds.add(id);
    if (this.#retiredBrokerIds.size > 64) {
      this.#retiredBrokerIds.delete(this.#retiredBrokerIds.values().next().value!);
    }
  }

  #cleanupBroker(request: PendingBrokerRequest): void {
    this.#pending.delete(request.id);
    if (request.timer) clearTimeout(request.timer);
    if (request.signal && request.onAbort) {
      request.signal.removeEventListener("abort", request.onAbort);
    }
  }

  #finishBroker(request: PendingBrokerRequest): void {
    this.#cleanupBroker(request);
    const queue = this.#brokerQueues.get(request.route);
    if (!queue) return;
    const index = queue.indexOf(request);
    if (index < 0) return;
    queue.splice(index, 1);
    if (queue.length === 0) this.#brokerQueues.delete(request.route);
    else if (index === 0) this.#sendBroker(queue[0]!);
  }

  #cancelBroker(request: PendingBrokerRequest): void {
    // 取消只停止等待；沒有取消 frame，殼端的辨識可能仍在執行。
    if (this.#pending.has(request.id)) this.#rememberRetiredBroker(request.id);
    this.#finishBroker(request);
    request.reject(new ControlError("cancelled", "代理請求已取消"));
  }

  async notify(route: string, payload: JSONObject): Promise<void> {
    if (this.#closed) return;
    if (!this.#handshakeDone) return;
    await this.#send({
      v: CONTROL_PROTOCOL,
      kind: "notification",
      route,
      auth: { token: this.#options.brokerToken },
      payload,
    });
  }

  close(reason = "closed"): void {
    this.#close(reason);
  }

  get closeReason(): string {
    return this.#closeReason;
  }

  async #send(frame: OutboundFrame | ReturnType<typeof controlErrorResponse>): Promise<void> {
    if (this.#closed && frame.kind !== "response") return;
    try {
      await this.#options.writer.writeLine(JSON.stringify(frame));
    } catch {
      this.#close("write_failed");
    }
  }

  async #onLine(line: string): Promise<void> {
    if (this.#closed) return;
    let frame;
    try {
      frame = parseInbound(line);
    } catch (error) {
      this.#options.logger.warn("控制面收到壞 frame", {
        reason: error instanceof ControlError ? error.code : "invalid_message",
      });
      this.#close("invalid_message");
      return;
    }
    // 先驗 Token，再看路由或 replyTo。所有入站 frame 都帶殼的控制 Token。
    if (!constantTimeEqual(frame.auth.token, this.#options.token)) {
      if (frame.kind === "request") {
        await this.#send(
          controlErrorResponse(
            frame.id,
            frame.id,
            this.#options.brokerToken,
            "unauthorized",
            "Token 不符。",
          ),
        );
      }
      this.#close("unauthorized");
      return;
    }
    if (frame.kind === "hello-ack") {
      if (!this.#handshake) {
        this.#close("invalid_message");
        return;
      }
      this.#handshake.resolve();
      this.#handshake = null;
      return;
    }
    if (frame.kind === "response") {
      const pending = this.#pending.get(frame.replyTo);
      if (!pending) {
        if (this.#retiredBrokerIds.has(frame.replyTo)) return;
        this.#options.logger.warn("控制面收到對不上在途請求的回應", { replyTo: frame.replyTo });
        this.#close("invalid_message");
        return;
      }
      this.#finishBroker(pending);
      if (frame.ok) {
        pending.resolve(frame.payload ?? {});
      } else {
        pending.reject(
          new ControlError(
            (frame.error?.code as ControlError["code"]) ?? "internal",
            frame.error?.message ?? "代理請求失敗",
          ),
        );
      }
      return;
    }
    await this.#handleRequest(frame);
  }

  async #handleRequest(frame: ControlRequest): Promise<void> {
    if (!CONTROL_ROUTES.has(frame.route)) {
      await this.#send(
        controlErrorResponse(
          frame.id,
          frame.id,
          this.#options.brokerToken,
          "unsupported_route",
          `不支援的路由：${frame.route}`,
        ),
      );
      return;
    }
    if (this.#inFlightRoutes.has(frame.route)) {
      await this.#send(
        controlErrorResponse(
          frame.id,
          frame.id,
          this.#options.brokerToken,
          "busy",
          `路由已有在途請求：${frame.route}`,
        ),
      );
      return;
    }
    const handler = this.#handlers.get(frame.route);
    if (!handler) {
      await this.#send(
        controlErrorResponse(
          frame.id,
          frame.id,
          this.#options.brokerToken,
          "unsupported_route",
          `路由尚未實作：${frame.route}`,
        ),
      );
      return;
    }
    this.#inFlightRoutes.add(frame.route);
    try {
      const payload = await handler(frame.payload);
      await this.#send(controlResponse(frame.id, frame.id, payload, this.#options.brokerToken));
    } catch (error) {
      if (isStorageFailure(error)) {
        // 控制面路由與客戶端入口集中攔截：儲存失效一律走致命路徑，
        // 不要被包成 internal 後讓殼以為可以重試。
        await this.#options.onStorageFailure?.(error instanceof Error ? error.message : "儲存失效");
        await this.#send(
          controlErrorResponse(
            frame.id,
            frame.id,
            this.#options.brokerToken,
            "unavailable",
            "儲存已停止寫入。",
            false,
          ),
        );
        this.#inFlightRoutes.delete(frame.route);
        return;
      }
      const code = error instanceof ControlError ? error.code : "internal";
      const message = error instanceof Error ? error.message : "控制面發生未預期的錯誤";
      await this.#send(
        controlErrorResponse(frame.id, frame.id, this.#options.brokerToken, code, message),
      );
    } finally {
      this.#inFlightRoutes.delete(frame.route);
    }
  }

  #close(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeReason = reason;
    this.#reader?.stop();
    for (const queue of this.#brokerQueues.values()) {
      for (const pending of queue) {
        this.#cleanupBroker(pending);
        pending.reject(new ControlError("unavailable", "控制通道已關閉"));
      }
    }
    this.#brokerQueues.clear();
    this.#handshake?.reject(new ControlError("unavailable", "控制通道已關閉"));
    this.#handshake = null;
    this.#options.onClose?.(reason);
  }
}
