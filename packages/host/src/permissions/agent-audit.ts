/**
 * 自動放行的稽核紀錄。
 *
 * 屬正本區：`state/agent-audit.jsonl`，一行一筆，append 寫入。只記工具
 * 名稱、參數的 SHA-256、理由、機率與模型 id；不記提示全文，也不記參數
 * 原文。單檔上限 5 MB，超過就輪替成 `.1`（只保留一份前檔）。
 *
 * 刪除對話時要把該對話的紀錄從目前檔案與輪替檔一起移除；損毀的行略過，
 * 不讓一行壞掉擋住清除。
 */

import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** 固定的理由字串；不把提示或工具參數寫進來。 */
export type AgentAuditReason = "System One 通過" | "全部允許";

export interface AgentAuditEntry {
  readonly conversationId: string;
  readonly tool: string;
  readonly input: unknown;
  readonly reason: AgentAuditReason;
  /** System One 的機率；全部允許沒有人工智慧判斷，記 `null`。 */
  readonly probability: number | null;
  /** 判斷用的模型 id；沒有用到模型時記 `null`。 */
  readonly modelId: string | null;
}

export class AgentAudit {
  readonly #path: string;
  readonly #maxBytes: number;

  constructor(stateDirectory: string, maxBytes = 5 * 1024 * 1024) {
    this.#path = join(stateDirectory, "agent-audit.jsonl");
    this.#maxBytes = maxBytes;
  }

  append(entry: AgentAuditEntry): void {
    const serializedInput = JSON.stringify(entry.input);
    if (serializedInput === undefined) {
      throw new Error("無法計算工具參數雜湊");
    }
    const line = `${JSON.stringify({
      conversationId: entry.conversationId,
      tool: entry.tool,
      inputHash: createHash("sha256").update(serializedInput).digest("hex"),
      reason: entry.reason,
      probability: entry.probability,
      modelId: entry.modelId,
    })}\n`;
    const bytes = Buffer.byteLength(line);
    if (bytes > this.#maxBytes) {
      throw new Error("稽核紀錄超過檔案上限");
    }
    if (existsSync(this.#path) && statSync(this.#path).size + bytes > this.#maxBytes) {
      renameSync(this.#path, `${this.#path}.1`);
    }
    appendFileSync(this.#path, line, { mode: 0o600 });
  }

  /** 移除這些對話的紀錄；目前檔案與輪替檔都要清。 */
  removeConversations(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }
    const removed = new Set(ids);
    for (const path of [this.#path, `${this.#path}.1`]) {
      if (!existsSync(path)) {
        continue;
      }
      const kept = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .filter((line) => {
          const conversationId = conversationIdOf(line);
          // 壞掉的行讀不出對話，留著讓它繼續被看見；不能因為一行壞掉就清不掉。
          return conversationId === null || !removed.has(conversationId);
        });
      const temp = `${path}.${randomUUID()}.tmp`;
      writeFileSync(temp, kept.length === 0 ? "" : `${kept.join("\n")}\n`, { mode: 0o600 });
      renameSync(temp, path);
    }
  }
}

function conversationIdOf(line: string): string | null {
  try {
    const record: unknown = JSON.parse(line);
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      return null;
    }
    const id = (record as Record<string, unknown>).conversationId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}
