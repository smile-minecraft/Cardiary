import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectAndHello,
  makeFolder,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 卡片庫的協定契約：對真的主機行程跑，不是直接呼叫模組。
 *
 * 預設的 `--engine fake` 只換掉引擎；卡片仍然是資料夾裡的檔案，索引與
 * `card_state` 也真的落地，所以這一組能驗到「刪掉快取可重建」以外的
 * 所有協定行為。
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 測試用 ULID：時間主幹加隨機尾段，格式與產品相同。 */
function newUlid(offset = 0): string {
  let time = BigInt(Date.now() + offset);
  const timePart = new Array<string>(10);
  for (let index = 9; index >= 0; index -= 1) {
    timePart[index] = CROCKFORD[Number(time & 31n)] as string;
    time >>= 5n;
  }
  const randomPart = new Array<string>(16);
  for (let index = 0; index < 16; index += 1) {
    randomPart[index] = CROCKFORD[Math.floor(Math.random() * 32)] as string;
  }
  return `${timePart.join("")}${randomPart.join("")}`;
}

function cardFileText(input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly kind?: string;
  readonly updated?: string;
}): string {
  return [
    "---",
    `id: ${input.id}`,
    `kind: ${input.kind ?? "note"}`,
    `title: ${input.title}`,
    "created: 2026-01-01T00:00:00.000Z",
    ...(input.updated === undefined ? [] : [`updated: ${input.updated}`]),
    "---",
    input.body,
  ].join("\n");
}

interface CardsTest {
  readonly service: SpawnedService;
  readonly client: ProtocolClient;
}

let shared: CardsTest;

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

/** 非同步輪詢；契約測試等待監看去抖與索引更新。 */
async function until(check: () => Promise<boolean>, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("條件等待逾時");
}

async function request<T = Record<string, unknown>>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 6000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

async function createNote(
  client: ProtocolClient,
  input: { readonly title: string; readonly body: string; readonly tags?: string[] },
): Promise<{ cardId: string }> {
  const payload = await request<{ card: { cardId: string } }>(client, "card.create", {
    kind: "note",
    title: input.title,
    body: input.body,
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    clientRequestId: `create-${Math.random().toString(36).slice(2)}`,
  });
  return { cardId: payload.card.cardId };
}

describe("卡片協定", () => {
  it("建立、讀取、列表、搜尋、保鮮與刪除；card.changed 送到訂閱者", async () => {
    const { client } = shared;
    const title = `會議筆記 ${Math.random().toString(36).slice(2, 8)}`;
    const created = await createNote(client, {
      title,
      body: "討論排程與預算。\n",
      tags: ["專案A", "待辦"],
    });
    const cardId = created.cardId;
    expect(cardId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const event = await client.waitFor(
      (frame) =>
        frame.type === "card.changed" &&
        (frame.payload as { cardId?: string; change?: string }).cardId === cardId &&
        (frame.payload as { change?: string }).change === "created",
    );
    expect((event.payload as { revision: string }).revision).toMatch(/^[0-9a-f]{64}$/);

    const got = await request<{
      card: {
        cardId: string;
        title: string;
        body: string;
        tags: string[];
        revision: string;
        freshness: number;
        links: { outgoing: string[]; backlinks: string[] };
      };
    }>(client, "card.get", { cardId });
    expect(got.card.title).toBe(title);
    expect(got.card.body).toBe("討論排程與預算。\n");
    expect(got.card.tags).toEqual(["專案A", "待辦"]);
    expect(got.card.freshness).toBe(100);
    expect(got.card.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(got.card.links).toEqual({ outgoing: [], backlinks: [] });

    const listed = await request<{
      cards: Array<{ cardId: string; title: string; tags: string[] }>;
    }>(client, "card.list", { tags: ["專案A"] });
    expect(listed.cards.some((card) => card.cardId === cardId)).toBe(true);

    const searched = await request<{
      hits: Array<{ card: { cardId: string }; snippet: string; score: number }>;
    }>(client, "card.search", { query: "排程與" });
    expect(searched.hits[0]?.card.cardId).toBe(cardId);
    expect(searched.hits[0]?.snippet).toContain("排程");

    const refreshed = await request<{ cardId: string; freshness: number }>(client, "card.refresh", {
      cardId,
    });
    expect(refreshed).toEqual({ cardId, freshness: 100 });
    const refreshEvent = await client.waitFor(
      (frame) =>
        frame.type === "card.changed" &&
        (frame.payload as { cardId?: string; change?: string }).cardId === cardId &&
        (frame.payload as { change?: string }).change === "refreshed",
    );
    expect((refreshEvent.payload as { freshness: number }).freshness).toBe(100);

    // 卡片檔符合規格：檔名是 id，frontmatter 的 id 與檔名相同。
    const text = await readFile(join(shared.service.folder.path, "cards", `${cardId}.md`), "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain(`id: ${cardId}`);
    expect(text).toContain('tags: ["專案A", "待辦"]');

    const deleted = await request<{ cardId: string; deletedAssets: number }>(
      client,
      "card.delete",
      {
        cardId,
        clientRequestId: `delete-${Math.random().toString(36).slice(2)}`,
      },
    );
    expect(deleted).toEqual({ cardId, deletedAssets: 0 });
    const deleteEvent = await client.waitFor(
      (frame) =>
        frame.type === "card.changed" &&
        (frame.payload as { cardId?: string; change?: string }).cardId === cardId &&
        (frame.payload as { change?: string }).change === "deleted",
    );
    expect(deleteEvent.type).toBe("card.changed");

    const missing = client.request("card.get", { cardId });
    const missingReply = await client.waitForReply(missing);
    expect(missingReply.code).toBe("not_found");
  }, 20_000);

  it("補丁：revision 正確才套用；舊 revision 回 conflict；replace 與壞 diff 回 invalid_message", async () => {
    const { client } = shared;
    const { cardId } = await createNote(client, { title: "補丁測試", body: "第一行\n第二行\n" });
    const before = await request<{ card: { revision: string } }>(client, "card.get", { cardId });

    const patched = await request<{
      card: { revision: string; body: string; updatedAt: string };
    }>(client, "card.patch", {
      cardId,
      baseRevision: before.card.revision,
      patch: {
        format: "unified",
        text: ["@@ -1,2 +1,3 @@", " 第一行", " 第二行", "+第三行"].join("\n"),
      },
      clientRequestId: `patch-${Math.random().toString(36).slice(2)}`,
    });
    expect(patched.card.body).toBe("第一行\n第二行\n第三行\n");
    expect(patched.card.revision).not.toBe(before.card.revision);
    expect(patched.card.updatedAt).toBeDefined();

    const stale = client.request("card.patch", {
      cardId,
      baseRevision: before.card.revision,
      patch: { format: "unified", text: "@@ -1,1 +1,1 @@\n-第一行\n+換掉" },
    });
    const staleReply = await client.waitForReply(stale);
    expect(staleReply.code).toBe("conflict");
    expect((staleReply.details as { reason: string }).reason).toBe("revision_mismatch");
    expect((staleReply.details as { currentRevision: string }).currentRevision).toBe(
      patched.card.revision,
    );

    const replace = client.request("card.patch", {
      cardId,
      baseRevision: patched.card.revision,
      patch: { format: "replace", text: "整段換掉" },
    });
    const replaceReply = await client.waitForReply(replace);
    expect(replaceReply.code).toBe("invalid_message");
    expect((replaceReply.details as { reason: string }).reason).toBe("patch_format");

    const brokenDiff = client.request("card.patch", {
      cardId,
      baseRevision: patched.card.revision,
      patch: { format: "unified", text: "@@ -9,1 +9,1 @@\n-不存在\n+別的東西" },
    });
    const brokenReply = await client.waitForReply(brokenDiff);
    expect(brokenReply.code).toBe("invalid_message");
    expect((brokenReply.details as { reason: string }).reason).toBe("patch_failed");
  }, 20_000);

  it("未知的卡片訊息回 not_found；模組命名空間沒有被卡片吃掉", async () => {
    const { client } = shared;
    const unknown = client.request("card.unknown", {});
    const reply = await client.waitForReply(unknown);
    expect(reply.code).toBe("not_found");

    const moduleNamespace = client.request("module.cards.search", { data: {} });
    const moduleReply = await client.waitForReply(moduleNamespace);
    expect(moduleReply.code).toBe("not_found");
  });

  it("外部新增、修改與刪除卡片檔後索引會跟上；card.changed 是 updated 與 deleted", async () => {
    const { client, service } = shared;
    const cardId = newUlid();
    const path = join(service.folder.path, "cards", `${cardId}.md`);
    await writeFile(path, cardFileText({ id: cardId, title: "外部建立", body: "外部內容\n" }));

    await until(async () => {
      const listed = await request<{ cards: Array<{ cardId: string }> }>(client, "card.list", {
        limit: 200,
      });
      return listed.cards.some((card) => card.cardId === cardId);
    }, 8000);

    await writeFile(
      path,
      cardFileText({ id: cardId, title: "外部建立", body: "改過的外部內容\n" }),
    );
    await until(async () => {
      const got = await request<{ card: { body: string } }>(client, "card.get", { cardId });
      return got.card.body === "改過的外部內容\n";
    }, 8000);
    const updated = await client.waitFor(
      (frame) =>
        frame.type === "card.changed" &&
        (frame.payload as { cardId?: string; change?: string }).cardId === cardId &&
        (frame.payload as { change?: string }).change === "updated",
      8000,
    );
    expect((updated.payload as { revision?: string }).revision).toMatch(/^[0-9a-f]{64}$/);

    await rm(path);
    await until(async () => {
      const listed = await request<{ cards: Array<{ cardId: string }> }>(client, "card.list", {
        limit: 200,
      });
      return !listed.cards.some((card) => card.cardId === cardId);
    }, 8000);
  }, 20_000);

  it("格式不符的檔案標成 broken，列出時帶原因；card.get 回 conflict，檔案不被改寫", async () => {
    const { client, service } = shared;
    const cardId = newUlid();
    const content = `---\nid: ${cardId}\nkind: note\ncreated: 2026-01-01T00:00:00.000Z\n---\n沒有標題\n`;
    const path = join(service.folder.path, "cards", `${cardId}.md`);
    await writeFile(path, content);

    await until(async () => {
      const listed = await request<{
        cards: Array<{ cardId: string; broken?: boolean; brokenReason?: string }>;
      }>(client, "card.list", { limit: 200 });
      return listed.cards.some((card) => card.cardId === cardId && card.broken === true);
    }, 8000);

    const listed = await request<{
      cards: Array<{ cardId: string; broken?: boolean; brokenReason?: string }>;
    }>(client, "card.list", { limit: 200 });
    const broken = listed.cards.find((card) => card.cardId === cardId);
    expect(broken?.brokenReason).toContain("title");

    const get = client.request("card.get", { cardId });
    const reply = await client.waitForReply(get);
    expect(reply.code).toBe("conflict");
    expect((reply.details as { reason: string }).reason).toBe("broken_card");

    const after = await readFile(path, "utf8");
    expect(after).toBe(content);
  }, 20_000);

  it("停用卡片模組後 card.* 回 unsupported；重新啟用後恢復", async () => {
    const { client } = shared;
    const disabled = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: false,
      clientRequestId: `disable-${Math.random().toString(36).slice(2)}`,
    });
    const disabledReply = await client.waitForReply(disabled);
    expect((disabledReply.payload as { module: { state: string } }).module.state).toBe("inactive");

    const blocked = client.request("card.list", {});
    const blockedReply = await client.waitForReply(blocked);
    expect(blockedReply.code).toBe("unsupported");

    const enabled = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: true,
      clientRequestId: `enable-${Math.random().toString(36).slice(2)}`,
    });
    const enabledReply = await client.waitForReply(enabled);
    expect((enabledReply.payload as { module: { state: string } }).module.state).toBe("active");

    const listed = await request<{ cards: unknown[] }>(client, "card.list", {});
    expect(Array.isArray(listed.cards)).toBe(true);
  }, 20_000);
});

describe("卡片檔的啟動掃描", () => {
  it("啟動時索引既有檔案，並清掉超過一小時的暫存檔", async () => {
    const folder: TestFolder = await makeFolder();
    await mkdir(join(folder.path, "cards"), { recursive: true });
    const existingId = newUlid();
    await writeFile(
      join(folder.path, "cards", `${existingId}.md`),
      cardFileText({ id: existingId, title: "啟動前就在", body: "舊資料\n" }),
    );
    const tempId = newUlid();
    const tempPath = join(folder.path, "cards", `.${tempId}.abcdef12.tmp`);
    await writeFile(tempPath, "半寫入的內容");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(tempPath, old, old);

    const service = await spawnService({ folder });
    const client = await connectAndHello(service);
    try {
      const got = await request<{ card: { title: string } }>(client, "card.get", {
        cardId: existingId,
      });
      expect(got.card.title).toBe("啟動前就在");
      const exists = await stat(tempPath).then(
        () => true,
        () => false,
      );
      expect(exists).toBe(false);
    } finally {
      await client.close().catch(() => undefined);
      await service.stop().catch(() => undefined);
    }
  }, 20_000);

  it("刪掉 cache/ 後重啟，搜尋與反向連結仍然相同", async () => {
    const folder: TestFolder = await makeFolder();
    const first = await spawnService({ folder });
    const client = await connectAndHello(first);
    let targetId: string;
    let sourceId: string;
    try {
      targetId = (await createNote(client, { title: "被連結的卡", body: "這是目標卡的內容\n" }))
        .cardId;
      sourceId = (
        await createNote(client, {
          title: "連出去的卡",
          body: `請看 [[${targetId}]] 的內容。\n`,
        })
      ).cardId;
      const got = await request<{ card: { links: { outgoing: string[] } } }>(client, "card.get", {
        cardId: sourceId,
      });
      expect(got.card.links.outgoing).toContain(targetId);
    } finally {
      await client.close().catch(() => undefined);
      await first.stop().catch(() => undefined);
    }

    await rm(join(folder.path, "cache"), { recursive: true, force: true });

    const second = await spawnService({ folder });
    const again = await connectAndHello(second);
    try {
      const searched = await request<{ hits: Array<{ card: { cardId: string } }> }>(
        again,
        "card.search",
        { query: "目標卡" },
      );
      expect(searched.hits.some((hit) => hit.card.cardId === targetId)).toBe(true);
      const got = await request<{
        card: { links: { outgoing: string[]; backlinks: string[] } };
      }>(again, "card.get", { cardId: sourceId });
      expect(got.card.links.outgoing).toContain(targetId);
      const target = await request<{ card: { links: { backlinks: string[] } } }>(
        again,
        "card.get",
        { cardId: targetId },
      );
      expect(target.card.links.backlinks).toContain(sourceId);
    } finally {
      await again.close().catch(() => undefined);
      await second.stop().catch(() => undefined);
    }
  }, 30_000);
});
