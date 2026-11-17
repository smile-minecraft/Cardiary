/**
 * 供應商協定（OpenCode ACP、Claude Code stream-json）與測試用假代理
 * 的正規化。只放純函式；沒有人認識主機、沒有檔案系統、沒有計時器。
 */
import type { ExternalAgentJson, NormalizedAgentEvent } from "./types.js";

export interface AcpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly id: number | string;
  readonly params?: ExternalAgentJson;
}
export interface AcpJsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: ExternalAgentJson;
}
export interface AcpJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result?: ExternalAgentJson;
  readonly error?: { readonly code: number; readonly message: string };
}
export type AcpFrame =
  | { readonly kind: "request"; readonly frame: AcpJsonRpcRequest }
  | { readonly kind: "notification"; readonly frame: AcpJsonRpcNotification }
  | { readonly kind: "response"; readonly frame: AcpJsonRpcResponse }
  | { readonly kind: "ignored" };

function asObject(value: unknown): ExternalAgentJson | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ExternalAgentJson;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asId(value: unknown): number | string | null {
  const num = asNumber(value);
  if (num !== null) return num;
  return asString(value);
}

/** 把一行 OpenCode ACP 輸出分類成 request / notification / response。 */
export function classifyAcpLine(line: string): AcpFrame {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "ignored" };
  }
  const obj = asObject(raw);
  if (!obj || obj.jsonrpc !== "2.0") return { kind: "ignored" };
  const method = asString(obj.method);
  const id = asId(obj.id);
  if (method !== null && id !== null) {
    return { kind: "request", frame: obj as unknown as AcpJsonRpcRequest };
  }
  if (method !== null) {
    return { kind: "notification", frame: obj as unknown as AcpJsonRpcNotification };
  }
  if (id !== null) {
    return { kind: "response", frame: obj as unknown as AcpJsonRpcResponse };
  }
  return { kind: "ignored" };
}

function normalizeAcpPermission(frame: AcpJsonRpcRequest): NormalizedAgentEvent | null {
  const params = asObject(frame.params) ?? {};
  const toolCall = asObject(params.toolCall) ?? {};
  const toolName =
    asString(toolCall.toolName) ??
    asString(toolCall.name) ??
    asString(toolCall.title) ??
    "unknown-tool";
  const input =
    asObject(toolCall.rawInput) ?? asObject(toolCall.input) ?? (toolCall as ExternalAgentJson);
  const description = asString(toolCall.title) ?? asString(toolCall.description) ?? undefined;
  const requestKey = `opencode:${String(frame.id)}`;
  // OpenCode 2.2.7 的 options[].optionId 是 once/always/reject，kind 才是 allow_once 等。
  // 一定要回伺服器實際给的 optionId；用 kind 字串會被當成拒絕，整回合取消。
  const options = Array.isArray(params.options) ? params.options : [];
  const findOptionId = (wantedKind: string): string | undefined => {
    for (const option of options) {
      const obj = asObject(option);
      if (!obj || asString(obj.kind) !== wantedKind) continue;
      return asString(obj.optionId) ?? undefined;
    }
    return undefined;
  };
  const allowOptionId = findOptionId("allow_once");
  const denyOptionId = findOptionId("reject_once");
  return {
    kind: "permission",
    toolName,
    input,
    ...(description ? { description } : {}),
    requestKey,
    replyToken: frame.id,
    ...(allowOptionId ? { allowOptionId } : {}),
    ...(denyOptionId ? { denyOptionId } : {}),
  };
}

function normalizeAcpPlan(update: ExternalAgentJson): NormalizedAgentEvent | null {
  const entries = Array.isArray(update.entries) ? update.entries : null;
  if (!entries || entries.length === 0) return null;
  let completed = 0;
  let activeLabel = "執行計畫";
  for (const entry of entries) {
    const obj = asObject(entry);
    if (!obj) continue;
    const status = asString(obj.status);
    if (status === "completed") completed += 1;
    else if (status === "in_progress") {
      const content = asString(obj.content) ?? asString(obj.title);
      if (content) activeLabel = content;
    }
  }
  return { kind: "progress", completed, total: entries.length, label: activeLabel };
}

/** 只正規化通知與 server→client 請求；response 由橋接層自己配對。 */
export function normalizeAcpFrame(frame: AcpFrame): NormalizedAgentEvent[] {
  const out: NormalizedAgentEvent[] = [];
  if (frame.kind === "request") {
    if (frame.frame.method === "session/request_permission") {
      const event = normalizeAcpPermission(frame.frame);
      if (event) out.push(event);
    }
    return out;
  }
  if (frame.kind !== "notification") return out;
  if (frame.frame.method !== "session/update") return out;
  const params = asObject(frame.frame.params) ?? {};
  const update = asObject(params.update) ?? asObject(params.event) ?? asObject(params.notification);
  if (!update) return out;
  const sessionUpdate = asString(update.sessionUpdate) ?? asString(update.type);
  if (sessionUpdate === "plan") {
    const event = normalizeAcpPlan(update);
    if (event) out.push(event);
  } else if (sessionUpdate === "agent_message_chunk") {
    const content = asObject(update.content);
    const text = content ? asString(content.text) : asString(update.text);
    if (text) out.push({ kind: "output", text });
  } else if (sessionUpdate === "tool_call") {
    const title = asString(update.title);
    if (title) out.push({ kind: "output", text: title });
  }
  return out;
}

export function normalizeAcpLine(line: string): NormalizedAgentEvent[] {
  return normalizeAcpFrame(classifyAcpLine(line));
}

/** Claude Code `stream-json` 的一行。 */
export function normalizeStreamJsonLine(line: string): NormalizedAgentEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  const obj = asObject(raw);
  if (!obj) return [];
  const type = asString(obj.type);
  if (type === "control_request") {
    return normalizeClaudePermissionRequest(obj);
  }
  if (type === "assistant") {
    const message = asObject(obj.message);
    const content = message && Array.isArray(message.content) ? message.content : [];
    const out: NormalizedAgentEvent[] = [];
    for (const block of content) {
      const b = asObject(block);
      if (!b) continue;
      if (b.type === "text") {
        const text = asString(b.text);
        if (text) out.push({ kind: "output", text });
      } else if (b.type === "tool_use") {
        const name = asString(b.name);
        out.push({ kind: "output", text: name ? `執行 ${name}` : "執行工具" });
      }
    }
    return out;
  }
  if (type === "result") {
    const subtype = asString(obj.subtype);
    const result = asString(obj.result) ?? "";
    if (subtype === "success") {
      return [{ kind: "completed", message: result ? `完成：${truncate(result, 80)}` : "完成" }];
    }
    return [
      {
        kind: "failed",
        message: result
          ? `Claude Code 結束：${subtype ?? "error"} — ${truncate(result, 80)}`
          : `Claude Code 結束：${subtype ?? "error"}`,
      },
    ];
  }
  return [];
}

function normalizeClaudePermissionRequest(obj: ExternalAgentJson): NormalizedAgentEvent[] {
  const request = asObject(obj.request);
  const requestId = asString(obj.request_id) ?? asString(request?.request_id);
  if (!request || !requestId) return [];
  const subtype = asString(request.subtype);
  if (subtype !== "can_use_tool") return [];
  const toolName = asString(request.tool_name) ?? "unknown-tool";
  const input = asObject(request.input) ?? {};
  const description = asString(request.description) ?? undefined;
  const toolUseId = asString(request.tool_use_id);
  const requestKey = `claude:${toolUseId ?? requestId}`;
  return [
    {
      kind: "permission",
      toolName,
      input,
      ...(description ? { description } : {}),
      requestKey,
      replyToken: requestId,
    },
  ];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** 測試用假代理：直接輸出正規化後的 NDJSON。 */
export function normalizeFakeLine(line: string): NormalizedAgentEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  const obj = asObject(raw);
  if (!obj) return [];
  const type = asString(obj.type);
  switch (type) {
    case "output": {
      const text = asString(obj.text);
      return text ? [{ kind: "output", text }] : [];
    }
    case "progress": {
      const completed = asNumber(obj.completed);
      const total = asNumber(obj.total);
      const label = asString(obj.label) ?? "步驟";
      if (completed === null || total === null) return [];
      return [{ kind: "progress", completed, total, label }];
    }
    case "permission": {
      const toolName = asString(obj.tool);
      const requestId = asString(obj.requestId);
      if (!toolName || !requestId) return [];
      const input = asObject(obj.input) ?? {};
      const description = asString(obj.description) ?? undefined;
      return [
        {
          kind: "permission",
          toolName,
          input,
          ...(description ? { description } : {}),
          requestKey: `fake:${requestId}`,
          replyToken: requestId,
        },
      ];
    }
    case "completed": {
      const message = asString(obj.message) ?? "完成";
      return [{ kind: "completed", message }];
    }
    case "failed": {
      const message = asString(obj.message) ?? "失敗";
      return [{ kind: "failed", message }];
    }
    default:
      return [];
  }
}

/** 依代理種類選擇正規化器；`fake` 只給自動化測試用。 */
export function normalizeAgentLine(
  kind: "opencode" | "claude-code" | "fake",
  line: string,
): NormalizedAgentEvent[] {
  switch (kind) {
    case "opencode":
      return normalizeAcpLine(line);
    case "claude-code":
      return normalizeStreamJsonLine(line);
    case "fake":
      return normalizeFakeLine(line);
  }
}
