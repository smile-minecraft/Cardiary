import type { FetchFunction } from "@earendil-works/pi-ai";

import {
  redactError,
  redactHeaders,
  redactingTransformStream,
  secretRedactor,
  type Redact,
} from "./redaction.js";

/**
 * 供應商錯誤回應的清洗與等待時間。
 *
 * 這裡包在 pi-ai 使用的 `fetch` 外面：請求一回來就先處理，pi-ai 與引擎
 * 只會拿到清洗後的回應。錯誤回應（非 2xx）整段 body 都換掉；200 的
 * `text/event-stream` 也要清洗，因為 OpenAI 相容端點可以先回 200，中途
 * 才在 error 事件裡回顯這次請求的金鑰。200 的串流用跨 chunk 邊界的
 * 替換串流包起來，其餘欄位不動。
 *
 * 供應商給的 `Retry-After` 也在這裡轉成毫秒，放進錯誤 body 的固定欄位。
 * 引擎會把錯誤原文保存到 `state/engine.sqlite`，之後的分類只拿得到文字，
 * 所以等待時間必須跟著文字走，不能在事件層另外補。
 */

/** 錯誤 body 裡放等待時間的欄位名稱；分類器從同一個字串取回。 */
const RETRY_AFTER_FIELD = "cardiary_retry_after_ms";

const RETRY_AFTER_PATTERN = new RegExp(`${RETRY_AFTER_FIELD}["']?\\s*[:=]\\s*(\\d+)`);

/** 這些狀態的回應不能帶 body；重建時要保留 null。 */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/**
 * 包住這次請求的 fetch：錯誤回應先清洗再交回 pi-ai。
 *
 * `secret` 是這一則請求實際送出的金鑰；`baseFetch` 沒給時用全域的 fetch。
 */
export function redactingFetch(
  baseFetch: FetchFunction | undefined,
  secret: string,
): FetchFunction {
  const redact = secretRedactor(secret);
  return async (input, init) => {
    let response: Response;
    try {
      response = await (baseFetch ?? globalThis.fetch)(input, init);
    } catch (error) {
      throw redactError(error, redact);
    }
    if (response.ok) {
      return sanitizeOkResponse(response, redact, secret);
    }
    return sanitizeErrorResponse(response, redact);
  };
}

/**
 * 清洗成功回應。
 *
 * `content-type` 是文字形式（缺少 content-type 也視為文字）時，把 body
 * 包上跨 chunk 的替換串流；錯誤事件裡的金鑰會在 pi-ai 讀到之前就被換掉。
 * 非文字的 body 不動，只清洗 headers。換過 body 後 `content-length` 與
 * `content-encoding` 一定要拿掉：內容已經解壓縮並可能改寫過。
 */
function sanitizeOkResponse(response: Response, redact: Redact, secret: string): Response {
  const textual = isTextualContentType(response.headers.get("content-type"));
  if (response.body === null || !textual) {
    const headers = redactHeaders(response.headers, redact);
    if (headers === null) {
      return response;
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (name === "content-length" || name === "content-encoding") {
      continue;
    }
    headers.set(name, redact(value));
  }
  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(redactingTransformStream(secret))
    .pipeThrough(new TextEncoderStream());
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const TEXTUAL_MARKERS = ["json", "xml", "yaml", "event-stream", "x-ndjson", "text/"] as const;

/** 沒有 `content-type`、或看起來是文字的格式，body 都值得檢查。 */
function isTextualContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return true;
  }
  const value = contentType.toLowerCase();
  return TEXTUAL_MARKERS.some((marker) => value.includes(marker));
}

/**
 * 清洗錯誤回應的 body 與 headers，並把供應商的等待時間放進 body。
 *
 * `content-length` 與 `content-encoding` 要拿掉：body 已經解壓縮並改寫過，
 * 留著會讓讀取端用錯誤的長度或編碼解析。
 */
async function sanitizeErrorResponse(response: Response, redact: Redact): Promise<Response> {
  const body = await response.text();
  const retryAfterMs = retryAfterMsOf(response.headers);
  const text = withRetryAfter(redact(body), retryAfterMs);
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (name === "content-length" || name === "content-encoding") {
      continue;
    }
    headers.set(name, redact(value));
  }
  return new Response(nullBodyStatus(response.status) ? null : text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 從供應商錯誤原文取回等待時間；沒有這個欄位就回 `undefined`。 */
export function retryAfterMsFrom(text: string): number | undefined {
  const match = RETRY_AFTER_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function withRetryAfter(text: string, retryAfterMs: number | undefined): string {
  if (retryAfterMs === undefined) {
    return text;
  }
  const parsed = parseJsonObject(text);
  if (parsed === null) {
    return `${RETRY_AFTER_FIELD}=${retryAfterMs}\n${text}`;
  }
  // 放最前面：引擎會截斷過長的錯誤原文，欄位要落在保留範圍內。
  const marker = { [RETRY_AFTER_FIELD]: retryAfterMs };
  // OpenAI SDK 的 APIError 只留 body 的 `error` 欄位（沒有時才留整個 body），
  // 所以兩層都放，讓等待時間一定跟著錯誤文字走到分類器。
  const nested = parsed.error;
  const body =
    typeof nested === "object" && nested !== null && !Array.isArray(nested)
      ? { ...marker, ...parsed, error: { ...marker, ...(nested as Record<string, unknown>) } }
      : { ...marker, ...parsed };
  return JSON.stringify(body);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `Retry-After` 可以是秒數或 HTTP 日期；`Retry-After-Ms` 直接是毫秒。 */
function retryAfterMsOf(headers: Headers): number | undefined {
  const milliseconds = headers.get("retry-after-ms");
  if (milliseconds !== null) {
    const value = Number.parseFloat(milliseconds);
    if (Number.isFinite(value) && value >= 0) {
      return Math.round(value);
    }
  }
  const value = headers.get("retry-after");
  if (value === null) {
    return undefined;
  }
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) {
    return undefined;
  }
  return Math.max(0, date - Date.now());
}

function nullBodyStatus(status: number): boolean {
  return NULL_BODY_STATUS.has(status);
}
