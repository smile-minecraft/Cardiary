import type { JSONObject } from "@cardiary/protocol";

import { ControlError } from "../errors.js";

export const CONTROL_PROTOCOL = 1;

/** 殼 → 服務，精確字串比對的白名單。 */
export const CONTROL_ROUTES = new Set([
  "control.health",
  "control.pause",
  "control.resume",
  "control.shutdown",
]);

/** 服務 → 殼的系統能力代理。 */
export const BROKER_ROUTES = new Set([
  "broker.folder.get",
  "broker.keychain.get",
  "broker.shell-state.get",
  "broker.recognition.ocr",
  "broker.recognition.transcribe",
]);

/** 服務 → 殼的通知。 */
export const NOTIFY_ROUTES = new Set(["notify.fatal", "notify.maintenance"]);

export interface ControlAuth {
  readonly token: string;
}

export interface ControlRequest {
  readonly v: 1;
  readonly kind: "request";
  readonly id: string;
  readonly route: string;
  readonly auth: ControlAuth;
  readonly payload: JSONObject;
}

export interface ControlResponseBody {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ControlResponse {
  readonly v: 1;
  readonly kind: "response";
  readonly id: string;
  readonly replyTo: string;
  readonly auth: ControlAuth;
  readonly ok: boolean;
  readonly payload?: JSONObject;
  readonly error?: ControlResponseBody;
}

export interface HelloAck {
  readonly v: 1;
  readonly kind: "hello-ack";
  readonly role: "shell";
  readonly auth: ControlAuth;
}

export type InboundFrame = ControlRequest | ControlResponse | HelloAck;

export interface HelloFrame {
  readonly v: 1;
  readonly kind: "hello";
  readonly role: "host-service";
  readonly pid: number;
  readonly auth: ControlAuth;
}

export interface NotificationFrame {
  readonly v: 1;
  readonly kind: "notification";
  readonly route: string;
  readonly auth: ControlAuth;
  readonly payload: JSONObject;
}

export interface BrokerRequestFrame {
  readonly v: 1;
  readonly kind: "request";
  readonly id: string;
  readonly route: string;
  readonly auth: ControlAuth;
  readonly payload: JSONObject;
}

export type OutboundFrame = HelloFrame | ControlResponse | NotificationFrame | BrokerRequestFrame;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAuth(value: unknown): ControlAuth {
  // 缺 Token 不是「壞 frame」而是認證失敗：交給通道回 unauthorized 並關閉，
  // 不要用 invalid_message 混淆。
  if (!isObject(value) || typeof value.token !== "string") {
    return { token: "" };
  }
  return { token: value.token };
}

function parsePayload(value: unknown): JSONObject {
  if (value === undefined) return {};
  if (!isObject(value)) throw new ControlError("invalid_message", "payload 必須是物件");
  return value as JSONObject;
}

/**
 * 解析殼送來的 frame。
 *
 * 服務只接受三種：控制請求、broker 回應、`hello-ack`。其他 kind、缺欄位或
 * 型別不對一律 `invalid_message`，呼叫端關閉通道。
 */
export function parseInbound(raw: string): InboundFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ControlError("invalid_message", "frame 不是合法 JSON");
  }
  if (!isObject(parsed)) throw new ControlError("invalid_message", "frame 必須是 JSON 物件");
  if (parsed.v !== CONTROL_PROTOCOL) throw new ControlError("invalid_message", "控制面版本不符");
  switch (parsed.kind) {
    case "request": {
      if (typeof parsed.id !== "string" || parsed.id.length === 0) {
        throw new ControlError("invalid_message", "請求缺少 id");
      }
      if (typeof parsed.route !== "string" || parsed.route.length === 0) {
        throw new ControlError("invalid_message", "請求缺少 route");
      }
      return {
        v: 1,
        kind: "request",
        id: parsed.id,
        route: parsed.route,
        auth: parseAuth(parsed.auth),
        payload: parsePayload(parsed.payload),
      };
    }
    case "response": {
      if (typeof parsed.id !== "string" || typeof parsed.replyTo !== "string") {
        throw new ControlError("invalid_message", "回應缺少 id 或 replyTo");
      }
      if (typeof parsed.ok !== "boolean") {
        throw new ControlError("invalid_message", "回應缺少 ok");
      }
      const error = parsed.error;
      if (error !== undefined) {
        if (
          !isObject(error) ||
          typeof error.code !== "string" ||
          typeof error.message !== "string" ||
          typeof error.retryable !== "boolean"
        ) {
          throw new ControlError("invalid_message", "回應的 error 形狀不正確");
        }
      }
      return {
        v: 1,
        kind: "response",
        id: parsed.id,
        replyTo: parsed.replyTo,
        auth: parseAuth(parsed.auth),
        ok: parsed.ok,
        ...(parsed.payload === undefined ? {} : { payload: parsePayload(parsed.payload) }),
        ...(error === undefined
          ? {}
          : {
              error: {
                code: String((error as Record<string, unknown>).code),
                message: String((error as Record<string, unknown>).message),
                retryable: Boolean((error as Record<string, unknown>).retryable),
              },
            }),
      };
    }
    case "hello-ack":
      if (parsed.role !== "shell") {
        throw new ControlError("invalid_message", "hello-ack 的 role 必須是 shell");
      }
      return { v: 1, kind: "hello-ack", role: "shell", auth: parseAuth(parsed.auth) };
    default:
      throw new ControlError("invalid_message", "不接受的 frame kind");
  }
}

/** 控制面錯誤回應；成功時不帶 payload 的情況由呼叫端決定。 */
export function controlErrorResponse(
  id: string,
  replyTo: string,
  token: string,
  code: string,
  message: string,
  retryable = false,
): ControlResponse {
  return {
    v: CONTROL_PROTOCOL,
    kind: "response",
    id,
    replyTo,
    auth: { token },
    ok: false,
    error: { code, message, retryable },
  };
}

export function controlResponse(
  id: string,
  replyTo: string,
  payload: JSONObject,
  token: string,
): ControlResponse {
  return {
    v: CONTROL_PROTOCOL,
    kind: "response",
    id,
    replyTo,
    auth: { token },
    ok: true,
    payload,
  };
}
