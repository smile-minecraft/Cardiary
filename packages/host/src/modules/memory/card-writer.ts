/**
 * 蒸餾記憶卡的原子寫入。
 *
 * `CardService.create` 不接受系統種類（`memory`）也不接受指定 id，所以蒸餾
 * 用自己的寫入器：卡片檔是正本，內容雜湊命名、永不改寫；索引由卡片庫的補掃
 * 重建，`card.changed` 由補掃送。固定輸出卡 id 由續跑意圖事先分配，中斷後
 * 以 id 是否存在且內容相符決定 adopt／write／abort。
 *
 * 只新增，不改寫任何既有卡片檔——存活對話已載入的內容位元組不變。
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import {
  normalizeRfc3339,
  parseCardText,
  serializeCardFile,
  type CardFrontmatter,
  type CardKind,
} from "@cardiary/domain";

import type { MemoryCardDraft } from "@cardiary/domain";

export interface MemoryCardWriterOptions {
  /** `<資料夾>/cards` 的絕對路徑。 */
  readonly cardsDirectory: string;
  readonly now?: () => Date;
}

/** 一張卡檔的現況；續跑決定用。 */
export interface ExistingCardFile {
  readonly contentHash: string;
  readonly cardId: string;
}

export class MemoryCardWriter {
  readonly #directory: string;
  readonly #now: () => Date;

  constructor(options: MemoryCardWriterOptions) {
    this.#directory = options.cardsDirectory;
    this.#now = options.now ?? (() => new Date());
  }

  /** 固定 id 的卡檔是否存在；存在時回傳其內容雜湊供續跑比對。 */
  existing(cardId: string, expectedBodyHash: string): ExistingCardFile | null {
    const path = join(this.#directory, `${cardId}.md`);
    if (!existsSync(path)) return null;
    try {
      const text = readFileSync(path, "utf8");
      const parsed = parseCardText(text, { expectedCardId: cardId });
      if (!parsed.ok) {
        return { cardId, contentHash: `__broken__${hashText(text)}` };
      }
      const bodyHash = hashText(parsed.body);
      return { cardId, contentHash: bodyHash === expectedBodyHash ? expectedBodyHash : `__mismatch__${bodyHash}` };
    } catch {
      return { cardId, contentHash: "__unreadable__" };
    }
  }

  /** 卡檔是否還在（復原delete前比對用）。 */
  cardExists(cardId: string): boolean {
    return existsSync(join(this.#directory, `${cardId}.md`));
  }

  /**
   * 寫一張蒸餾記憶卡。既有 id 的檔案不會被覆寫（回 `false`）。
   *
   * `id` 是續跑意圖事先分配的固定值；`expectedBodyHash` 讓中斷後讀出的檔案
   * 能和意圖比對，相符才 adopt，不相符則 abort 不覆寫。
   */
  write(input: {
    readonly id: string;
    readonly draft: MemoryCardDraft;
    readonly bodyHash: string;
  }): boolean {
    const path = join(this.#directory, `${input.id}.md`);
    if (existsSync(path)) return false; // 永不改寫既有卡
    const createdAt = normalizeRfc3339(this.#now().toISOString()) ?? this.#now().toISOString();
    const frontmatter: CardFrontmatter = {
      id: input.id,
      kind: input.draft.kind as CardKind,
      title: input.draft.title,
      ...(input.draft.summary === undefined ? {} : { summary: input.draft.summary }),
      created: createdAt,
      sources: [...input.draft.sources],
      ...(input.draft.supersedes === undefined ? {} : { supersedes: input.draft.supersedes }),
      tags: [...input.draft.tags],
      persona: input.draft.persona,
      extra: {},
    };
    const presentKeys = [
      "id",
      "kind",
      "title",
      ...(frontmatter.summary === undefined ? [] : ["summary"]),
      "created",
      ...(frontmatter.sources.length === 0 ? [] : ["sources"]),
      ...(frontmatter.supersedes === undefined ? [] : ["supersedes"]),
      ...(frontmatter.tags.length === 0 ? [] : ["tags"]),
      "persona",
    ];
    const text = serializeCardFile({ frontmatter, presentKeys, body: input.draft.body });
    this.#writeAtomically(`${input.id}.md`, text);
    return true;
  }

  #writeAtomically(fileName: string, text: string): void {
    mkdirSync(this.#directory, { recursive: true });
    const target = join(this.#directory, fileName);
    const suffix = Math.random().toString(36).slice(2, 10);
    const temporary = join(this.#directory, `.${fileName}.${suffix}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o644);
    try {
      writeSync(descriptor, text);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, target);
    const directory = openSync(this.#directory, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}

/** 卡檔內文雜湊：與意圖比對用，單純的 SHA-256 hex。 */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
