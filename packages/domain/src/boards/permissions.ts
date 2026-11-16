/**
 * 代理操作白板的權限判斷。
 *
 * 模式設定本身屬「僅限人類」，代理讀不到也改不了；本模組只負責
 * 「已知模式時，這個操作可不可以」這一個問題，避免每個呼叫點各自判斷。
 */

import type { BoardAgentMode, BoardOperation } from "./types.js";

/**
 * `read_only`（不動使用者內容）只允許讀取、投影新卡到收件區、
 * 以及從圈選建立新卡。移動、連線、分組、取消投影、釘選、整份覆寫
 * `save` 與刪白板都會拒絕；`full` 全部允許。
 *
 * `save` 是整份文件的覆寫，可能移動或刪除既有物件，所以在 `read_only`
 * 下拒絕；該模式要改白板只能走單一動作的訊息。
 */
export function isAgentBoardOperationAllowed(
  mode: BoardAgentMode,
  operation: BoardOperation,
  projection?: { readonly isNewCard: boolean; readonly target: "inbox" | "canvas" },
): boolean {
  if (mode === "full") return true;
  if (operation === "read") return true;
  if (operation === "project_card" || operation === "create_card_from_selection") {
    return projection?.isNewCard === true && projection.target === "inbox";
  }
  return false;
}
