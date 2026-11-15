import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import {
  newCardId,
  normalizeRfc3339,
  parseCardText,
  serializeCardFile,
  type CardFrontmatter,
  type CardKind,
} from "@cardiary/domain";

/**
 * 匯入的卡片寫入。
 *
 * 匯入的卡片要帶 `importedFrom`，而且可以是 `memory`／`persona`／`summary`
 * 這些只有系統能建立的種類；`CardService.create` 目前兩者都不接受，所以
 * 匯入模組自己用領域套件的序列化與原子寫入規則寫檔（`cards.md` 第 2.5 節）。
 * 卡片檔仍然是唯一正本：索引由卡片庫的補掃重建，`card.changed` 也由補掃送。
 *
 * 去重同時看兩個地方：`import_items` 的內容雜湊（規格書第 16 章）與卡片檔
 * 上的 `importedFrom.hash`。後者讓 `state/` 重建後重跑同一來源仍然不會
 * 產生重複卡片。
 */
export interface ImportCardDraft {
  readonly kind: CardKind;
  readonly title: string;
  readonly body: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly createdAt?: string;
  readonly source: {
    readonly tool: string;
    readonly path: string;
    readonly hash: string;
  };
}

export interface ImportCardWriterOptions {
  /** `<資料夾>/cards` 的絕對路徑。 */
  readonly cardsDirectory: string;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class ImportCardWriter {
  readonly #directory: string;
  readonly #now: () => Date;
  readonly #newId: () => string;
  /** `importedFrom.hash` → cardId；第一次查詢時掃描，寫入後增量更新。 */
  #byHash: Map<string, string> | null = null;

  constructor(options: ImportCardWriterOptions) {
    this.#directory = options.cardsDirectory;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? newCardId;
  }

  /** 已經有一張卡片記著同一個內容雜湊時回它的識別碼。 */
  existingForHash(hash: string): string | undefined {
    return this.#hashIndex().get(hash);
  }

  /** 卡片檔還在不在；使用者刪卡之後索引不知道，所以以檔案為準。 */
  cardExists(cardId: string): boolean {
    return existsSync(join(this.#directory, `${cardId}.md`));
  }

  /** 忘掉某個雜湊的快取；呼叫端發現指到的卡片檔不見了之後呼叫。 */
  forgetHash(hash: string): void {
    this.#byHash?.delete(hash);
  }

  /** 寫一張卡；回傳新的識別碼。同一張卡不會被覆寫。 */
  write(draft: ImportCardDraft): { cardId: string } {
    const cardId = this.#newId();
    const createdAt = this.#timestamp(draft.createdAt);
    const frontmatter: CardFrontmatter = {
      id: cardId,
      kind: draft.kind,
      title: draft.title,
      ...(draft.summary === undefined || draft.summary.trim() === ""
        ? {}
        : { summary: draft.summary.trim() }),
      created: createdAt,
      sources: [],
      tags: [...draft.tags],
      persona: "default",
      importedFrom: draft.source,
      extra: {},
    };
    const presentKeys = [
      "id",
      "kind",
      "title",
      ...(frontmatter.summary === undefined ? [] : ["summary"]),
      "created",
      ...(frontmatter.tags.length === 0 ? [] : ["tags"]),
      "importedFrom",
    ];
    const text = serializeCardFile({ frontmatter, presentKeys, body: draft.body });
    this.#writeAtomically(`${cardId}.md`, text);
    this.#hashIndex().set(draft.source.hash, cardId);
    return { cardId };
  }

  /** 目錄不存在時建立；產品組裝由資料夾結構保證，測試與獨立組裝會用到。 */
  ensureDirectory(): void {
    mkdirSync(this.#directory, { recursive: true });
  }

  #hashIndex(): Map<string, string> {
    if (this.#byHash !== null) return this.#byHash;
    const index = new Map<string, string>();
    const names = readdirSync(this.#directory)
      .map((name) => name.toString())
      .filter((name) => name.endsWith(".md"));
    for (const name of names) {
      const cardId = name.slice(0, -".md".length);
      let text: string;
      try {
        text = readFileSync(join(this.#directory, name), "utf8");
      } catch {
        continue;
      }
      const parsed = parseCardText(text, { expectedCardId: cardId });
      if (!parsed.ok) continue;
      const hash = parsed.frontmatter.importedFrom?.hash;
      if (hash !== undefined && !index.has(hash)) index.set(hash, cardId);
    }
    this.#byHash = index;
    return index;
  }

  #timestamp(value: string | undefined): string {
    if (value !== undefined) {
      // 來源時間格式不合就當成現在；不讓一個壞時間擋住整批匯入。
      const normalized = normalizeRfc3339(value);
      if (normalized !== null) return normalized;
    }
    return this.#now().toISOString();
  }

  /** 原子替換：同目錄暫存檔加 `rename`，最後對目錄 fsync。 */
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
