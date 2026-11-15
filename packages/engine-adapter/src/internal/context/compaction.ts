/**
 * 把主機算好的摘要寫成引擎的壓縮 entry。
 *
 * 引擎的 `pi.compaction` entry「帶著摘要，並指向第一則保留的 entry」；
 * 被摘要的舊 entry 留在儲存裡，只是模型看不到。範圍由主機決定，轉接層
 * 不自行挑選——保留哪些步驟與最近幾輪是產品行為，不是引擎行為。
 */

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, EntryRecord, Tx } from "@earendil-works/pi-durable";

import { engineError } from "../errors.js";

/** 主機要求套用的壓縮。 */
export interface CompactionCommitRequest {
  /** 摘要的內文；會成為模型看得到的壓縮摘要。 */
  readonly summary: string;
  /** 第一則保留的訊息游標（等於引擎的 entry id）。 */
  readonly keepFromCursor: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
}

/** 最近幾個 entry 裡已有一模一樣的壓縮時視為重送；中止後補做才會重來。 */
const DUPLICATE_SCAN_LIMIT = 8;

/** 寫一筆壓縮 entry；`engineConversationId` 是引擎內部的對話編號。 */
export async function appendCompactionEntry(
  conversation: Conversation,
  engineConversationId: number,
  request: CompactionCommitRequest,
  now: number,
): Promise<void> {
  const head = Number(request.keepFromCursor);
  if (!Number.isInteger(head) || head <= 0) {
    throw engineError("invalid-request", "保留範圍的游標不是引擎的 entry 編號");
  }
  // 中斷後補做會帶著同一份摘要與同一個游標重送；不要再寫一筆重複的壓縮。
  const page = await conversation.entries(
    { order: "descending" },
    DUPLICATE_SCAN_LIMIT,
    undefined,
    BACKGROUND_CONTEXT,
  );
  const duplicate = page.items.find(
    (entry) =>
      entry.kind === "pi.compaction" &&
      Number(entry.head) === head &&
      compactionSummaryOf(entry) === request.summary,
  );
  if (duplicate !== undefined) {
    return;
  }
  await conversation.commit(async (tx: Tx) => {
    if (!(await entryExists(tx, head))) {
      throw engineError("invalid-request", "保留範圍的 entry 不在這場對話裡");
    }
    await tx.appendEntry(engineConversationId as never, {
      kind: "pi.compaction",
      data: {
        reason: "manual",
        beforeTokens: request.beforeTokens,
        afterTokens: request.afterTokens,
      },
      head: head as never,
      model: [{ role: "user", content: request.summary, timestamp: now }] as never,
    });
  }, BACKGROUND_CONTEXT);
}

async function entryExists(tx: Tx, entryId: number): Promise<boolean> {
  return (await tx.entry(entryId as never)) !== undefined;
}

/** 讀出壓縮 entry 裡的摘要文字；形狀不符時回 `undefined`。 */
function compactionSummaryOf(entry: EntryRecord): string | undefined {
  const model = entry.model as readonly { readonly content?: unknown }[] | undefined;
  const content = model?.[0]?.content;
  return typeof content === "string" ? content : undefined;
}
