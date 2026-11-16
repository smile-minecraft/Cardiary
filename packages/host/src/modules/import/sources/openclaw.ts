import { basename } from "node:path";
import type { SourceFileSystem } from "../fs.js";
import {
  contentHash,
  conversationContentHash,
  isSecretFileName,
  skillContentHash,
  skillFrontmatter,
  skillSlug,
  splitEntries,
  titleFrom,
} from "../interchange.js";
import type {
  ImportCategory,
  ImportConversationCandidate,
  ImportItemDraft,
  ImportScanOptions,
  ImportSkipped,
  ImportSkillDraft,
  ImportSourceAdapter,
} from "../types.js";
import { staysInside } from "./generic.js";

type State = {
  items: ImportItemDraft[];
  skills: ImportSkillDraft[];
  conversations: ImportConversationCandidate[];
  skipped: ImportSkipped[];
};
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function createOpenClawAdapter(deps: {
  readonly fs: SourceFileSystem;
}): ImportSourceAdapter {
  return {
    kind: "openclaw",
    async scan(options) {
      const root = options.path;
      const state: State = { items: [], skills: [], conversations: [], skipped: [] };
      const notes = [{ path: root, detail: "OpenClaw 未在真實安裝上驗證。" }];
      if ((await deps.fs.stat(root)).kind !== "directory")
        return { tool: "openclaw", ...state, notes, warnings: ["找不到 OpenClaw 資料夾。"] };
      for (const [file, category] of [
        ["SOUL.md", "persona"],
        ["IDENTITY.md", "persona"],
        ["USER.md", "user"],
        ["AGENTS.md", "rule"],
        ["MEMORY.md", "memory"],
      ] as const) {
        await document(deps.fs, root, `workspace/${file}`, category, state);
      }
      for (const entry of await safeList(deps.fs, root, "workspace/memory")) {
        if (entry.kind === "file" && /^\d{4}-\d{2}-\d{2}\.md$/u.test(entry.name))
          await document(deps.fs, root, `workspace/memory/${entry.name}`, "memory", state);
      }
      for (const folder of ["workspace/skills", "skills"]) {
        for (const entry of await safeList(deps.fs, root, folder)) {
          if (
            entry.kind !== "directory" ||
            entry.name.startsWith(".") ||
            entry.name.toLowerCase().startsWith("credentials") ||
            isSecretFileName(entry.name)
          )
            continue;
          const relative = `${folder}/${entry.name}/SKILL.md`;
          const text = await readSafe(deps.fs, root, relative, state.skipped);
          if (text === undefined) continue;
          const frontmatter = skillFrontmatter(text);
          const name = frontmatter.name ?? entry.name;
          state.skills.push({
            key: `openclaw:skill:${encodeURIComponent(relative)}`,
            name,
            description: frontmatter.description ?? "",
            slug: skillSlug(name),
            skillMarkdown: text,
            contentHash: skillContentHash(text),
            source: { tool: "openclaw", path: `${root}/${relative}` },
            attachmentsNotCopied: await countAttachments(deps.fs, root, `${folder}/${entry.name}`),
          });
        }
      }
      if (options.includeConversations && options.range) {
        for (const agent of await safeList(deps.fs, root, "agents")) {
          if (agent.kind !== "directory" || agent.name.startsWith(".")) continue;
          const dir = `agents/${agent.name}/sessions`;
          for (const entry of await safeList(deps.fs, root, dir)) {
            if (
              entry.kind === "file" &&
              !entry.name.startsWith(".") &&
              !entry.name.toLowerCase().startsWith("credentials") &&
              !isSecretFileName(entry.name) &&
              entry.name.endsWith(".jsonl")
            )
              await conversation(deps.fs, root, `${dir}/${entry.name}`, options, state);
          }
        }
      }
      return { tool: "openclaw", ...state, notes, warnings: [] };
    },
  };
}

async function safeList(fs: SourceFileSystem, root: string, relative: string) {
  if (!(await staysInside(fs, root, `${root}/${relative}`))) return [];
  try {
    return await fs.list(`${root}/${relative}`);
  } catch {
    return [];
  }
}
async function countAttachments(
  fs: SourceFileSystem,
  root: string,
  relative: string,
): Promise<number> {
  let count = 0;
  const pending = [relative];
  while (pending.length > 0 && count <= 5000) {
    const directory = pending.shift();
    if (directory === undefined) break;
    for (const entry of await safeList(fs, root, directory)) {
      if (entry.kind === "directory") pending.push(`${directory}/${entry.name}`);
      else if (
        (entry.kind === "file" || entry.kind === "symlink") &&
        !(directory === relative && entry.name === "SKILL.md")
      )
        count++;
    }
  }
  return count;
}
async function readSafe(
  fs: SourceFileSystem,
  root: string,
  relative: string,
  skipped: ImportSkipped[],
): Promise<string | undefined> {
  const path = `${root}/${relative}`;
  if ((await fs.stat(path)).kind !== "file") return undefined;
  if (!(await staysInside(fs, root, path))) {
    skipped.push({ path: relative, reason: "symlink-outside-source" });
    return undefined;
  }
  try {
    const file = await fs.readText(path);
    if (file.truncated || file.text.includes("\u0000")) {
      skipped.push({ path: relative, reason: "unsupported-format" });
      return undefined;
    }
    return file.text;
  } catch {
    skipped.push({ path: relative, reason: "read-failed" });
    return undefined;
  }
}
async function document(
  fs: SourceFileSystem,
  root: string,
  relative: string,
  category: Extract<ImportCategory, "persona" | "user" | "rule" | "memory">,
  state: State,
) {
  const text = await readSafe(fs, root, relative, state.skipped);
  if (!text?.trim()) return;
  const entries = category === "memory" || category === "user" ? splitEntries(text) : [text];
  for (const [index, body] of entries.entries()) {
    const title = titleFrom({ body, fallback: basename(relative) });
    state.items.push({
      key: `openclaw:${encodeURIComponent(relative)}:${index}`,
      category,
      title,
      body,
      tags: ["openclaw"],
      contentHash: contentHash({ category, title, body }),
      source: { tool: "openclaw", path: `${root}/${relative}` },
    });
  }
}
async function conversation(
  fs: SourceFileSystem,
  root: string,
  relative: string,
  options: ImportScanOptions,
  state: State,
) {
  const text = await readSafe(fs, root, relative, state.skipped);
  if (text === undefined || !options.range) return;
  try {
    const rows = text
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => object(JSON.parse(line)));
    let anchor = relative;
    const messages: { role: string; text: string; timestamp: string }[] = [];
    for (const row of rows) {
      if (!row) throw new Error("invalid");
      if (row.type === "session" && typeof row.id === "string") anchor = row.id;
      if (row.type !== "message") continue;
      const message = object(row.message);
      if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
      const content =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .flatMap((part: unknown) => {
                  const value = object(part);
                  return value?.type === "text" && typeof value.text === "string"
                    ? [value.text]
                    : [];
                })
                .join("\n")
            : "";
      const timestamp = typeof row.timestamp === "string" ? row.timestamp : "";
      if (content.trim() && Number.isFinite(Date.parse(timestamp)))
        messages.push({ role: message.role, text: content.trim(), timestamp });
    }
    const first = messages[0];
    const last = messages[messages.length - 1];
    if (!first || !last) throw new Error("invalid");
    const created = new Date(first.timestamp).toISOString();
    const updated = new Date(last.timestamp).toISOString();
    if (
      Date.parse(created) < Date.parse(options.range.start) ||
      Date.parse(created) > Date.parse(options.range.end)
    )
      return;
    const transcript = messages
      .map((message) => `${message.role}: ${message.text}`)
      .join("\n")
      .slice(0, 120_000);
    state.conversations.push({
      key: `openclaw:conversation:${encodeURIComponent(relative)}`,
      title: basename(relative),
      createdAt: created,
      updatedAt: updated,
      messageCount: messages.length,
      characterCount: transcript.length,
      transcript,
      contentHash: conversationContentHash({ tool: "openclaw", anchor, updatedAt: updated }),
      source: { tool: "openclaw", path: `${root}/${relative}` },
      unverified: true,
    });
  } catch {
    state.skipped.push({ path: relative, reason: "unsupported-format" });
  }
}
