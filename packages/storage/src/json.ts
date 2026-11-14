import { createHash } from "node:crypto";

/** 可以寫進事件、審批與去重回應的 JSON 值。 */
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** 正規化 JSON 的結果；同一個值不論鍵的順序都得到同一個字串。 */
export function canonicalJson(value: JsonValue): string {
  return canonicalize(value);
}

function canonicalize(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonicalJson 不接受 NaN 或無限大");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  entries.sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

/** 計算 SHA-256，輸出 64 個小寫十六進位字元。 */
export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 審批鍵的分隔字元；使用 0x1F 避免與一般文字衝突。 */
const KEY_SEPARATOR = String.fromCharCode(0x1f);

export interface ToolApprovalKeyInput {
  readonly conversationId: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly input: JsonValue;
}

/** 計算工具審批的 `approval_key`（`storage` 第 3.6 節）。 */
export function toolApprovalKey(input: ToolApprovalKeyInput): string {
  const material = [
    "cardiary.approval.v1",
    "tool",
    input.conversationId,
    input.turnId,
    input.toolName,
    canonicalJson(input.input),
  ].join(KEY_SEPARATOR);
  return sha256(material);
}

export interface TaskApprovalKeyInput {
  readonly taskKind: string;
  readonly subjectId: string;
  readonly payload: JsonValue;
}

/** 計算任務審批的 `approval_key`；M0 不建立，鍵規則先定好給 M1。 */
export function taskApprovalKey(input: TaskApprovalKeyInput): string {
  const material = [
    "cardiary.approval.v1",
    "task",
    input.taskKind,
    input.subjectId,
    canonicalJson(input.payload),
  ].join(KEY_SEPARATOR);
  return sha256(material);
}
