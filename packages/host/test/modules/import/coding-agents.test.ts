import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
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
