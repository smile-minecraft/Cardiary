import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import type { ImportSkillDraft } from "./types.js";

/**
 * 技能匯入：把來源的 `SKILL.md` 複製到 Cardiary 資料夾的 `skills/<名稱>/`。
 *
 * M1 只複製說明檔（規格書第 16 章：技能轉成「技能說明檔」），技能目錄裡的
 * 附屬檔案留在來源，數量記在回報裡。目標目錄已經有內容時不覆寫：同名且
 * 內容相同算重複，內容不同就換一個帶雜湊後綴的目錄名稱。
 */
export interface SkillCopyResult {
  readonly status: "copied" | "exists";
  /** 相對 `skills/` 的目錄名稱。 */
  readonly directory: string;
}

export interface SkillCopierOptions {
  /** `<資料夾>/skills` 的絕對路徑。 */
  readonly skillsDirectory: string;
}

export interface SkillCopier {
  copy(draft: ImportSkillDraft): Promise<SkillCopyResult>;
  /** 已經有同名且同內容的技能時回目錄名稱。 */
  existing(draft: ImportSkillDraft): Promise<string | undefined>;
}

export class FileSkillCopier implements SkillCopier {
  readonly #directory: string;

  constructor(options: SkillCopierOptions) {
    this.#directory = options.skillsDirectory;
  }

  async existing(draft: ImportSkillDraft): Promise<string | undefined> {
    const target = join(this.#directory, draft.slug);
    if (sameSkill(target, draft.skillMarkdown)) return draft.slug;
    const suffixed = join(this.#directory, suffixOf(draft));
    if (sameSkill(suffixed, draft.skillMarkdown)) return suffixOf(draft);
    return undefined;
  }

  async copy(draft: ImportSkillDraft): Promise<SkillCopyResult> {
    const existing = await this.existing(draft);
    if (existing !== undefined) return { status: "exists", directory: existing };

    // 目標目錄名依序試「slug」「帶雜湊後綴」；任何已存在的東西（含符號
    // 連結）都不能用，避免 mkdir 跟隨連結寫到 skills/ 外面。
    for (const directory of [draft.slug, suffixOf(draft)]) {
      const targetDirectory = join(this.#directory, directory);
      if (!isFree(targetDirectory)) continue;
      mkdirSync(targetDirectory, { recursive: true });
      writeAtomically(join(targetDirectory, "SKILL.md"), draft.skillMarkdown);
      return { status: "copied", directory };
    }
    throw new Error(`技能目錄都被佔用了：${draft.slug}、${suffixOf(draft)}`);
  }
}

/** 同名目錄被別的東西佔用時，用內容雜湊當後綴。 */
function suffixOf(draft: ImportSkillDraft): string {
  return `${draft.slug}-${draft.contentHash.slice(0, 8)}`;
}

/** 只有路徑不存在時才算空位；已存在的東西（含符號連結）一律不用，不跟隨。 */
function isFree(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch {
    return true;
  }
}

function sameSkill(directory: string, markdown: string): boolean {
  try {
    const stats = lstatSync(directory);
    if (!stats.isDirectory()) return false;
    const skillFile = join(directory, "SKILL.md");
    // 附屬的 SKILL.md 是符號連結時也不跟隨；不讀 skills/ 外面的檔案。
    if (!lstatSync(skillFile).isFile()) return false;
    return readFileSync(skillFile, "utf8") === markdown;
  } catch {
    return false;
  }
}

function writeAtomically(path: string, text: string): void {
  const temporary = `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o644);
  try {
    writeSync(descriptor, text);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
}
