import { createHash } from "node:crypto";

import type { JsonValue } from "../json.js";

/**
 * 正規化 JSON：物件鍵依 UTF-8 位元組排序、不輸出空白、字串用 JSON 跳脫、
 * 整數不加小數點、浮點數用最短往返表示；拒絕非有限數值。
 *
 * 同一份輸入不論鍵的順序都得到同一個字串，這是 `approval_key` 可重現的前提。
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("正規化 JSON 不接受非有限數值");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      return `{${Object.keys(value)
        .sort(compareUtf8)
        .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, JsonValue>)[key] as JsonValue)}`)
        .join(",")}}`;
    default:
      throw new TypeError("正規化 JSON 不接受這個型別");
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** `approval_key` 的版本常數；演算法見 storage 第 3.6 節。 */
const APPROVAL_KEY_VERSION = "cardiary.approval.v1";
const FIELD_SEPARATOR = "\u001f";

/**
 * 計算工具審批的去重鍵。
 *
 * `approval_key = SHA-256("cardiary.approval.v1" 0x1F scope 0x1F conversationId 0x1F
 * turnId 0x1F toolName 0x1F canonicalJson(input))`，輸出 64 個小寫十六進位字元。
 * 重跑時同一個工具得到同一個鍵，因此不會再問一次已回答的問題。
 */
export function computeApprovalKey(input: {
  readonly scope: "tool" | "task";
  readonly conversationId: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly payload: JsonValue;
}): string {
  const material = [
    APPROVAL_KEY_VERSION,
    input.scope,
    input.conversationId,
    input.turnId,
    input.toolName,
    canonicalJson(input.payload),
  ].join(FIELD_SEPARATOR);
  return createHash("sha256").update(material, "utf8").digest("hex");
}
