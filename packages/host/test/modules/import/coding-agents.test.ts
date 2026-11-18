import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_TEXT_BYTES } from "../../../src/modules/import/fs.js";
import { wirePreview } from "../../../src/modules/import/wire.js";
import {
  fakeImportModel,
  makeImportFixture,
  makeTree,
  snapshotDirectory,
  type ImportFixture,
} from "./helpers.js";

const fixtures: ImportFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});
const range = {
  includeConversations: true,
  rangeStart: "2026-01-01T00:00:00Z",
  rangeEnd: "2026-12-31T23:59:59Z",
};

const codexRecords = [
  { timestamp: "2026-05-01T00:00:00Z", type: "session_meta", payload: { id: "session-a" } },
  {
    timestamp: "2026-05-01T00:01:00Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "請整理書櫃" }],
    },
  },
  {
    timestamp: "2026-05-01T00:02:00Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "週末整理" }],
    },
  },
]
  .map((line) => JSON.stringify(line))
  .join("\n");
const claudeRecords = [
  {
    type: "user",
    timestamp: "2026-05-01T00:01:00Z",
    sessionId: "session-b",
    message: { role: "user", content: "請整理書櫃" },
  },
  {
    type: "assistant",
    timestamp: "2026-05-01T00:02:00Z",
    sessionId: "session-b",
    message: { role: "assistant", content: [{ type: "text", text: "週末整理" }] },
  },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

describe.each([
  {
    kind: "codex" as const,
    files: {
      "AGENTS.md": "# 規則\n使用清楚的名稱",
      "memories/rollout_summaries/project.md": "# 記憶\n專案使用 TypeScript",
      "memories/credentials-private.md": "fake",
      "memories/private.pem": "fake",
      "sessions/2026/05/01/rollout.jsonl.gz": gzipSync(codexRecords),
      "sessions/2026/05/01/bad.jsonl": "{bad",
      ".env": "fake",
      "auth.json": "fake",
      "credentials.json": "fake",
    },
  },
  {
    kind: "claude-code" as const,
    files: {
      "CLAUDE.md": "# 規則\n使用清楚的名稱",
      "projects/example/memory/project.md": "# 記憶\n專案使用 TypeScript",
      "projects/example/memory/credentials-private.md": "fake",
      "projects/example/memory/private.pem": "fake",
      "projects/example/session.jsonl": claudeRecords,
      "projects/example/bad.jsonl": "{bad",
      ".env": "fake",
      "auth.json": "fake",
      "credentials.json": "fake",
    },
  },
])("$kind 來源", ({ kind, files }) => {
  it("預覽、寫入、去重，標記專案記憶，來源唯讀且不開機密", async () => {
    const root = await mkdtemp(join(tmpdir(), "cardiary-coding-source-"));
    await makeTree(root, files);
    const before = await snapshotDirectory(root);
    const f = await makeImportFixture({ models: fakeImportModel() });
    fixtures.push(f);
    await expect(
      f.service.preview({ sourceKind: kind, sourcePath: root, includeConversations: true }),
    ).rejects.toMatchObject({ code: "invalid_message" });
    const preview = await f.service.preview({ sourceKind: kind, sourcePath: root, ...range });
    expect(preview.items.map((item) => item.category).sort()).toEqual(["memory", "rule"]);
    expect(preview.conversations).toHaveLength(1);
    expect(preview.conversationEstimate).toMatchObject({
      candidates: 1,
      messages: 2,
      modelSummaries: 1,
    });
    expect(preview.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "unsupported-format" })]),
    );
    const wire = wirePreview(preview) as unknown as {
      items: { category: string; origin?: string }[];
    };
    expect(wire.items.find((item) => item.category === "memory")?.origin).toBe("project");
    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: [
        ...preview.items.map((item) => item.key),
        ...preview.conversations.map((item) => item.key),
      ],
    });
    expect(report.cardsCreated).toBe(3);
    const cards = await Promise.all(report.results.map((item) => f.library.get(item.cardId ?? "")));
    expect(cards.map((card) => card?.frontmatter.kind).sort()).toEqual([
      "memory",
      "note",
      "summary",
    ]);
    expect(cards.every((card) => card?.frontmatter.importedFrom?.tool === kind)).toBe(true);
    const again = await f.service.preview({ sourceKind: kind, sourcePath: root, ...range });
    expect(again.items.every((item) => item.duplicateCardId !== undefined)).toBe(true);
    const second = await f.service.write({
      jobId: again.jobId,
      itemKeys: [
        ...again.items.map((item) => item.key),
        ...again.conversations.map((item) => item.key),
      ],
    });
    expect(second.cardsCreated).toBe(0);
    expect(await snapshotDirectory(root)).toEqual(before);
    for (const name of [
      ".env",
      "auth.json",
      "credentials.json",
      "credentials-private.md",
      "private.pem",
    ])
      expect(f.fs.opened(name)).toBe(false);
  });
});

describe("codex rollout 壓縮格式", () => {
  /** 一行合法但解壓後超過上限的 rollout；壓縮後很小，考驗的是解壓後的大小。 */
  const oversize = (tag: string): string =>
    JSON.stringify({
      timestamp: "2026-05-02T00:00:00Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `${tag}${"x".repeat(DEFAULT_MAX_TEXT_BYTES)}` }],
      },
    });

  it("讀取 zstd，過大、損壞與未知壓縮格式都列入跳過清單", async () => {
    const root = await mkdtemp(join(tmpdir(), "cardiary-codex-zstd-"));
    await makeTree(root, {
      "AGENTS.md": "# 規則\n使用清楚的名稱",
      "sessions/2026/05/01/rollout-zstd.jsonl.zst": zstdCompressSync(Buffer.from(codexRecords)),
      "sessions/2026/05/01/big.jsonl.zst": zstdCompressSync(Buffer.from(oversize("big"))),
      "sessions/2026/05/01/big-plain.jsonl": oversize("plain"),
      "sessions/2026/05/01/corrupt.jsonl.zst": Buffer.from("not a zstd frame"),
      "sessions/2026/05/01/legacy.jsonl.bz2": Buffer.from("BZh9"),
      "sessions/2026/05/01/credentials-private.jsonl.zst": zstdCompressSync(
        Buffer.from(codexRecords),
      ),
      "sessions/2026/05/01/.env.zst": "fake",
    });
    const before = await snapshotDirectory(root);
    const f = await makeImportFixture();
    fixtures.push(f);

    const preview = await f.service.preview({ sourceKind: "codex", sourcePath: root, ...range });

    expect(preview.conversations.map((item) => item.title)).toEqual(["rollout-zstd.jsonl.zst"]);
    expect(preview.conversations[0]).toMatchObject({ messageCount: 2 });
    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "sessions/2026/05/01/big.jsonl.zst",
          reason: "too-large",
        }),
        expect.objectContaining({
          path: "sessions/2026/05/01/big-plain.jsonl",
          reason: "too-large",
        }),
        expect.objectContaining({
          path: "sessions/2026/05/01/corrupt.jsonl.zst",
          reason: "decompress-failed",
        }),
        expect.objectContaining({
          path: "sessions/2026/05/01/legacy.jsonl.bz2",
          reason: "unsupported-compression",
        }),
      ]),
    );
    expect(f.fs.opened("credentials-private.jsonl.zst")).toBe(false);
    expect(f.fs.opened(".env.zst")).toBe(false);
    expect(await snapshotDirectory(root)).toEqual(before);
  });
});
