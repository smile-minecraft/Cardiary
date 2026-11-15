import { basename, posix } from "node:path";

import {
  contentHash,
  fileItemKey,
  frontmatterTitle,
  isSecretFileName,
  looksBinary,
  skillContentHash,
  skillFrontmatter,
  skillItemKey,
  skillSlug,
  splitEntries,
  titleFrom,
} from "../interchange.js";
import { SourceAccessError, type SourceFileSystem } from "../fs.js";
import type {
  ImportCategory,
  ImportItemDraft,
  ImportScanOptions,
  ImportScanResult,
  ImportSkipped,
  ImportSkillDraft,
  ImportSourceAdapter,
} from "../types.js";

/**
 * 通用來源：使用者選一個資料夾，逐檔指定類別。
 *
 * 只讀 Markdown 與純文字；其他副檔名列在跳過清單。記憶與使用者資料逐條
 * 拆卡，人格與操作規則整份一張。對話沒有結構化的時間與訊息，不從這裡匯入。
 */

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);
const HIDDEN_PREFIX = ".";
const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const MAX_SKIPPED_LISTED = 200;

export interface GenericFileEntry {
  readonly relativePath: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly modifiedAt?: string;
  readonly supported: boolean;
}

export interface GenericListing {
  readonly files: readonly GenericFileEntry[];
  readonly truncated: boolean;
}

export function createGenericAdapter(deps: { readonly fs: SourceFileSystem }): ImportSourceAdapter {
  return {
    kind: "generic",
    async scan(options: ImportScanOptions): Promise<ImportScanResult> {
      const listing = await listGenericFiles(deps.fs, options.path);
      const items: ImportItemDraft[] = [];
      const skills: ImportSkillDraft[] = [];
      const skipped: ImportSkipped[] = [];
      const warnings: string[] = [];

      const entries = listing.files;
      for (const entry of entries) {
        if (!entry.supported) {
          if (skipped.length < MAX_SKIPPED_LISTED) {
            skipped.push({ path: entry.relativePath, reason: "unsupported-format" });
          }
          continue;
        }
        const category =
          options.categories?.[entry.relativePath] ??
          (options.defaultCategory === undefined || options.defaultCategory === "ignore"
            ? undefined
            : options.defaultCategory);
        if (category === undefined) {
          skipped.push({ path: entry.relativePath, reason: "category-not-assigned" });
          continue;
        }
        const absolute = posix.join(joinPath(options.path), entry.relativePath);
        if (!(await staysInside(deps.fs, options.path, absolute))) {
          skipped.push({ path: entry.relativePath, reason: "symlink-outside-source" });
          continue;
        }
        const file = await readFileOrSkip(deps.fs, absolute, entry.relativePath, skipped);
        if (file === undefined) continue;
        if (file.truncated) {
          warnings.push(`${entry.relativePath} 超過大小上限，只匯入前段。`);
        }
        if (looksBinary(file.text)) {
          skipped.push({ path: entry.relativePath, reason: "unsupported-format" });
          continue;
        }
        const text = file.text;
        if (text.trim() === "") {
          skipped.push({ path: entry.relativePath, reason: "empty-content" });
          continue;
        }
        const title = titleFrom({
          ...optional("explicit", frontmatterTitle(text)),
          body: text,
          fallback: basename(entry.relativePath).replace(/\.[^.]+$/u, ""),
        });

        if (category === "skill") {
          const frontmatter = skillFrontmatter(text);
          skills.push({
            key: skillItemKey(entry.relativePath),
            name: frontmatter.name ?? title,
            description: frontmatter.description ?? "",
            slug: skillSlug(
              frontmatter.name ?? basename(entry.relativePath, posix.extname(entry.relativePath)),
            ),
            skillMarkdown: text,
            contentHash: skillContentHash(text),
            source: { tool: "generic", path: absolute },
            attachmentsNotCopied: 0,
          });
          continue;
        }
        if (category === "conversation") {
          skipped.push({
            path: entry.relativePath,
            reason: "unsupported-format",
            detail: "通用來源沒有對話結構（訊息角色與時間）",
          });
          continue;
        }
        if (category === "memory" || category === "user") {
          const entriesOfFile = splitEntries(text);
          const parts = entriesOfFile.length === 0 ? [text.trim()] : entriesOfFile;
          parts.forEach((part, index) => {
            if (part.trim() === "") return;
            const itemTitle = titleFrom({
              body: part,
              fallback: parts.length === 1 ? title : `${title}（${index + 1}）`,
            });
            items.push({
              key:
                parts.length === 1
                  ? fileItemKey(entry.relativePath)
                  : fileItemKey(entry.relativePath, index + 1),
              category,
              title: itemTitle,
              body: part,
              ...optionalSummary(firstLine(part)),
              tags: [],
              ...optional("createdAt", entry.modifiedAt),
              contentHash: contentHash({ category, title: itemTitle, body: part }),
              source: { tool: "generic", path: absolute },
            });
          });
          continue;
        }
        items.push({
          key: fileItemKey(entry.relativePath),
          category,
          title,
          body: text,
          ...optionalSummary(firstLine(text)),
          tags: [],
          ...optional("createdAt", entry.modifiedAt),
          contentHash: contentHash({ category, title, body: text }),
          source: { tool: "generic", path: absolute },
        });
      }

      if (listing.truncated) {
        warnings.push(`檔案超過 ${MAX_FILES} 個，只處理前 ${MAX_FILES} 個。`);
      }
      if (options.providedPersona !== undefined) {
        const persona = options.providedPersona;
        items.push({
          key: "provided:persona",
          category: "persona",
          title: titleFrom({ explicit: persona.title, body: persona.body, fallback: "人格" }),
          body: persona.body,
          tags: [],
          contentHash: contentHash({
            category: "persona",
            title: persona.title,
            body: persona.body,
          }),
          source: { tool: "generic", path: `${options.path}#provided` },
        });
      }
      return {
        tool: "generic",
        items,
        skills,
        conversations: [],
        skipped,
        notes: [],
        warnings,
      };
    },
  };
}

/** 列出資料夾裡可以匯入的檔案；介面用它讓使用者逐檔指定類別。 */
export async function listGenericFiles(
  fs: SourceFileSystem,
  root: string,
): Promise<GenericListing> {
  const stat = await fs.stat(root);
  if (stat.kind === "missing") {
    throw new SourceAccessError(root, "找不到來源資料夾");
  }
  if (stat.kind === "file") {
    return {
      files: [
        {
          relativePath: basename(root),
          name: basename(root),
          sizeBytes: stat.sizeBytes ?? 0,
          ...optional("modifiedAt", stat.modifiedAt),
          supported:
            TEXT_EXTENSIONS.has(posix.extname(root).toLowerCase()) &&
            !isSecretFileName(basename(root)),
        },
      ],
      truncated: false,
    };
  }
  const files: GenericFileEntry[] = [];
  const queue: { relative: string; depth: number }[] = [{ relative: "", depth: 0 }];
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const directory = current.relative === "" ? root : posix.join(joinPath(root), current.relative);
    let entries;
    try {
      entries = await fs.list(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(HIDDEN_PREFIX)) continue;
      if (isSecretFileName(entry.name)) continue;
      const relative =
        current.relative === "" ? entry.name : posix.join(current.relative, entry.name);
      if (entry.kind === "directory") {
        if (current.depth < MAX_DEPTH) queue.push({ relative, depth: current.depth + 1 });
        continue;
      }
      if (files.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      if (entry.kind !== "file" && entry.kind !== "symlink") continue;
      const absolute = posix.join(joinPath(root), relative);
      const entryStat = await fs.stat(absolute);
      files.push({
        relativePath: relative,
        name: entry.name,
        sizeBytes: entryStat.sizeBytes ?? 0,
        ...optional("modifiedAt", entryStat.modifiedAt),
        supported: TEXT_EXTENSIONS.has(posix.extname(entry.name).toLowerCase()),
      });
    }
    if (truncated) break;
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { files, truncated };
}

/** 讀一個檔案；讀不到就記在跳過清單，不讓整批失敗。 */
export async function readFileOrSkip(
  fs: SourceFileSystem,
  absolute: string,
  displayPath: string,
  skipped: ImportSkipped[],
): Promise<{ text: string; truncated: boolean } | undefined> {
  try {
    const file = await fs.readText(absolute);
    return { text: file.text, truncated: file.truncated };
  } catch (error) {
    skipped.push({
      path: displayPath,
      reason: "not-readable",
      ...(error instanceof Error ? { detail: error.message } : {}),
    });
    return undefined;
  }
}

/** 符號連結可以讀，但不能讀到來源資料夾外面去。 */
export async function staysInside(
  fs: SourceFileSystem,
  root: string,
  absolute: string,
): Promise<boolean> {
  const [rootReal, targetReal] = await Promise.all([fs.realPath(root), fs.realPath(absolute)]);
  const normalizedRoot = rootReal.endsWith("/") ? rootReal : `${rootReal}/`;
  return targetReal === rootReal || targetReal.startsWith(normalizedRoot);
}

function optionalSummary(summary: string | undefined): { summary?: string } {
  return summary === undefined ? {} : { summary };
}

function firstLine(text: string): string | undefined {
  const line = text
    .split(/\r?\n/u)
    .map((entry) => entry.replace(/^#{1,6}\s*/u, "").trim())
    .find((entry) => entry.length > 0);
  return line === undefined ? undefined : [...line].slice(0, 200).join("");
}

/** 把資料夾根路徑轉成 POSIX 形式給 `posix.join` 用；Windows 不支援，這裡只需要 macOS。 */
export function joinPath(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

export type { ImportCategory };
