import { basename, extname } from "node:path";
import type { SourceFileSystem } from "../fs.js";
import { conversationContentHash, isSecretFileName } from "../interchange.js";
import type { ImportConversationCandidate, ImportSkipped, ImportSourceAdapter } from "../types.js";

const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function createClaudeExportAdapter(deps: {
  readonly fs: SourceFileSystem;
}): ImportSourceAdapter {
  return {
    kind: "claude",
    async scan(options) {
      const conversations: ImportConversationCandidate[] = [];
      const skipped: ImportSkipped[] = [];
      const notes = [{ path: options.path, detail: "Claude 匯出檔只匯入對話；記憶請自行貼入。" }];
      const result = () => ({
        tool: "claude",
        items: [],
        skills: [],
        conversations,
        skipped,
        notes,
        warnings: [],
      });
      if (!options.includeConversations || !options.range) return result();
      const name = basename(options.path);
      const lower = name.toLowerCase();
      const extension = extname(lower);
      if (
        name.startsWith(".") ||
        lower.startsWith("credentials") ||
        isSecretFileName(name) ||
        ![".json", ".zip"].includes(extension)
      ) {
        skipped.push({ path: name, reason: "unsupported-format" });
        return result();
      }
      try {
        const file =
          extension === ".zip"
            ? await deps.fs.readZipEntry(options.path, "conversations.json")
            : await deps.fs.readText(options.path, { maxBytes: MAX_EXPORT_BYTES });
        if (file.truncated || file.text.includes("\u0000")) throw new Error("invalid file");
        const data: unknown = JSON.parse(file.text);
        const rows = Array.isArray(data) ? data : object(data)?.conversations;
        if (!Array.isArray(rows)) throw new Error("invalid format");
        for (const [index, value] of rows.entries()) {
          const row = object(value);
          if (
            !row ||
            typeof row.uuid !== "string" ||
            typeof row.created_at !== "string" ||
            !Number.isFinite(Date.parse(row.created_at)) ||
            !Array.isArray(row.chat_messages)
          ) {
            skipped.push({ path: `${name}#${index + 1}`, reason: "unsupported-format" });
            continue;
          }
          const created = new Date(row.created_at).toISOString();
          if (
            Date.parse(created) < Date.parse(options.range.start) ||
            Date.parse(created) > Date.parse(options.range.end)
          )
            continue;
          const messages = row.chat_messages.flatMap((value: unknown) => {
            const message = object(value);
            if (!message || (message.sender !== "human" && message.sender !== "assistant"))
              return [];
            const text =
              typeof message.text === "string" && message.text.trim() !== ""
                ? message.text
                : Array.isArray(message.content)
                  ? message.content
                      .flatMap((part: unknown) => {
                        const content = object(part);
                        return content?.type === "text" && typeof content.text === "string"
                          ? [content.text]
                          : [];
                      })
                      .join("\n")
                  : "";
            return text.trim() ? [`${message.sender}: ${text.trim()}`] : [];
          });
          if (!messages.length) {
            skipped.push({ path: `${name}#${index + 1}`, reason: "unsupported-format" });
            continue;
          }
          const updated =
            typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at))
              ? new Date(row.updated_at).toISOString()
              : created;
          const transcript = messages.join("\n").slice(0, 120_000);
          conversations.push({
            key: `claude:conversation:${encodeURIComponent(row.uuid)}`,
            title: typeof row.name === "string" && row.name.trim() ? row.name : "未命名對話",
            createdAt: created,
            updatedAt: updated,
            messageCount: messages.length,
            characterCount: transcript.length,
            transcript,
            contentHash: conversationContentHash({
              tool: "claude",
              anchor: row.uuid,
              updatedAt: updated,
            }),
            source: { tool: "claude", path: `${options.path}#${row.uuid}` },
            unverified: true,
          });
        }
      } catch {
        skipped.push({ path: name, reason: "unsupported-format" });
      }
      return result();
    },
  };
}
