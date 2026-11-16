import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 匯入模組的協定契約：對真的主機行程跑。
 *
 * 來源是合成資料夾，卡片是真的檔案；驗的是 `module.import.*` 的線路形狀、
 * 寫入結果與重跑不重複，以及來源沒有被改。
 */

interface ImportTest {
  readonly service: SpawnedService;
  readonly client: ProtocolClient;
}

let shared: ImportTest;

beforeAll(async () => {
  const service = await spawnService();
  const client = await connectAndHello(service);
  const subscribe = client.request("system.subscribe", {});
  await client.waitForReply(subscribe);
  shared = { service, client };
}, 20_000);

afterAll(async () => {
  await shared?.client.close().catch(() => undefined);
  await shared?.service.stop().catch(() => undefined);
});

interface ModuleResponse<T> {
  readonly data: T;
}

async function request<T>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  // `module.*` 的請求與回應都是 `{ data: … }`（protocol.md 第 6 節）。
  const id = client.request(type, { data: payload });
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return (reply.payload as ModuleResponse<T>).data;
}

/** 第一方命名空間的回應是原始 payload；`module.*` 才是 `{ data }`。 */
async function requestRaw<T>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

async function errorOf(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ code: string; details?: { reason?: string } }> {
  const id = client.request(type, { data: payload });
  const reply = await client.waitForReply(id, 10_000);
  expect(reply.kind).toBe("error");
  return reply as unknown as { code: string; details?: { reason?: string } };
}

/** 一個獨立的來源資料夾；每個測試用自己的，避免去重互相影響。 */
async function makeSource(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-contract-import-"));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const queue = [""];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    const directory = current === "" ? root : join(root, current);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = current === "" ? entry.name : `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        queue.push(relative);
        result[relative] = "directory";
        continue;
      }
      const stats = await stat(join(root, relative));
      result[relative] = `${stats.size}:${stats.mtimeMs}`;
    }
  }
  return result;
}

async function cardFile(service: SpawnedService, cardId: string): Promise<string> {
  return readFile(join(service.folder.path, "cards", `${cardId}.md`), "utf8");
}

describe("匯入協定", () => {
  it("來源都列得出來，Hermes 未安裝時標明未驗證", async () => {
    const sources = await request<{
      sources: { kind: string; available: boolean; unverified?: string }[];
    }>(shared.client, "module.import.sources", {});
    expect(sources.sources.map((source) => source.kind)).toEqual([
      "generic",
      "hermes",
      "alma",
      "codex",
      "claude-code",
      "openclaw",
      "claude",
    ]);
    const hermes = sources.sources.find((source) => source.kind === "hermes");
    expect(hermes?.unverified).toContain("state.db");
  });

  it("OpenClaw 與 Claude 匯出可經主機預覽", async () => {
    const source = await makeSource({
      "workspace/AGENTS.md": "# 規則\n保持簡短",
      "conversations.json": JSON.stringify([
        {
          uuid: "synthetic",
          name: "測試",
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
          chat_messages: [{ sender: "human", text: "你好" }],
        },
      ]),
    });
    const openclaw = await request<{ items: { category: string }[] }>(
      shared.client,
      "module.import.preview",
      { sourceKind: "openclaw", sourcePath: source },
    );
    expect(openclaw.items.map((item) => item.category)).toEqual(["rule"]);
    const claude = await request<{
      conversations: unknown[];
      conversationEstimate: { candidates: number; messages: number };
    }>(shared.client, "module.import.preview", {
      sourceKind: "claude",
      sourcePath: join(source, "conversations.json"),
      includeConversations: true,
      rangeStart: "2026-01-01T00:00:00Z",
      rangeEnd: "2026-12-31T23:59:59Z",
    });
    expect(claude.conversations).toHaveLength(1);
    expect(claude.conversationEstimate).toMatchObject({ candidates: 1, messages: 1 });
  });

  it("預覽、勾選、寫入：卡片落地、frontmatter 記錄來源，重跑不重複", async () => {
    const { client, service } = shared;
    const source = await makeSource({
      "persona.md": "# 我的語氣\n\n先說結論。\n",
      "memory.md": "- 我住在台北\n- 喜歡手沖咖啡\n",
      "notes/rule.md": "回答前先確認日期。\n",
    });
    const before = await snapshot(source);
    const preview = await request<{
      jobId: string;
      items: { key: string; category: string; title: string; duplicateCardId?: string }[];
      skipped: { path: string; reason: string }[];
      newCards: number;
      duplicates: number;
    }>(client, "module.import.preview", {
      sourceKind: "generic",
      sourcePath: source,
      categories: {
        "persona.md": "persona",
        "memory.md": "memory",
        "notes/rule.md": "rule",
      },
    });
    expect(preview.items.map((item) => item.category).sort()).toEqual([
      "memory",
      "memory",
      "persona",
      "rule",
    ]);
    expect(preview.newCards).toBe(4);

    const report = await request<{
      cardsCreated: number;
      duplicates: number;
      results: { key: string; cardId?: string; status: string }[];
    }>(client, "module.import.write", {
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(4);
    expect(report.duplicates).toBe(0);

    const memoryCardId = report.results.find((result) =>
      result.key.includes("memory.md#1"),
    )?.cardId;
    expect(memoryCardId).toBeDefined();
    const file = await cardFile(service, memoryCardId ?? "");
    expect(file).toContain("kind: memory");
    expect(file).toContain("importedFrom:");
    expect(file).toContain("tool: generic");
    expect(file).toContain(`hash: `);

    const listed = await requestRaw<{ cards: { cardId: string; kind: string }[] }>(
      client,
      "card.list",
      { kinds: ["memory", "persona", "note"], limit: 200 },
    );
    expect(listed.cards.some((card) => card.cardId === memoryCardId)).toBe(true);

    // 同一來源再跑一次：0 張新卡。
    const second = await request<{
      jobId: string;
      items: { key: string; duplicateCardId?: string }[];
      duplicates: number;
      newCards: number;
    }>(client, "module.import.preview", {
      sourceKind: "generic",
      sourcePath: source,
      categories: {
        "persona.md": "persona",
        "memory.md": "memory",
        "notes/rule.md": "rule",
      },
    });
    expect(second.duplicates).toBe(4);
    expect(second.newCards).toBe(0);
    const secondReport = await request<{ cardsCreated: number; duplicates: number }>(
      client,
      "module.import.write",
      { jobId: second.jobId, itemKeys: second.items.map((item) => item.key) },
    );
    expect(secondReport.cardsCreated).toBe(0);
    expect(secondReport.duplicates).toBe(4);

    const after = await snapshot(source);
    expect(after).toEqual(before);
  }, 20_000);

  it("寫入時送 module.import.progress 事件", async () => {
    const { client } = shared;
    const source = await makeSource({ "memory.md": "- 一則記憶\n- 另一則記憶\n" });
    const preview = await request<{ jobId: string; items: { key: string }[] }>(
      client,
      "module.import.preview",
      { sourceKind: "generic", sourcePath: source, categories: { "memory.md": "memory" } },
    );
    const start = Date.now();
    const report = await request<{ cardsCreated: number }>(client, "module.import.write", {
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(2);
    const event = await client.waitFor(
      (frame) =>
        frame.type === "module.import.progress" &&
        (frame.payload as { data?: { jobId?: string; done?: number } }).data?.jobId ===
          preview.jobId &&
        (frame.payload as { data?: { done?: number } }).data?.done === 2,
      5000,
    );
    expect((event.payload as { data: { total: number } }).data.total).toBe(2);
    expect(Date.now() - start).toBeLessThan(5000);
  }, 20_000);

  it("選了對話卻沒有時間範圍時回 invalid_message", async () => {
    const error = await errorOf(shared.client, "module.import.preview", {
      sourceKind: "alma",
      includeConversations: true,
    });
    expect(error.code).toBe("invalid_message");
    expect(error.details?.reason).toBe("range_required");
  });

  it("格式不符的檔案列在跳過清單，其餘照常匯入", async () => {
    const { client } = shared;
    const source = await makeSource({
      "ok.md": "可以讀的內容。\n",
      "photo.png": "not really a png",
      "notes.pdf": "%PDF-1.4",
    });
    const preview = await request<{
      jobId: string;
      items: { key: string }[];
      skipped: { path: string; reason: string }[];
    }>(client, "module.import.preview", {
      sourceKind: "generic",
      sourcePath: source,
      defaultCategory: "rule",
    });
    expect(preview.items).toHaveLength(1);
    expect(preview.skipped.map((skip) => skip.path).sort()).toEqual(["notes.pdf", "photo.png"]);
    const report = await request<{ cardsCreated: number; skipped: { path: string }[] }>(
      client,
      "module.import.write",
      { jobId: preview.jobId, itemKeys: preview.items.map((item) => item.key) },
    );
    expect(report.cardsCreated).toBe(1);
    expect(report.skipped.map((skip) => skip.path)).toContain("photo.png");
    await rm(source, { recursive: true, force: true });
  }, 20_000);
});
