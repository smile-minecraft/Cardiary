/**
 * 模型請求邊界的憑證清洗。
 *
 * 供應商（或它前面的代理）可能把這次請求的 Authorization 標頭或金鑰原文
 * 放進錯誤回應。Pi 的引擎會把模型錯誤原文寫進對話資料夾的
 * `state/engine.sqlite`（`entries.record.errorMessage` 與
 * `submissions.record.detail`），原文一旦落地就會跟著備份與同步走。
 *
 * 所以在請求邊界、交回 pi-ai 之前就把金鑰換成固定文字：回應 body、
 * 錯誤 message、headers 與 cause 鏈都先清洗，之後才交給 pi-ai 與引擎。
 * 事件與 turn failure 的分類另外做，不依賴這裡的文字。
 */

/** 金鑰被換成的固定文字；測試用它確認清洗真的發生過。 */
export const REDACTED = "[redacted]";

const MAX_CAUSE_DEPTH = 8;

/** JSON 跳脫要處理的巢狀層數；引擎持久化前還會再 stringify 一層。 */
const MAX_JSON_ESCAPE_DEPTH = 4;

/** 把一段文字裡的金鑰換成固定文字。 */
export type Redact = (text: string) => string;

/**
 * 建立這次請求的清洗函式。
 *
 * 除了原文，也處理 JSON 跳脫（可重複跳脫）、URL 編碼（`encodeURIComponent`、
 * `encodeURI`、表單的 `+`）後的形式；比對不分大小寫，所以編碼的十六進位
 * 大小寫都算在內。樣式依長度由長到短排序，讓長的跳脫形式優先被換掉。
 */
export function secretRedactor(secret: string): Redact {
  const needles = secretNeedles(secret);
  const pattern = needlePattern(needles);
  return (text) => (text.length === 0 ? text : text.replace(pattern, REDACTED));
}

/**
 * 所有要替換的樣式。
 *
 * JSON 跳脫可能出現多層：供應平台回傳的錯誤 body 會被引擎再 `JSON.stringify`
 * 一次放進 `record`，原本的 `\"` 會變成 `\\\"`。巢狀層數固定在
 * `MAX_JSON_ESCAPE_DEPTH`；沒有出現在更深的 JSON 裡時，這些樣式只會多幾個
 * 不會命中的比對項。
 */
function secretNeedles(secret: string): string[] {
  if (secret.length === 0) {
    // 空金鑰沒有任何可替換的形式；留著空字串會變成每個位置都命中的規則。
    return [];
  }
  const needles = new Set<string>([secret]);
  for (const encoded of [encodeURIComponent(secret), encodeURI(secret), formEncode(secret)]) {
    if (encoded.length > 0) {
      needles.add(encoded);
    }
  }
  let escaped = secret;
  for (let depth = 0; depth < MAX_JSON_ESCAPE_DEPTH; depth++) {
    escaped = jsonEscape(escaped);
    if (escaped.length === 0) {
      break;
    }
    needles.add(escaped);
  }
  return [...needles].sort((a, b) => b.length - a.length);
}

function needlePattern(needles: readonly string[]): RegExp {
  if (needles.length === 0) {
    // 空規則（金鑰是空字串）不應該比對任何東西。
    return /$.^/;
  }
  return new RegExp(needles.map(escapeRegExp).join("|"), "gi");
}

/**
 * 建立跨 chunk 邊界的清洗串流。
 *
 * 200 的 `text/event-stream` 也要在交給 pi-ai 之前清洗；錯誤事件可能回顯
 * 這次請求的金鑰。串流不能整段等完才檢查，所以保留 `最長樣式長度 - 1`
 * 個字元在緩衝區，確定沒有超過這個邊界的樣式橫跨兩個 chunk 才往外送。
 * 千萬不可以在樣式比對上省掉這段：供應商會分小包送 error 事件。
 */
export function redactingTransformStream(secret: string): TransformStream<string, string> {
  const needles = secretNeedles(secret);
  const maxNeedleLength = needles.length > 0 ? (needles[0]?.length ?? 0) : 0;
  const pattern = needlePattern(needles);
  let buffer = "";
  const drain = (final: boolean): string => {
    if (buffer.length === 0) {
      return "";
    }
    const safeEnd = final ? buffer.length : Math.max(0, buffer.length - (maxNeedleLength - 1));
    let emitted = "";
    let last = 0;
    pattern.lastIndex = 0;
    let match = pattern.exec(buffer);
    while (match !== null) {
      if (!final && match.index >= safeEnd) {
        break;
      }
      emitted += buffer.slice(last, match.index) + REDACTED;
      last = match.index + match[0].length;
      match = pattern.exec(buffer);
    }
    const emitEnd = Math.max(last, safeEnd);
    emitted += buffer.slice(last, emitEnd);
    buffer = buffer.slice(emitEnd);
    return emitted;
  };
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      const emitted = drain(false);
      if (emitted.length > 0) {
        controller.enqueue(emitted);
      }
    },
    flush(controller) {
      const emitted = drain(true);
      if (emitted.length > 0) {
        controller.enqueue(emitted);
      }
    },
  });
}

/**
 * 清洗非文字 body 的位元組。
 *
 * 非文字 `content-type` 的成功回應也可能夾帶錯誤原文：供應商或它前面的代理
 * 換個 `content-type` 就繞過上面的文字串流，pi-ai 卻仍把 body 當串流解析，
 * 錯誤原文照樣進得了 `engine.sqlite`。所以整段緩衝後先試 UTF-8 解碼：解得開
 * 就照文字清洗（合法 UTF-8 解碼再編碼是無損的）；解不開（真正的二進位）改
 * 用位元組比對，只換掉逐位元組相同的位置，其餘 bytes 原樣保留。位元組路徑
 * 的大小寫折疊只做 ASCII；非 ASCII 的折疊留在文字路徑。
 */
export function redactOpaqueBody(
  bytes: Uint8Array,
  secret: string,
): { readonly body: Uint8Array; readonly changed: boolean } {
  if (secret.length === 0 || bytes.length === 0) {
    return { body: bytes, changed: false };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const redacted = secretRedactor(secret)(text);
    return redacted === text
      ? { body: bytes, changed: false }
      : { body: new TextEncoder().encode(redacted), changed: true };
  } catch {
    return redactBytes(bytes, secret);
  }
}

const REDACTED_BYTES = new TextEncoder().encode(REDACTED);

/** 位元組層的替換；樣式依長度由長到短，同一個位置先比對最長的樣式。 */
function redactBytes(
  bytes: Uint8Array,
  secret: string,
): { readonly body: Uint8Array; readonly changed: boolean } {
  const encoder = new TextEncoder();
  const needles = secretNeedles(secret).map((needle) => encoder.encode(needle));
  const parts: Uint8Array[] = [];
  let cursor = 0;
  let index = 0;
  while (index < bytes.length) {
    const needle = needles.find((candidate) => bytesMatchAt(bytes, index, candidate));
    if (needle === undefined) {
      index += 1;
      continue;
    }
    if (index > cursor) {
      parts.push(bytes.subarray(cursor, index));
    }
    parts.push(REDACTED_BYTES);
    index += needle.length;
    cursor = index;
  }
  if (parts.length === 0) {
    return { body: bytes, changed: false };
  }
  parts.push(bytes.subarray(cursor));
  return { body: concatBytes(parts), changed: true };
}

/** 位元組比對：ASCII 字母不分大小寫，其他位元組要完全一致。 */
function bytesMatchAt(bytes: Uint8Array, offset: number, needle: Uint8Array): boolean {
  if (offset + needle.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < needle.length; index++) {
    const left = bytes[offset + index] ?? 0;
    const right = needle[index] ?? 0;
    if (left === right || asciiLower(left) === asciiLower(right)) {
      continue;
    }
    return false;
  }
  return true;
}

function asciiLower(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * 清洗錯誤物件。
 *
 * 直接改寫同一個錯誤的 message、stack、headers、body 與 cause 鏈，保留
 * 型別與 SDK 附加的欄位（例如 status）；之後 pi-ai 讀到的訊息與
 * `normalizeProviderError` 串起來的 cause 都已經不含金鑰。
 */
export function redactError(error: unknown, redact: Redact): unknown {
  return redactErrorValue(error, redact, 0);
}

function redactErrorValue(value: unknown, redact: Redact, depth: number): unknown {
  if (typeof value === "string") {
    return redact(value);
  }
  if (!(value instanceof Error) || depth > MAX_CAUSE_DEPTH) {
    return value;
  }
  try {
    value.message = redact(value.message);
    if (typeof value.stack === "string") {
      value.stack = redact(value.stack);
    }
    const record = value as Error & {
      cause?: unknown;
      body?: unknown;
      error?: unknown;
      headers?: unknown;
    };
    if (record.cause !== undefined) {
      record.cause = redactErrorValue(record.cause, redact, depth + 1);
    }
    if (typeof record.body === "string") {
      record.body = redact(record.body);
    }
    record.error = redactNested(record.error, redact);
    record.headers = redactHeadersValue(record.headers, redact);
    return value;
  } catch {
    // 唯讀或凍結的錯誤：換成一個同型別名稱、只帶清洗後訊息的新錯誤。
    const replacement = new Error(redact(value.message));
    replacement.name = value.name;
    return replacement;
  }
}

/** 回應 header 的清洗；沒有金鑰時回傳 `null`，呼叫端可以保留原物件。 */
export function redactHeaders(headers: Headers, redact: Redact): Headers | null {
  let changed = false;
  const sanitized = new Headers();
  for (const [name, value] of headers) {
    const next = redact(value);
    if (next !== value) {
      changed = true;
    }
    sanitized.set(name, next);
  }
  return changed ? sanitized : null;
}

function redactHeadersValue(value: unknown, redact: Redact): unknown {
  if (value instanceof Headers) {
    const sanitized = redactHeaders(value, redact);
    return sanitized ?? value;
  }
  return redactNested(value, redact);
}

/** 只走訪純物件與陣列的字串值；其他型別原樣保留，避免動到 SDK 物件。 */
function redactNested(value: unknown, redact: Redact, depth = 0): unknown {
  if (typeof value === "string") {
    return redact(value);
  }
  if (depth > MAX_CAUSE_DEPTH || typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactNested(entry, redact, depth + 1));
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = redactNested(entry, redact, depth + 1);
  }
  return result;
}

function formEncode(value: string): string {
  const prefix = "value=";
  return new URLSearchParams({ value }).toString().slice(prefix.length);
}

function jsonEscape(value: string): string {
  const encoded = JSON.stringify(value);
  return encoded.slice(1, -1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
