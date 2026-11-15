import { mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 對話裡的工具輸出上限；超過就只留頭尾與摘要，完整內容進暫存。 */
export interface ToolOutputLimits {
  /** 留在對話裡的總字元數。 */
  readonly maxInlineChars: number;
  /** 截斷後保留的開頭字元數。 */
  readonly headChars: number;
  /** 截斷後保留的結尾字元數。 */
  readonly tailChars: number;
  /** 寫進暫存檔的完整內容上限；超過只留頭尾，避免把整份大輸出寫進磁碟。 */
  readonly maxSpillChars: number;
}

/** 預設值：16 KiB 留在對話，頭尾各 4 KiB。 */
export const DEFAULT_OUTPUT_LIMITS: ToolOutputLimits = {
  maxInlineChars: 16_384,
  headChars: 4_096,
  tailChars: 4_096,
  maxSpillChars: 8 * 1024 * 1024,
};

/**
 * 檔案登記簿的最小介面；`@cardiary/storage` 的 `FileRegistry` 直接滿足。
 *
 * 工具輸出的暫存檔在寫入前先登記，任務結束由模組清除；沒有登記的檔案
 * 會在掃描時被視為垃圾。
 */
export interface OverflowRegistry {
  register(input: {
    readonly relPath: string;
    readonly ownerKind: "tool-call";
    readonly ownerId: string;
    readonly sizeBytes: number;
    readonly expiresAt: string | null;
  }): unknown;
  purgeOwner(ownerKind: "tool-call", ownerIds: readonly string[]): number;
}

export interface SpillWriter {
  readonly registry: OverflowRegistry | null;
  readonly now: () => Date;
  /** 寫入成功後通知模組記下「哪個回合產生這個檔案」，回合結束才能清除。 */
  readonly onSpill?: (identity: {
    readonly turnId: string;
    readonly callId: string;
    readonly tempDir: string;
  }) => void;
}

export interface FormattedOutput {
  readonly text: string;
  readonly truncated: boolean;
  /** 相對於 Cardiary 資料夾的暫存路徑；沒有寫入時是 `null`。 */
  readonly spillPath: string | null;
}

/** 工具呼叫的識別；暫存檔的路徑由回合與呼叫決定。 */
export interface ToolCallIdentity {
  readonly tempDir: string;
  readonly turnId: string;
  readonly callId: string;
}

/**
 * 把工具的完整輸出變成對話裡看得到的文字。
 *
 * 沒超過上限就原樣回傳；超過時只留頭、尾與摘要，完整內容寫到
 * `tmp/local-tools/<回合>/<呼叫>.log` 並登記檔案登記簿。
 */
export function formatToolOutput(
  text: string,
  limits: ToolOutputLimits,
  identity: ToolCallIdentity,
  spill: SpillWriter,
): FormattedOutput {
  if (text.length <= limits.maxInlineChars) {
    return { text, truncated: false, spillPath: null };
  }
  const spillPath = writeSpillFile(text, limits, identity, spill);
  const head = text.slice(0, limits.headChars);
  const tail = text.slice(text.length - limits.tailChars);
  const summary = `輸出被截斷：完整 ${text.length} 字元${
    spillPath === null ? "（完整內容未寫入暫存）" : `，完整內容在 ${spillPath}`
  }`;
  return {
    text: `${head}\n\n…（${summary}）…\n\n${tail}`,
    truncated: true,
    spillPath,
  };
}

function writeSpillFile(
  text: string,
  limits: ToolOutputLimits,
  identity: ToolCallIdentity,
  spill: SpillWriter,
): string | null {
  const turn = sanitizeSegment(identity.turnId);
  const call = sanitizeSegment(identity.callId);
  const relative = `tmp/local-tools/${turn}/${call}.log`;
  const absolute = join(identity.tempDir, "local-tools", turn, `${call}.log`);
  const kept =
    text.length <= limits.maxSpillChars
      ? text
      : `${text.slice(0, limits.maxSpillChars / 2)}\n\n…（暫存檔也超過上限，只留頭尾）…\n\n${text.slice(
          text.length - limits.maxSpillChars / 2,
        )}`;
  try {
    mkdirSync(join(identity.tempDir, "local-tools", turn), { recursive: true });
    writeFileSync(absolute, kept, { encoding: "utf8", mode: 0o600 });
    spill.registry?.register({
      relPath: relative,
      ownerKind: "tool-call",
      ownerId: identity.callId,
      sizeBytes: Buffer.byteLength(kept, "utf8"),
      expiresAt: new Date(spill.now().getTime() + 10 * 60 * 1000).toISOString(),
    });
    spill.onSpill?.({
      turnId: identity.turnId,
      callId: identity.callId,
      tempDir: identity.tempDir,
    });
    return relative;
  } catch {
    // 暫存寫不進去不影響工具結果；對話只留頭尾，並在摘要裡說明。
    return null;
  }
}

/** 路徑 segment 只留安全字元；呼叫端不該用 `..` 或 `/` 逃出暫存目錄。 */
export function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length === 0 || cleaned === "." || cleaned === ".." ? "_" : cleaned;
}

/** 移掉暫存檔之後空下來的目錄；目錄不是空的就留著，錯誤不影響清理結果。 */
function removeSpillDirectories(tempDir: string, turnId: string): void {
  const root = join(tempDir, "local-tools");
  try {
    rmdirSync(join(root, sanitizeSegment(turnId)));
  } catch {
    // 已經不在或不為空。
  }
  try {
    rmdirSync(root);
  } catch {
    // 還有其他回合的暫存檔。
  }
}

/**
 * 追蹤一個回合產生過哪些暫存檔，回合結束時交給檔案登記簿清除。
 *
 * 登記簿的 `purgeOwner` 會同時刪列與檔案；這裡再移除因此變空的暫存
 * 目錄，讓關機後 `tmp/local-tools` 不留下空殼。
 */
export class TurnOverflowTracker {
  readonly #byTurn = new Map<string, { readonly tempDir: string; readonly calls: Set<string> }>();

  track(turnId: string, callId: string, tempDir: string): void {
    const turn = this.#byTurn.get(turnId) ?? { tempDir, calls: new Set<string>() };
    turn.calls.add(callId);
    this.#byTurn.set(turnId, turn);
  }

  /** 回合結束：清除這個回合的暫存檔；回傳被清除的呼叫數。 */
  cleanup(turnId: string, registry: OverflowRegistry | null): number {
    const turn = this.#byTurn.get(turnId);
    this.#byTurn.delete(turnId);
    if (turn === undefined || turn.calls.size === 0) {
      return 0;
    }
    registry?.purgeOwner("tool-call", [...turn.calls]);
    removeSpillDirectories(turn.tempDir, turnId);
    return turn.calls.size;
  }

  /**
   * 停用或關機：清除所有還沒結束的回合留下的暫存檔。
   *
   * 回合結束的掛鉤在 M1 還沒有派送器；停用與關機一定會走到這裡，所以
   * 工具輸出不會跨過一次服務生命週期留在 `tmp/`。
   */
  cleanupAll(registry: OverflowRegistry | null): number {
    const turns = [...this.#byTurn.entries()];
    this.#byTurn.clear();
    const calls = turns.flatMap(([, turn]) => [...turn.calls]);
    if (calls.length === 0) {
      return 0;
    }
    registry?.purgeOwner("tool-call", calls);
    for (const [turnId, turn] of turns) {
      removeSpillDirectories(turn.tempDir, turnId);
    }
    return calls.length;
  }

  pendingTurns(): readonly string[] {
    return [...this.#byTurn.keys()];
  }
}
