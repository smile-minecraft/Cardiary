import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProtocolEventEmitter, ProtocolRequestHandler } from "@cardiary/module-api";
import {
  CardFileStore,
  CardIndexStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { CardLibrary } from "../../../src/modules/cards/library.js";
import { registerCardsProtocol } from "../../../src/modules/cards/protocol.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";
import { createCardToolBundle } from "../../../src/modules/cards/tools.js";

/**
 * 卡片協定處理器的單元測試：直接呼叫註冊進命名空間的處理器，不經過網路。
 *
 * 這裡驗的是「回傳的線路形狀」與輸入檢查——閘道與訂閱者那一層由契約測試
 * 對真的主機行程驗。
 */

interface Fixture {
  readonly storage: Storage;
  readonly library: CardLibrary;
  readonly cards: ProtocolRequestHandler;
  readonly folder: string;
}

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close();
  }
});

async function makeFixture(): Promise<Fixture> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-cards-protocol-"));
  const storage = Storage.open({ path: folder, initialize: true });
  const now = (): Date => new Date();
  const files = new CardFileStore({ layout: storage.layout, now });
  const indexFor = (database: Database): CardIndexStore =>
    new CardIndexStore({ db: database, now });
  let cachedDatabase: Database | null = null;
  let cachedIndex: CardIndexStore | null = null;
  const index = (): CardIndexStore => {
    const database = storage.cache;
    if (cachedIndex === null || cachedDatabase !== database) {
      cachedDatabase = database;
      cachedIndex = indexFor(database);
    }
    return cachedIndex;
  };
  const library = new CardLibrary({
    files,
    index,
    assets: () => new LocalAssetStore({ layout: storage.layout, index: index(), now }),
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
  });
  await library.initialize();

  let handler: ProtocolRequestHandler | null = null;
  const protocol: ProtocolEventEmitter = {
    emit: () => {},
    registerNamespace: (_prefix, registered) => {
      handler = registered;
      return { dispose: () => {} };
    },
    registerHttpRoute: () => {
      throw new Error("卡片模組不註冊 HTTP 路由");
    },
  };
  registerCardsProtocol({ library, protocol });
  const cards = handler as ProtocolRequestHandler | null;
  if (cards === null) {
    throw new Error("卡片協定沒有註冊命名空間");
  }
  const fixture = { storage, library, cards, folder };
  fixtures.push(fixture);
  return fixture;
}

function call(
  fixture: Fixture,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return Promise.resolve(
    fixture.cards({
      type,
      payload: payload as never,
      clientId: "test",
    }),
  ) as Promise<Record<string, unknown>>;
}

describe("card.get 的 revision", () => {
  it("外部改檔後立刻讀取，revision 與 body 是同一份檔案，可以直接拿來補丁", async () => {
    const fixture = await makeFixture();
    const created = await call(fixture, "card.create", {
      kind: "note",
      title: "外部編輯",
      body: "第一版\n",
      clientRequestId: `create-${Math.random()}`,
    });
    const cardId = (created["card"] as { cardId: string }).cardId;
    const before = await call(fixture, "card.get", { cardId });
    const beforeRevision = (before["card"] as { revision: string }).revision;

    // 使用者在編輯器改檔；監看還在去抖，索引列仍記著舊的 revision。
    const path = join(fixture.folder, "cards", `${cardId}.md`);
    const original = await readFile(path, "utf8");
    await writeFile(path, original.replace("第一版\n", "外部改過的內容\n"));

    const got = await call(fixture, "card.get", { cardId });
    const card = got["card"] as { body: string; revision: string };
    expect(card.body).toBe("外部改過的內容\n");
    expect(card.revision).not.toBe(beforeRevision);

    // 拿這個 revision 立刻補丁：不該衝突。
    const patched = await call(fixture, "card.patch", {
      cardId,
      baseRevision: card.revision,
      patch: {
        format: "unified",
        text: "@@ -1,1 +1,2 @@\n 外部改過的內容\n+補上一行",
      },
    });
    expect((patched["card"] as { body: string }).body).toBe("外部改過的內容\n補上一行\n");
  }, 20_000);
});

describe("card.create 的輸入檢查", () => {
  it("image 與 audio 沒有 assetBlobId 時回 invalid_message，note 可以沒有", async () => {
    const fixture = await makeFixture();
    for (const kind of ["image", "audio"] as const) {
      await expect(
        call(fixture, "card.create", {
          kind,
          title: "沒有原檔",
          body: "內文\n",
          clientRequestId: `create-${kind}-${Math.random()}`,
        }),
      ).rejects.toMatchObject({
        code: "invalid_message",
        details: { reason: "asset_required", kind },
      });
    }
    const note = await call(fixture, "card.create", {
      kind: "note",
      title: "純文字",
      body: "內文\n",
      clientRequestId: `create-note-${Math.random()}`,
    });
    expect((note["card"] as { cardId: string }).cardId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  }, 20_000);
});

describe("card_create 工具", () => {
  async function createImageTool(fixture: Fixture) {
    const bundle = createCardToolBundle({ library: fixture.library });
    const tool = bundle.tools.find((candidate) => candidate.name === "card_create");
    if (tool === undefined) throw new Error("找不到 card_create 工具");
    return tool;
  }

  it("image 沒有 assetBlobId 時回錯誤，不會寫出一張指不到原檔的卡", async () => {
    const fixture = await makeFixture();
    const tool = await createImageTool(fixture);
    const outcome = await tool.execute({ kind: "image", title: "沒有原檔", body: "圖\n" });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false ? outcome.message : "").toContain("原檔");
  }, 20_000);

  it("帶了 assetBlobId 就寫進 frontmatter 的 asset", async () => {
    const fixture = await makeFixture();
    const assets = new LocalAssetStore({
      layout: fixture.storage.layout,
      index: new CardIndexStore({ db: fixture.storage.cache }),
    });
    const stored = await assets.put({
      bytes: new TextEncoder().encode("image bytes"),
      mediaType: "image/png",
      extension: "png",
    });
    const tool = await createImageTool(fixture);
    const outcome = await tool.execute({
      kind: "image",
      title: "有原檔",
      body: "圖\n",
      assetBlobId: stored.blobId,
    });
    expect(outcome.ok).toBe(true);
    const value = (outcome.content[0] as { value: { cardId: string } }).value;
    const text = await readFile(join(fixture.folder, "cards", `${value.cardId}.md`), "utf8");
    expect(text).toContain(`asset: assets/${stored.blobId}.png`);
    expect(text).toContain(`id: ${value.cardId}`);
  }, 20_000);
});
