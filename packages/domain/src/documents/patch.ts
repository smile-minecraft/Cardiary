/**
 * 補丁接受／拒絕的領域操作。
 *
 * 接受前一律重算目前 revision，不信任呼叫端或索引的快取值；這是規格
 * 6.4「外部編輯優先」的落點。補丁的套用沿用卡片庫既有的 applyPatch，
 * 不在這裡重寫 diff 邏輯。
 */

import { applyPatch, computeRevision, sha256Hex } from "../cards/index.js";
import type { AcceptPatchInput, AcceptPatchResult } from "./types.js";

/** revision 不符；呼叫端轉成 conflict + details.reason = revision_mismatch。 */
export class DocumentRevisionMismatchError extends Error {
  readonly code = "revision_mismatch" as const;

  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`補丁的基礎 revision 已過期：預期 ${expected}，目前 ${actual}`);
    this.name = "DocumentRevisionMismatchError";
  }
}

/**
 * 接受補丁：檢查 revision → 套用 → 回傳新內容與新 revision。
 *
 * 拒絕不走這個函式；見 rejectPatch。這裡不碰任何儲存或協定平面。
 */
export function acceptPatch(input: AcceptPatchInput): AcceptPatchResult {
  const currentRevision = computeRevision(input.frontmatter, input.body);
  if (input.baseRevision !== currentRevision) {
    throw new DocumentRevisionMismatchError(input.baseRevision, currentRevision);
  }
  const body = applyPatch(input.body, input.patch);
  return {
    body,
    revision: computeRevision(input.frontmatter, body),
    bodyHash: sha256Hex(body),
  };
}

/**
 * 拒絕補丁：待決補丁從未進正本，所以拒絕是 no-op，內容原樣回傳。
 *
 * 不留一筆莫名其妙的「已拒絕」紀錄；那只會增加要清的資料，對還原沒有幫助。
 */
export function rejectPatch(input: { readonly body: string }): { readonly body: string } {
  return { body: input.body };
}
