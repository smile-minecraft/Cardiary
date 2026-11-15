/**
 * 壓縮的範圍、摘要提示與血緣標記。
 *
 * 壓縮只處理「保留範圍之前」的逐字稿：最近的幾輪、進行中的步驟與
 * 未完成的工具呼叫留在新第 7 層的開頭，其餘摘要成一張短期記憶卡。
 * 這些函式是純函式，主機負責把結果落地。
 */

/** 摘要呼叫需要的輸出上限；實測 1,024 會失敗、4,096 才完成。 */
export const SUMMARY_MAX_OUTPUT_TOKENS = 4096;

/** 預設保留的最近對話量。 */
export const DEFAULT_KEEP_RECENT_TOKENS = 8000;

/** 摘要卡最多列出幾條相關路徑。 */
export const MAX_RELATED_PATHS = 20;

/** 逐字稿中的一則訊息；工具呼叫的狀態由主機補上。 */
export interface CompactionMessage {
  readonly cursor: string;
  readonly role: "user" | "assistant" | "tool" | "system";
  readonly text: string;
  readonly tokenEstimate: number;
  /** 這則訊息對應的工具呼叫；`completed` 為 false 表示還沒結束。 */
  readonly tool?: {
    readonly callId: string;
    readonly name: string;
    readonly completed: boolean;
  };
}

/** 壓縮範圍。 */
export interface CompactionPlan {
  /** 第一則保留的訊息；被摘要的是它前面的所有訊息。 */
  readonly keepFromCursor: string;
  readonly dropped: readonly CompactionMessage[];
  readonly kept: readonly CompactionMessage[];
  readonly droppedTokens: number;
}

/**
 * 決定保留範圍。
 *
 * 從尾端往前累積到 `keepRecentTokens`，再把起點往前延伸到尚未完成的
 * 工具呼叫之前；工具呼叫與它的結果不能被切開，否則壓縮後代理會看到
 * 一個沒有結果的呼叫。沒有東西可丟時回 `null`。
 */
export function planCompaction(
  messages: readonly CompactionMessage[],
  options: { readonly keepRecentTokens?: number } = {},
): CompactionPlan | null {
  if (messages.length === 0) return null;
  const keepRecentTokens = Math.max(0, options.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS);
  let start = messages.length - 1;
  let accumulated = Math.max(0, messages[start]?.tokenEstimate ?? 0);
  while (start > 0 && accumulated < keepRecentTokens) {
    start -= 1;
    accumulated += Math.max(0, messages[start]?.tokenEstimate ?? 0);
  }
  // 未完成的工具呼叫之前一定保留；它可能就在保留範圍的前一則。
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (message.tool !== undefined && !message.tool.completed && index < start) {
      start = index;
    }
  }
  if (start <= 0) {
    // 全部都要保留，沒有可摘要的內容；不要產生空摘要卡。
    return null;
  }
  const dropped = messages.slice(0, start);
  const kept = messages.slice(start);
  const firstKept = kept[0];
  if (firstKept === undefined) return null;
  return {
    keepFromCursor: firstKept.cursor,
    dropped,
    kept,
    droppedTokens: dropped.reduce((sum, message) => sum + Math.max(0, message.tokenEstimate), 0),
  };
}

/**
 * 從工具呼叫與訊息文字抽出檔案路徑。
 *
 * 工具參數裡的 `path`、`file_path`、`filePath` 是固定格式；主機的公開
 * 介面沒有工具輸入的結構，所以直接掃文字。重複的只留第一次出現的
 * 位置，最多 `MAX_RELATED_PATHS` 條，最新的一條在最後。
 */
export function extractRelatedPaths(texts: readonly string[]): string[] {
  const pattern = /"(?:path|file_path|filePath)"\s*:\s*"([^"\n]+)"/g;
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const text of texts) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      const value = match[1]?.trim() ?? "";
      if (value.length > 0 && !seen.has(value)) {
        seen.add(value);
        paths.push(value);
      }
      match = pattern.exec(text);
    }
  }
  const limited = paths.slice(-MAX_RELATED_PATHS);
  return limited;
}

/** 摘要卡的血緣標記；寫在內文尾端，重跑時靠它認出同一個範圍。 */
export interface SummaryFooter {
  readonly conversationId: string;
  /** 被摘要的第一則訊息；沒有訊息時是空字串。 */
  readonly fromCursor: string;
  /** 被摘要的最後一則訊息。 */
  readonly toCursor: string;
  /**
   * 保留範圍的起點（第一則保留的訊息）。
   *
   * 寫進標記後，中斷後重做就不必重新挑選保留範圍；沒有這個欄位的舊標記
   * 仍可以讀回前三個欄位，但認不出保留範圍。
   */
  readonly keepFromCursor?: string;
}

/** 產生摘要卡內文尾端的血緣標記。 */
export function encodeSummaryFooter(footer: SummaryFooter): string {
  return `<!-- cardiary:compaction ${JSON.stringify({
    conversationId: footer.conversationId,
    fromCursor: footer.fromCursor,
    toCursor: footer.toCursor,
    ...(footer.keepFromCursor === undefined ? {} : { keepFromCursor: footer.keepFromCursor }),
  })} -->`;
}

/** 讀回摘要卡的血緣標記；沒有或壞掉時回 `null`。 */
export function parseSummaryFooter(body: string): SummaryFooter | null {
  const match = /<!-- cardiary:compaction (\{[^]*?\}) -->/.exec(body);
  if (match === null || match[1] === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record["conversationId"] !== "string" ||
    typeof record["fromCursor"] !== "string" ||
    typeof record["toCursor"] !== "string"
  ) {
    return null;
  }
  const keepFromCursor = record["keepFromCursor"];
  if (keepFromCursor !== undefined && typeof keepFromCursor !== "string") {
    return null;
  }
  return {
    conversationId: record["conversationId"],
    fromCursor: record["fromCursor"],
    toCursor: record["toCursor"],
    ...(keepFromCursor === undefined ? {} : { keepFromCursor }),
  };
}

/** 摘要卡的標題；用壓縮時間，方便在卡片庫裡分辨先後。 */
export function summaryTitle(compactedAt: string): string {
  return `短期記憶 ${compactedAt}`;
}

/** 摘要用的提示；`transcript` 是要被摘要的對話。 */
export interface SummaryPromptInput {
  readonly transcript: string;
  readonly relatedPaths: readonly string[];
  readonly instructions?: string;
}

/** 組出摘要模型的提示；輸出上限由呼叫端設為 `SUMMARY_MAX_OUTPUT_TOKENS`。 */
export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const lines: string[] = [
    "你是 Cardiary 的對話壓縮器。把下面「要被摘要的對話」濃縮成一段可供同一個代理接著工作的短期記憶。",
    "",
    "必須留住：",
    "- 正在進行的步驟與目前的進度。",
    "- 還沒完成的工具呼叫與它要達成的目的。",
    "- 已經確定的決定、約定與使用者偏好。",
    "- 還沒解決的問題與下一步。",
    "- 相關的檔案路徑。",
    "不要發明對話裡沒有出現的內容；不確定的事寫成不確定。",
  ];
  if (input.relatedPaths.length > 0) {
    lines.push("", "相關路徑：", ...input.relatedPaths.map((path) => `- ${path}`));
  }
  if (input.instructions !== undefined && input.instructions.trim().length > 0) {
    lines.push("", "這次壓縮的額外指示：", input.instructions.trim());
  }
  lines.push("", "要被摘要的對話：", input.transcript);
  return lines.join("\n");
}

/** 把要被摘要的訊息排成純文字逐字稿；角色標籤固定，方便模型分辨。 */
export function renderTranscript(messages: readonly CompactionMessage[]): string {
  const roleLabel: Record<CompactionMessage["role"], string> = {
    user: "使用者",
    assistant: "助理",
    tool: "工具結果",
    system: "系統",
  };
  return messages
    .map((message) => {
      const tool = message.tool === undefined ? "" : `（工具 ${message.tool.name}）`;
      return `${roleLabel[message.role]}${tool}：\n${message.text}`;
    })
    .join("\n\n");
}
