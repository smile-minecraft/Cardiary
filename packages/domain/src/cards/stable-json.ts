/**
 * 決定性 JSON 序列化：物件鍵依深度排序，陣列保留原順序。
 *
 * 用於 revision 的計算，不打算成為通用 JSON 庫；數字沿用 JSON 的表示，
 * 呼叫端只放可重現的值（字串、布林、數字、null、陣列、物件）。
 */
export function stableStringify(value: unknown): string {
  return write(value);
}

function write(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("revision 不能包含非有限數字");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((item) => write(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const body = entries.map(([key, item]) => `${JSON.stringify(key)}:${write(item)}`).join(",");
    return `{${body}}`;
  }
  throw new Error(`revision 不能包含這種型別：${typeof value}`);
}
