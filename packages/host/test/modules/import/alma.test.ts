import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { ALMA_FORBIDDEN_TABLES } from "../../../src/modules/import/sources/alma-db.js";
import {
  cardFileNames,
  makeAlmaDatabase,
  makeImportFixture,
  snapshotDirectory,
  type ImportFixture,
} from "./helpers.js";

const fixtures: ImportFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

const REAL_CONTENT = "使用者喜歡在週末整理書櫃。";
const ARCHIVED_CONTENT = "被封存的舊筆記。";

interface AlmaFixture {
  readonly f: ImportFixture;
  readonly source: string;
  readonly databasePath: string;
}

async function alma(): Promise<AlmaFixture> {
  const f = await makeImportFixture();
  fixtures.push(f);
  const source = await mkdtemp(join(tmpdir(), "cardiary-alma-"));
  const databasePath = join(source, "chat_threads.db");
  await makeAlmaDatabase(databasePath, {
    memories: [
      { id: "memory-1", content: REAL_CONTENT, importance: 4, tags: ["整理", "收納"] },
      { id: "memory-2", content: "範例：下個月要整理儲藏室。", importance: 2 },
      { id: "memory-3", content: "範例：偏好安靜的環境。" },
      { id: "memory-empty", content: "   " },
    ],
    archived: [{ id: "archived-1", content: ARCHIVED_CONTENT }],
    threads: [
      {
        id: "thread-1",
        title: "書櫃整理",
        createdAt: "2026-11-10T09:00:00.000Z",
        updatedAt: "2026-11-10T10:00:00.000Z",
        messages: 4,
        conclusions: ["使用者要買層板", "預算兩千元"],
      },
      {
        id: "thread-2",
        title: "舊對話",
        createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-10-01T10:00:00.000Z",
        messages: 2,
        conclusions: ["十月談過儲藏室"],
      },
      {
        id: "thread-3",
        title: "沒有摘要",
        createdAt: "2026-11-12T09:00:00.000Z",
        messages: 3,
      },
    ],
    prompts: [{ id: "prompt-1", name: "回答風格", content: "回答前先確認日期。" }],
    crystals: 3,
  });
  return { f, source, databasePath };
}

describe("Alma 來源", () => {
  it("唯讀開啟資料庫：只查白名單的表，憑證表一條 SQL 都沒有", async () => {
    const { f, databasePath } = await alma();
    const before = await snapshotDirectory(databasePath.replace(/\/chat_threads\.db$/u, ""));

    const preview = await f.service.preview({ sourceKind: "alma", sourcePath: databasePath });
    await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });

    expect(f.database.statements.length).toBeGreaterThan(0);
    for (const sql of f.database.statements) {
      for (const forbidden of ALMA_FORBIDDEN_TABLES) {
        expect(sql).not.toContain(forbidden);
      }
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA|ATTACH)\b/u);
      expect(sql).not.toMatch(/SELECT\s+\*/iu);
    }
    const after = await snapshotDirectory(databasePath.replace(/\/chat_threads\.db$/u, ""));
    expect(after).toEqual(before);
  });

  it("記憶全部匯入並保留 importance；crystals 與封存記憶跳過；人格沒有來源", async () => {
    const { f, databasePath } = await alma();
    const preview = await f.service.preview({ sourceKind: "alma", sourcePath: databasePath });

    const memories = preview.items.filter((item) => item.category === "memory");
    expect(memories).toHaveLength(3);
    const first = memories.find((item) => item.body === REAL_CONTENT);
    expect(first?.importance).toBe(4);
    expect(first?.tags).toEqual(expect.arrayContaining(["alma", "整理", "importance-4"]));
    const withoutImportance = memories.find((item) => item.body === "範例：偏好安靜的環境。");
    expect(withoutImportance?.importance).toBeUndefined();

    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "crystals", reason: "crystals-not-imported", count: 3 }),
        expect.objectContaining({ path: "memory_archive", reason: "archived-memory", count: 1 }),
        expect.objectContaining({ path: "chat_threads", reason: "conversations-not-selected" }),
      ]),
    );
    expect(preview.items.some((item) => item.body.includes(ARCHIVED_CONTENT))).toBe(false);
    expect(preview.notes.map((note) => note.detail).join(" ")).toContain("沒有人格來源");
    expect(preview.items.filter((item) => item.category === "rule")).toHaveLength(1);

    const serialized = JSON.stringify(preview);
    for (const secret of [
      "sk-fake-provider-key",
      "encrypted-fake-secret",
      "fake-access-token",
      "fake-refresh-token",
      "fake-client-secret",
    ]) {
      expect(serialized).not.toContain(secret);
      expect(JSON.stringify(f.logs)).not.toContain(secret);
    }

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(4);
    const memoryCardId = report.results.find((result) => result.key === first?.key)?.cardId ?? "";
    const card = await f.library.get(memoryCardId);
    expect(card?.frontmatter.kind).toBe("memory");
    expect(card?.frontmatter.tags).toEqual(expect.arrayContaining(["importance-4"]));
    expect(card?.frontmatter.importedFrom?.path).toContain("#memories/memory-1");
    expect(JSON.stringify(report)).not.toContain("sk-fake-provider-key");
  });

  it("對話要指定時間範圍；摘要只取 conclusions，且不呼叫模型", async () => {
    const { f, databasePath } = await alma();
    await expect(
      f.service.preview({
        sourceKind: "alma",
        sourcePath: databasePath,
        includeConversations: true,
      }),
    ).rejects.toMatchObject({ code: "invalid_message", details: { reason: "range_required" } });

    const preview = await f.service.preview({
      sourceKind: "alma",
      sourcePath: databasePath,
      includeConversations: true,
      rangeStart: "2026-11-01T00:00:00.000Z",
      rangeEnd: "2026-11-30T23:59:59.000Z",
    });
    expect(preview.conversations.map((conversation) => conversation.title)).toEqual(["書櫃整理"]);
    expect(preview.conversations[0]?.existingSummary).toContain("層板");
    expect(preview.conversations[0]?.existingSummary).not.toContain("不該進卡片");
    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "thread_briefs", reason: "no-brief", count: 1 }),
      ]),
    );
    expect(preview.conversationEstimate).toMatchObject({
      candidates: 1,
      messages: 4,
      existingSummaries: 1,
      modelSummaries: 0,
      estimatedModelCalls: 0,
      estimatedModelInputTokens: 0,
    });

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.conversations.map((conversation) => conversation.key),
    });
    expect(report.cardsCreated).toBe(1);
    const card = await f.library.get(report.results[0]?.cardId ?? "");
    expect(card?.frontmatter.kind).toBe("summary");
    expect(card?.frontmatter.title).toBe("對話摘要：書櫃整理");
    expect(card?.body).toContain("層板");
    expect(card?.body).not.toContain("不該進卡片");
    expect(card?.frontmatter.importedFrom?.path).toContain("#threads/thread-1");
  });

  it("對話匯出的 JSON 也能讀；格式認不出來時跳過並回報", async () => {
    const { f, source } = await alma();
    const exportPath = join(source, "threads.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        exportPath,
        JSON.stringify({
          threads: [
            {
              threadId: "export-1",
              title: "匯出的對話",
              createdAt: "2026-11-11T00:00:00.000Z",
              messages: [
                { role: "user", content: "要買層板" },
                { role: "assistant", content: "好的" },
              ],
            },
            { title: "缺少時間" },
          ],
        }),
      ),
    );
    const preview = await f.service.preview({
      sourceKind: "alma",
      sourcePath: exportPath,
      includeConversations: true,
      rangeStart: "2026-11-01T00:00:00.000Z",
      rangeEnd: "2026-11-30T23:59:59.000Z",
    });
    expect(preview.conversations).toHaveLength(1);
    expect(preview.conversations[0]?.unverified).toBe(true);
    expect(preview.conversations[0]?.existingSummary).toBeUndefined();

    const brokenPath = join(source, "broken.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(brokenPath, "not json"));
    const broken = await f.service.preview({
      sourceKind: "alma",
      sourcePath: brokenPath,
      includeConversations: true,
      rangeStart: "2026-11-01T00:00:00.000Z",
      rangeEnd: "2026-11-30T23:59:59.000Z",
    });
    expect(broken.conversations).toEqual([]);
    expect(broken.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "broken.json" })]),
    );
  });

  it("使用者貼上的人格文字寫成可勾選的人格卡，勾選前不存在任何卡片", async () => {
    const { f, databasePath } = await alma();
    const preview = await f.service.preview({
      sourceKind: "alma",
      sourcePath: databasePath,
      providedPersona: { title: "我的語氣", body: "先說結論，再補理由。" },
    });
    const persona = preview.items.find((item) => item.category === "persona");
    expect(persona?.body).toBe("先說結論，再補理由。");
    expect(await cardFileNames(f.folder)).toEqual([]);

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: [persona?.key ?? ""],
    });
    expect(report.cardsCreated).toBe(1);
    const card = await f.library.get(report.results[0]?.cardId ?? "");
    expect(card?.frontmatter.kind).toBe("persona");
  });
});

describe("Alma 來源：表缺失", () => {
  it("prompts 與 thread_briefs 讀不了時，記憶照常匯入，其餘列入跳過", async () => {
    const { f, databasePath } = await alma();
    const db = new DatabaseSync(databasePath);
    db.exec("DROP TABLE prompts; DROP TABLE thread_briefs;");
    db.close();

    const preview = await f.service.preview({
      sourceKind: "alma",
      sourcePath: databasePath,
      includeConversations: true,
      rangeStart: "2026-11-01T00:00:00.000Z",
      rangeEnd: "2026-11-30T23:59:59.000Z",
    });

    expect(preview.items.map((item) => item.category)).toEqual(["memory", "memory", "memory"]);
    expect(preview.conversations).toEqual([]);
    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "prompts", reason: "read-failed" }),
        expect.objectContaining({ path: "chat_threads", reason: "read-failed" }),
      ]),
    );
  });

  it("memories 表讀不了時，回報認不出這個資料庫，不建立項目", async () => {
    const f = await makeImportFixture();
    fixtures.push(f);
    const source = await mkdtemp(join(tmpdir(), "cardiary-alma-broken-"));
    const databasePath = join(source, "chat_threads.db");
    const db = new DatabaseSync(databasePath);
    db.exec("CREATE TABLE whatever (id TEXT PRIMARY KEY)");
    db.close();

    const preview = await f.service.preview({ sourceKind: "alma", sourcePath: databasePath });

    expect(preview.items).toEqual([]);
    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "chat_threads.db", reason: "not-readable" }),
      ]),
    );
  });
});
