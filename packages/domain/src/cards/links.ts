/** 內文裡的 `[[目標]]` 雙向連結。 */

export interface OutgoingLink {
  /** 連結目標的原文字串；可能是卡片 id，也可能是標題。 */
  readonly target: string;
  /** 同一個目標第一次出現的順序（0 起算），列表依出現順序排列。 */
  readonly ordinal: number;
}

/**
 * 取出內文的所有 [[ ]] 目標，依出現順序、同目標只留第一次。
 *
 * 連結語法是 `[[目標]]`；目標不能包含方括號。程式碼區塊裡的連結
 * 目前也會算進去，與規格書「內文就是 Markdown，原樣保存」一致——
 * 索引只需要知道「誰連到誰」，不解析 Markdown 語意。
 */
export function extractOutgoingLinks(body: string): OutgoingLink[] {
  const seen = new Map<string, number>();
  const pattern = /\[\[([^[\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const target = (match[1] ?? "").trim();
    if (target.length === 0 || seen.has(target)) continue;
    seen.set(target, seen.size);
  }
  return [...seen.entries()].map(([target, ordinal]) => ({ target, ordinal }));
}

/** 標題比對用的正規化：NFC、trim、連續空白折疊、小寫。 */
export function normalizeLinkText(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}
