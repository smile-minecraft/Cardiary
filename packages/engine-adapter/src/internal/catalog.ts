import { defineDoc } from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { Tx } from "@earendil-works/pi-durable";

import type { ModelSelection } from "../model.js";
import type { PermissionMode } from "../permission.js";
import type { ToolBundlePin } from "../tools.js";
import type { ConversationOrigin, ConversationPurpose, ConversationVisibility } from "../conversation.js";
import type { TurnStatus } from "../conversation.js";
import type { ConversationId } from "../ids.js";

/**
 * Cardiary 自己記得的對話中繼資料。
 *
 * `clientRequestId` 的正向與反向索引都放在同一份文件裡，並和對話建立
 * 寫在同一個 commit；刪除對話時一起清掉，重送回同一個請求不會指到已刪的資源。
 */
export type ConversationMeta = {
  readonly conversationId: ConversationId;
  readonly title: string;
  readonly purpose: ConversationPurpose;
  readonly permissionMode: PermissionMode;
  readonly toolBundles: ToolBundlePin[];
  readonly clientRequestId: string | null;
  readonly origin: ConversationOrigin | null;
  readonly model: ModelSelection;
  readonly rootConversationId: ConversationId;
  readonly depth: 0 | 1;
  readonly visibility: ConversationVisibility;
  readonly createdAt: string;
  readonly systemContext: string;
  readonly stagedUpdate: {
    readonly reason: "module-reload" | "context-refresh" | "manual";
    readonly systemContext: string | null;
    readonly toolBundles: ToolBundlePin[] | null;
  } | null;
  /** 支線的執行狀態；主對話沒有這個欄位。 */
  readonly subagent: {
    readonly title: string;
    readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
    readonly waiting: "blocking" | "background";
    readonly startedAt: string;
  } | null;
};

/** 還在進行中的一輪；重啟後由引擎的 `pi.live` 接回。 */
export type ActiveTurn = {
  readonly turnId: string;
  readonly triggerMessageId: string;
  readonly status: TurnStatus;
};

type CatalogShape = JsonObject & {
  conversations: { [key: string]: ConversationMeta };
  clientRequests: { [key: string]: string };
  turns: { [key: string]: ActiveTurn };
};

/**
 * 對話目錄；唯一的 Cardiary 中繼資料正本。
 *
 * 引擎的 `pi.agent` 只記模型與擴充名稱，標題、用途、權限模式與釘選的
 * 工具組版本記在這裡。所有寫入都在 Session 的 commit 內完成，因此和
 * 對話建立／刪除是同一個交易的原子操作。
 */
export const CatalogDoc = defineDoc<CatalogShape>({
  scope: "session",
  kind: "cardiary.catalog",
  version: 1,
  initial: () => ({ conversations: {}, clientRequests: {}, turns: {} }),
  checkpointWhen: () => false,
});

export type CatalogSnapshot = {
  readonly conversations: Readonly<Record<string, ConversationMeta>>;
  readonly clientRequests: Readonly<Record<string, string>>;
  readonly turns: Readonly<Record<string, ActiveTurn>>;
};

export function emptyCatalog(): CatalogSnapshot {
  return { conversations: {}, clientRequests: {}, turns: {} };
}

export async function readCatalog(tx: Tx): Promise<CatalogSnapshot> {
  const draft = await tx.doc(CatalogDoc);
  // Draft 是交易的 overlay，commit 之後就失效；複製成純資料再回傳。
  return JSON.parse(JSON.stringify(draft)) as CatalogSnapshot;
}
