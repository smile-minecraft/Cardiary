import { basename } from "node:path";
import {
  contentHash,
  conversationContentHash,
  isSecretFileName,
  titleFrom,
} from "../interchange.js";
import { SourceDecompressionError } from "../fs.js";
import type { SourceFileSystem } from "../fs.js";
import type {
  ImportCategory,
  ImportConversationCandidate,
  ImportItemDraft,
  ImportScanOptions,
  ImportScanResult,
  ImportSkipped,
  ImportSourceAdapter,
} from "../types.js";
import { staysInside } from "./generic.js";

type CodingKind = "codex" | "claude-code";

type State = {
  items: ImportItemDraft[];
  conversations: ImportConversationCandidate[];
  skipped: ImportSkipped[];
};

export function createCodexAdapter(deps: { readonly fs: SourceFileSystem }): ImportSourceAdapter {
  return createAdapter("codex", deps.fs);
}

export function createClaudeCodeAdapter(deps: {
  readonly fs: SourceFileSystem;
}): ImportSourceAdapter {
  return createAdapter("claude-code", deps.fs);
}

function createAdapter(kind: CodingKind, fs: SourceFileSystem): ImportSourceAdapter {
  return {
    kind,
    async scan(options: ImportScanOptions): Promise<ImportScanResult> {
      const root = options.path;
      const state: State = { items: [], conversations: [], skipped: [] };
      if ((await fs.stat(root)).kind !== "directory") {
        return { tool: kind, ...state, skills: [], notes: [], warnings: ["找不到來源資料夾。"] };
      }
      await readDocument(
        fs,
        root,
        kind === "codex" ? "AGENTS.md" : "CLAUDE.md",
        kind,
        "rule",
        false,
        state,
      );
      if (kind === "codex") {
        for (const file of await filesUnder(fs, root, "memories", 4)) {
          if (file.endsWith(".md"))
            await readDocument(
              fs,
              root,
              file,
              kind,
              "memory",
              file.startsWith("memories/rollout_summaries/"),
              state,
            );
        }
        if (options.includeConversations && options.range) {
          for (const file of await filesUnder(fs, root, "sessions", 5)) {
            const compression = rolloutCompression(file);
            if (compression === "unsupported") {
              state.skipped.push({
                path: file,
                reason: "unsupported-compression",
                detail: "只支援 .jsonl、.jsonl.gz 與 .jsonl.zst。",
              });
            } else if (compression !== undefined) {
              await readConversation(fs, root, file, kind, options, state);
            }
          }
        }
      } else {
        const projects = (await staysInside(fs, root, `${root}/projects`))
          ? await entries(fs, `${root}/projects`)
          : [];
        for (const project of projects) {
          if (project.kind !== "directory" || forbidden(project.name)) continue;
          const directory = `projects/${project.name}`;
          for (const file of await filesUnder(fs, root, `${directory}/memory`, 4)) {
            if (file.endsWith(".md"))
              await readDocument(fs, root, file, kind, "memory", true, state);
          }
          if (options.includeConversations && options.range) {
            for (const file of await entries(fs, `${root}/${directory}`)) {
              if (file.kind === "file" && !forbidden(file.name) && file.name.endsWith(".jsonl")) {
                await readConversation(fs, root, `${directory}/${file.name}`, kind, options, state);
              }
            }
          }
        }
      }
      return { tool: kind, ...state, skills: [], notes: [], warnings: [] };
    },
  };
}

/** Codex 的 rollout 檔可能是 `.jsonl`、`.jsonl.gz` 或 `.jsonl.zst`。 */
type RolloutCompression = "plain" | "gzip" | "zstd" | "unsupported";

/**
 * 判斷 `sessions/` 底下的檔案是不是 rollout，以及用哪種壓縮。
 *
 * 不是 rollout 檔（例如 `.DS_Store`）回 `undefined`；是 rollout 但壓縮格式
 * 不認得時回 `unsupported`，呼叫端要記進跳過清單，不能讓檔案消失無蹤。
 */
function rolloutCompression(path: string): RolloutCompression | undefined {
  const name = basename(path).toLowerCase();
  if (name.endsWith(".jsonl")) return "plain";
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? "" : name.slice(0, dot);
  if (!stem.endsWith(".jsonl")) return undefined;
  const extension = name.slice(dot + 1);
  if (extension === "gz") return "gzip";
  if (extension === "zst") return "zstd";
  return "unsupported";
}

function forbidden(name: string): boolean {
  return (
    name.startsWith(".") || name.toLowerCase().startsWith("credentials") || isSecretFileName(name)
  );
}

async function entries(fs: SourceFileSystem, path: string) {
  try {
    return await fs.list(path);
  } catch {
    return [];
  }
}

async function filesUnder(
  fs: SourceFileSystem,
  root: string,
  relative: string,
  depth: number,
): Promise<string[]> {
  if (depth < 0 || !(await staysInside(fs, root, `${root}/${relative}`))) return [];
  const result: string[] = [];
  for (const entry of await entries(fs, `${root}/${relative}`)) {
    if (forbidden(entry.name)) continue;
    const path = `${relative}/${entry.name}`;
    if (entry.kind === "directory") result.push(...(await filesUnder(fs, root, path, depth - 1)));
    else if (entry.kind === "file") result.push(path);
  }
  return result.sort();
}

async function readDocument(
  fs: SourceFileSystem,
  root: string,
  relative: string,
  kind: CodingKind,
  category: Extract<ImportCategory, "rule" | "memory">,
  project: boolean,
  state: State,
): Promise<void> {
  const path = `${root}/${relative}`;
  if ((await fs.stat(path)).kind !== "file") return;
  if (!(await staysInside(fs, root, path))) {
    state.skipped.push({ path: relative, reason: "symlink-outside-source" });
    return;
  }
  try {
    const file = await fs.readText(path);
    if (file.truncated || file.text.includes("\u0000")) {
      state.skipped.push({ path: relative, reason: "unsupported-format" });
      return;
    }
    if (!file.text.trim()) return;
    const title = titleFrom({ body: file.text, fallback: basename(relative) });
    state.items.push({
      key: `${kind}:${project ? "project:" : "personal:"}${encodeURIComponent(relative)}`,
      category,
      title,
      body: file.text,
      tags: [kind],
      contentHash: contentHash({ category, title, body: file.text }),
      source: { tool: kind, path },
    });
  } catch {
    state.skipped.push({ path: relative, reason: "read-failed" });
  }
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map(object)
    .filter(
      (part) =>
        part &&
        (part.type === "text" || part.type === "input_text" || part.type === "output_text") &&
        typeof part.text === "string",
    )
    .map((part) => part?.text as string)
    .join("\n");
}

async function readConversation(
  fs: SourceFileSystem,
  root: string,
  relative: string,
  kind: CodingKind,
  options: ImportScanOptions,
  state: State,
): Promise<void> {
  const path = `${root}/${relative}`;
  if (!(await staysInside(fs, root, path))) {
    state.skipped.push({ path: relative, reason: "symlink-outside-source" });
    return;
  }
  try {
    const file = await fs.readText(path);
    if (file.truncated) {
      state.skipped.push({
        path: relative,
        reason: "too-large",
        detail: "解壓後超過可讀取的大小上限，未匯入。",
      });
      return;
    }
    const rows = file.text
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "")
      .map((line) => object(JSON.parse(line)));
    let anchor = relative;
    const messages: { role: string; text: string; timestamp: string }[] = [];
    for (const row of rows) {
      if (!row) throw new Error("invalid record");
      const payload = object(row.payload);
      if (kind === "codex" && row.type === "session_meta" && typeof payload?.id === "string")
        anchor = payload.id;
      if (kind === "claude-code" && typeof row.sessionId === "string") anchor = row.sessionId;
      const message =
        kind === "codex" && row.type === "response_item" && payload?.type === "message"
          ? payload
          : kind === "claude-code" && (row.type === "user" || row.type === "assistant")
            ? object(row.message)
            : undefined;
      if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
      const text = messageText(message.content).trim();
      const timestamp = typeof row.timestamp === "string" ? row.timestamp : "";
      if (text && Number.isFinite(Date.parse(timestamp)))
        messages.push({ role: message.role, text, timestamp });
    }
    if (messages.length === 0) throw new Error("no messages");
    const first = messages[0];
    const last = messages[messages.length - 1];
    if (!first || !last || !options.range) return;
    if (
      Date.parse(first.timestamp) < Date.parse(options.range.start) ||
      Date.parse(first.timestamp) > Date.parse(options.range.end)
    )
      return;
    const transcript = messages
      .map((message) => `${message.role}: ${message.text}`)
      .join("\n")
      .slice(0, 120_000);
    state.conversations.push({
      key: `${kind}:conversation:${encodeURIComponent(relative)}`,
      title: basename(relative),
      createdAt: new Date(first.timestamp).toISOString(),
      updatedAt: new Date(last.timestamp).toISOString(),
      messageCount: messages.length,
      characterCount: transcript.length,
      transcript,
      contentHash: conversationContentHash({
        tool: kind,
        anchor,
        updatedAt: new Date(last.timestamp).toISOString(),
      }),
      source: { tool: kind, path },
      unverified: true,
    });
  } catch (error) {
    state.skipped.push(
      error instanceof SourceDecompressionError
        ? { path: relative, reason: "decompress-failed", detail: error.message }
        : { path: relative, reason: "unsupported-format" },
    );
  }
}
