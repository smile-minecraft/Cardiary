import { closeSync, constants, fstatSync, openSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 稽核檔屬 state 正本區；每次輪替只保留上一份，由使用者刪除資料夾時一併清除。 */
export const MAX_AUDIT_BYTES = 5 * 1024 * 1024;

export interface AuditEntry {
  readonly at: string;
  readonly kind: "policy-denied" | "auto-approved" | "grant-changed";
  readonly tool: string;
  /** 工具參數的 SHA-256 十六進位雜湊，不能傳入參數原文。 */
  readonly argsHash: string;
  readonly reason: string;
  readonly conversationId?: string;
}

/** 稽核寫入失敗時丟出錯誤，呼叫端不得假裝已經記錄。 */
export function createAuditLog(folderRoot: string): { appendAudit(entry: AuditEntry): void } {
  const file = path.join(folderRoot, "state", "agent-audit.jsonl");
  return {
    appendAudit(entry): void {
      if (!/^[a-f0-9]{64}$/.test(entry.argsHash)) throw new Error("無效的稽核參數雜湊");
      const { at, kind, tool, argsHash, reason, conversationId } = entry;
      const line = `${JSON.stringify({
        at,
        kind,
        tool,
        argsHash,
        reason,
        ...(conversationId === undefined ? {} : { conversationId }),
      })}\n`;
      const bytes = Buffer.byteLength(line);
      if (bytes > MAX_AUDIT_BYTES) throw new Error("稽核紀錄超過檔案大小上限");

      let fd = openSync(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile()) throw new Error("稽核路徑不是一般檔案");
        if (stat.size + bytes > MAX_AUDIT_BYTES) {
          closeSync(fd);
          fd = -1;
          renameSync(file, `${file}.1`);
          fd = openSync(
            file,
            constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
            0o600,
          );
          if (!fstatSync(fd).isFile()) throw new Error("稽核路徑不是一般檔案");
        }
        writeFileSync(fd, line);
      } finally {
        if (fd !== -1) closeSync(fd);
      }
    },
  };
}
