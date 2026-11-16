/**
 * 測試用的 MCP 核准綁定：開一個正規狀態庫，並登記已核准的紀錄。
 *
 * 正式流程裡綁定只會在協定核准後寫入；測試若直接 `store.add` 建立紀錄，
 * 那筆紀錄沒有核准綁定，在啟動時一律不會被當成可啟動的設定。
 */
import { McpServerApprovalStore, Storage } from "@cardiary/storage";
import type { McpServerRecord } from "@cardiary/domain";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const storages: Storage[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * 開一個獨立的正規狀態庫做核准綁定。
 *
 * 正式執行時綁定存在受保護資料夾的狀態庫；測試把綁定當成相依注入，
 * 用獨立暫存庫即可，且不會和已寫入 `mcp-servers.json` 的 MCP 資料夾
 * 在 Storage.open 的「非空資料夾」與行程鎖上衝突。同一個回傳物件在
 * 多次啟動之間重複使用，用來驗證重啟後綁定仍然存在。
 */
export function openMcpApprovals(): McpServerApprovalStore {
  const root = mkdtempSync(join(tmpdir(), "cardiary-mcp-approvals-"));
  mkdirSync(join(root, "Cardiary"), { recursive: true });
  roots.push(root);
  const storage = Storage.open({
    path: join(root, "Cardiary"),
    initialize: true,
    appVersion: "test",
  });
  storages.push(storage);
  return new McpServerApprovalStore(storage.state);
}

/** 把目前正本裡的紀錄登記成已核准；手改過的內容請先重新讀出來再登記。 */
export function approveMcpRecord(bindings: McpServerApprovalStore, record: McpServerRecord): void {
  bindings.approve(record);
}
