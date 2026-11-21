import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CardFileStore,
  CardIndexStore,
  CardVersionsStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "@cardiary/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";
import {
  CardWatcher,
  parseCardRescanIntervalMs,
  type CardWatchFactory,
} from "../../../src/modules/cards/watcher.js";
import type { ProtocolEventIntent } from "@cardiary/module-api";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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

function cardText(input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly kind?: string;
  readonly asset?: string;
  readonly omitTitle?: boolean;
}): string {
  return [
    "---",
    `id: ${input.id}`,
    `kind: ${input.kind ?? "note"}`,
    ...(input.omitTitle === true ? [] : [`title: ${input.title}`]),
    "created: 2026-01-01T00:00:00.000Z",
    ...(input.asset === undefined ? [] : [`asset: ${input.asset}`]),
    "---",
    input.body,
  ].join("\n");
}

interface Fixture {
  readonly storage: Storage;
  readonly library: CardLibrary;
  readonly files: CardFileStore;
  readonly state: CardStateStore;
  readonly events: ProtocolEventIntent[];
  readonly folder: string;
}

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close();
  }
});

async function makeFixture(clock: { now: Date } = { now: new Date() }): Promise<Fixture> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-cards-"));
  const storage = Storage.open({ path: folder, initialize: true });
  const now = (): Date => clock.now;
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
  const assets = (): LocalAssetStore =>
    new LocalAssetStore({ layout: storage.layout, index: index(), now });
  const state = new CardStateStore({ db: () => storage.state, now });
  const events: ProtocolEventIntent[] = [];
  const library = new CardLibrary({
    files,
    index,
    assets,
    state,
    now,
    emit: (intent) => events.push(intent),
  });
  await library.initialize();
  const fixture = { storage, library, files, state, events, folder };
  fixtures.push(fixture);
  return fixture;
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("條件等待逾時");
}

/** 假的監看事件源：測試自己決定何時送事件，不依賴 FSEvents 是否送達。 */
class FakeWatchSource {
  #listener: ((event: string, fileName: string | Buffer | null) => void) | null = null;
  closed = false;

  readonly factory: CardWatchFactory = (_directory, listener) => {
    this.#listener = listener;
    return {
      on: () => undefined,
      close: () => {
        this.closed = true;
      },
    };
  };

  emitChange(fileName: string): void {
    this.#listener?.("change", fileName);
  }

  emitRename(fileName: string | null): void {
    this.#listener?.("rename", fileName);
  }
}

describe("卡片庫", () => {
  it("啟動掃描索引既有卡片、清掉過期暫存檔，格式不符的標成 broken", async () => {
    const folder = await mkdtemp(join(tmpdir(), "cardiary-cards-"));
    const storage = Storage.open({ path: folder, initialize: true });
    const good = newUlid();
    await writeFile(
      join(folder, "cards", `${good}.md`),
      cardText({ id: good, title: "啟動前就在", body: "內容\n" }),
    );
    const bad = newUlid();
    await writeFile(
      join(folder, "cards", `${bad}.md`),
      `---\nid: ${bad}\nkind: note\ncreated: 2026-01-01T00:00:00.000Z\n---\n沒有標題\n`,
    );
    const temp = join(folder, "cards", `.${good}.abcdef12.tmp`);
    await writeFile(temp, "半寫入");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(temp, old, old);

    const now = (): Date => new Date();
    const index = new CardIndexStore({ db: storage.cache, now });
    const files = new CardFileStore({ layout: storage.layout, now });
    const library = new CardLibrary({
      files,
      index: () => index,
      assets: () => new LocalAssetStore({ layout: storage.layout, index, now }),
      state: new CardStateStore({ db: () => storage.state, now }),
      now,
    });
    try {
      await library.initialize();
      const page = await library.list({ limit: 200 });
      expect(page.items.map((card) => card.cardId).sort()).toEqual([good, bad].sort());
      const broken = page.items.find((card) => card.cardId === bad);
      expect(broken?.broken).toBe(true);
      expect(broken?.brokenReason).toContain("title");
      expect(index.isReady).toBe(true);
      const exists = await stat(temp).then(
        () => true,
        () => false,
      );
      expect(exists).toBe(false);
    } finally {
      storage.close();
    }
  }, 20_000);

  it("啟動掃描回收沒有引用的原檔，有引用的保留", async () => {
    const folder = await mkdtemp(join(tmpdir(), "cardiary-cards-"));
    const storage = Storage.open({ path: folder, initialize: true });
    const now = (): Date => new Date();
    const pre = new LocalAssetStore({
      layout: storage.layout,
      index: new CardIndexStore({ db: storage.cache, now }),
      now,
    });
    const orphan = await pre.put({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      extension: "png",
    });
    const keep = await pre.put({
      bytes: new Uint8Array([4, 5, 6]),
      mediaType: "image/png",
      extension: "png",
    });
    const cardId = newUlid();
    await writeFile(
      join(folder, "cards", `${cardId}.md`),
      cardText({
        id: cardId,
        title: "引用原檔",
        body: "內容\n",
        kind: "image",
        asset: `assets/${keep.blobId}.png`,
      }),
    );

    const index = new CardIndexStore({ db: storage.cache, now });
    const library = new CardLibrary({
      files: new CardFileStore({ layout: storage.layout, now }),
      index: () => index,
      assets: () => new LocalAssetStore({ layout: storage.layout, index, now }),
      state: new CardStateStore({ db: () => storage.state, now }),
      now,
      warn: (message) => {
        expect(message).not.toBe("原檔回收失敗");
      },
    });
    const exists = (path: string): Promise<boolean> =>
      stat(path).then(
        () => true,
        () => false,
      );
    try {
      await library.initialize();
      expect(await exists(join(folder, "assets", `${orphan.blobId}.png`))).toBe(false);
      expect(await exists(join(folder, "assets", `${keep.blobId}.png`))).toBe(true);
    } finally {
      storage.close();
    }
  }, 20_000);

  it("建立、補丁與刪除；補丁的 revision 不符時回 conflict 且不改檔", async () => {
    const fixture = await makeFixture();
    const { library, files } = fixture;
    const created = await library.create({
      kind: "note",
      title: "補丁測試",
      body: "第一行\n第二行\n",
    });
    expect(created.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.events.at(-1)).toMatchObject({ change: "created", cardId: created.cardId });

    const patched = await library.patch({
      cardId: created.cardId,
      baseRevision: created.revision,
      patch: { format: "unified", text: "@@ -1,2 +1,3 @@\n 第一行\n 第二行\n+第三行" },
    });
    expect(patched.body).toBe("第一行\n第二行\n第三行\n");
    expect(patched.frontmatter.updated).toBeDefined();
    expect(files.read(created.cardId)?.text).toContain("updated:");

    await expect(
      library.patch({
        cardId: created.cardId,
        baseRevision: created.revision,
        patch: { format: "unified", text: "@@ -1,1 +1,1 @@\n-第一行\n+換掉" },
      }),
    ).rejects.toMatchObject({ code: "conflict", details: { reason: "revision_mismatch" } });
    expect(files.read(created.cardId)?.text).toContain("第一行\n第二行\n第三行");

    await library.proposePatch({
      cardId: created.cardId,
      baseRevision: patched.revision,
      patch: { format: "unified", text: "@@ -1,3 +1,3 @@\n 第一行\n 第二行\n-第三行\n+待決內容" },
    });
    expect(
      fixture.storage.state.get("SELECT 1 FROM card_versions WHERE card_id = ?", created.cardId),
    ).toBeDefined();
    expect(
      fixture.storage.state.get(
        "SELECT 1 FROM pending_card_patches WHERE card_id = ?",
        created.cardId,
      ),
    ).toBeDefined();
    const deleted = await library.delete(created.cardId);
    expect(
      fixture.storage.state.get("SELECT 1 FROM card_versions WHERE card_id = ?", created.cardId),
    ).toBeUndefined();
    expect(
      fixture.storage.state.get(
        "SELECT 1 FROM pending_card_patches WHERE card_id = ?",
        created.cardId,
      ),
    ).toBeUndefined();
    for (const suffix of ["", "-wal"]) {
      const bytes = await readFile(join(fixture.folder, "state", `cardiary.sqlite${suffix}`)).catch(
        () => Buffer.alloc(0),
      );
      expect(bytes.includes(Buffer.from("待決內容"))).toBe(false);
      expect(bytes.includes(Buffer.from("第一行"))).toBe(false);
    }
    expect(deleted.deletedAssets).toBe(0);
    expect(files.read(created.cardId)).toBeUndefined();
    expect(fixture.events.at(-1)).toMatchObject({ change: "deleted", cardId: created.cardId });
  }, 20_000);

  it("指定識別碼重複建立時沿用既有檔案，只在索引缺少時補一次事件", async () => {
    const fixture = await makeFixture();
    const { library, files } = fixture;
    const cardId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const createdEvents = () =>
      fixture.events.filter((event) => event.kind === "card-changed" && event.cardId === cardId);

    const write = vi.spyOn(CardFileStore.prototype, "write");
    const first = await library.create({ cardId, kind: "note", title: "重試", body: "內容\n" });
    expect(first.cardId).toBe(cardId);
    expect(write).toHaveBeenCalledTimes(1);
    const original = files.read(cardId);
    expect(createdEvents()).toHaveLength(1);

    write.mockClear();
    const again = await library.create({ cardId, kind: "note", title: "重試", body: "內容\n" });
    expect(again.revision).toBe(first.revision);
    expect(write).not.toHaveBeenCalled();
    expect(files.read(cardId)?.text).toBe(original?.text);
    expect(createdEvents()).toHaveLength(1);
    expect((await library.list({})).items).toHaveLength(1);

    const index = new CardIndexStore({ db: fixture.storage.cache });
    index.remove(cardId);
    expect(index.get(cardId)).toBeUndefined();
    const adopted = await library.create({ cardId, kind: "note", title: "重試", body: "內容\n" });
    expect(adopted.cardId).toBe(cardId);
    expect(index.get(cardId)).toBeDefined();
    expect(createdEvents()).toHaveLength(2);
  }, 20_000);

  it("版本寫入失敗後讀取正本，自動補上可重放的檢查點", async () => {
    const { library } = await makeFixture();
    const card = await library.create({ kind: "note", title: "修復", body: "原文\n" });
    const failure = vi
      .spyOn(CardVersionsStore.prototype, "appendPatch")
      .mockImplementationOnce(() => {
        throw new Error("模擬版本寫入失敗");
      });
    try {
      const changed = await library.patch({
        cardId: card.cardId,
        baseRevision: card.revision,
        patch: { format: "unified", text: "@@ -1 +1 @@\n-原文\n+新文" },
      });
      expect(changed.body).toBe("新文\n");
      expect((await library.get(card.cardId))?.body).toBe("新文\n");
      const latest = library.listVersions(card.cardId).at(-1)!;
      expect(latest.kind).toBe("checkpoint");
      expect(library.versionBody(card.cardId, latest.versionId)).toBe("新文\n");
    } finally {
      failure.mockRestore();
    }
  });

  it("假事件源：外部編輯經去抖後重新索引並送出 card.changed（確定性）", async () => {
    const fixture = await makeFixture();
    const { library, files, folder } = fixture;
    const fake = new FakeWatchSource();
    const watcher = new CardWatcher({
      directory: files.directory,
      library,
      debounceMs: 20,
      watchFactory: fake.factory,
    });
    watcher.start();
    try {
      const cardId = newUlid();
      const cardPath = join(folder, "cards", `${cardId}.md`);
      await writeFile(cardPath, cardText({ id: cardId, title: "外部", body: "第一次\n" }));
      fake.emitChange(`${cardId}.md`);
      await watcher.flush();
      expect(
        fixture.events.find((event) => event.kind === "card-changed" && event.cardId === cardId),
      ).toMatchObject({ change: "created" });

      await writeFile(
        cardPath,
        cardText({ id: cardId, title: "外部", body: "第二次，內容比較長\n" }),
      );
      fake.emitChange(`${cardId}.md`);
      await watcher.flush();
      expect(
        fixture.events.find(
          (event) =>
            event.kind === "card-changed" && event.cardId === cardId && event.change === "updated",
        ),
      ).toBeDefined();
      expect((await library.get(cardId))?.body).toBe("第二次，內容比較長\n");

      await rm(cardPath);
      fake.emitRename(`${cardId}.md`);
      await watcher.flush();
      expect(
        fixture.events.find(
          (event) =>
            event.kind === "card-changed" && event.cardId === cardId && event.change === "deleted",
        ),
      ).toBeDefined();
      expect(await library.get(cardId)).toBeNull();
    } finally {
      watcher.stop();
      expect(fake.closed).toBe(true);
    }
  }, 20_000);

  it("假事件源：去抖視窗內的多次事件合併成一次重新索引", async () => {
    const fixture = await makeFixture();
    const { library, files, folder } = fixture;
    const fake = new FakeWatchSource();
    const watcher = new CardWatcher({
      directory: files.directory,
      library,
      // 去抖視窗拉長到 10 秒：事件自己不會觸發索引，改用 flush 強制處理
      debounceMs: 10_000,
      watchFactory: fake.factory,
    });
    watcher.start();
    try {
      const cardId = newUlid();
      await writeFile(
        join(folder, "cards", `${cardId}.md`),
        cardText({ id: cardId, title: "外部", body: "第一次\n" }),
      );
      fake.emitChange(`${cardId}.md`);
      fake.emitChange(`${cardId}.md`);
      fake.emitRename(`${cardId}.md`);
      expect(fixture.events).toHaveLength(0);
      const syncPaths = vi.spyOn(library, "syncPaths");
      await watcher.flush();
      expect(syncPaths).toHaveBeenCalledTimes(1);
      expect(syncPaths).toHaveBeenCalledWith([`${cardId}.md`]);
      expect(fixture.events.filter((event) => event.cardId === cardId)).toHaveLength(1);
    } finally {
      watcher.stop();
    }
  }, 20_000);

  it("假事件源：rename 沒有檔名時整批補掃", async () => {
    const fixture = await makeFixture();
    const { library, files, folder } = fixture;
    const fake = new FakeWatchSource();
    const watcher = new CardWatcher({
      directory: files.directory,
      library,
      debounceMs: 10_000,
      watchFactory: fake.factory,
    });
    watcher.start();
    try {
      const cardId = newUlid();
      await writeFile(
        join(folder, "cards", `${cardId}.md`),
        cardText({ id: cardId, title: "外部", body: "內容\n" }),
      );
      const rescan = vi.spyOn(library, "rescan");
      fake.emitRename(null); // rename 沒有檔名（FSEvents 偶爾只會給這種事件）
      await watcher.flush();
      expect(rescan).toHaveBeenCalledTimes(1);
      expect(
        fixture.events.some((event) => event.kind === "card-changed" && event.cardId === cardId),
      ).toBe(true);
    } finally {
      watcher.stop();
    }
  }, 20_000);

  it("補掃接管：間隔縮短後，沒有監看事件也能索引外部變更", async () => {
    const fixture = await makeFixture();
    const { library, files, folder } = fixture;
    // 永遠不送事件，模擬 FSEvents 漏接；補掃間隔縮短到 100ms
    const silent = new FakeWatchSource();
    const watcher = new CardWatcher({
      directory: files.directory,
      library,
      rescanIntervalMs: 100,
      watchFactory: silent.factory,
    });
    watcher.start();
    try {
      const cardId = newUlid();
      await writeFile(
        join(folder, "cards", `${cardId}.md`),
        cardText({ id: cardId, title: "外部", body: "內容\n" }),
      );
      await waitFor(
        () =>
          fixture.events.some((event) => event.kind === "card-changed" && event.cardId === cardId),
        5000,
      );
      expect((await library.get(cardId))?.body).toBe("內容\n");
    } finally {
      watcher.stop();
    }
  }, 20_000);

  it("parseCardRescanIntervalMs：只接受正整數毫秒", () => {
    expect(parseCardRescanIntervalMs(undefined)).toBeUndefined();
    expect(parseCardRescanIntervalMs("")).toBeUndefined();
    expect(parseCardRescanIntervalMs("abc")).toBeUndefined();
    expect(parseCardRescanIntervalMs("0")).toBeUndefined();
    expect(parseCardRescanIntervalMs("-1")).toBeUndefined();
    expect(parseCardRescanIntervalMs("10.5")).toBeUndefined();
    expect(parseCardRescanIntervalMs("1000")).toBe(1000);
    expect(parseCardRescanIntervalMs(" 2500 ")).toBe(2500);
  });

  // 真實 fs.watch 冒煙測試：只驗「真的接上了 fs.watch」這件事，行為正確性由
  // 上面的假事件源測試覆蓋。FSEvents 在平行測試負載下偶爾完全不送事件
  // （實測約 2/10 次失敗，等待放寬到 10 秒也一樣），所以加 retry: 3；
  // 重試三次仍失敗代表 fs.watch 接線真的壞了，不是負載造成的。
  it("真實 fs.watch：外部編輯後索引跟上（冒煙）", { retry: 3, timeout: 20_000 }, async () => {
    const fixture = await makeFixture();
    const { library, files, folder } = fixture;
    const watcher = new CardWatcher({ directory: files.directory, library, debounceMs: 50 });
    watcher.start();
    try {
      const cardId = newUlid();
      const cardPath = join(folder, "cards", `${cardId}.md`);
      await writeFile(cardPath, cardText({ id: cardId, title: "外部", body: "第一次\n" }));
      await waitFor(
        () =>
          fixture.events.some((event) => event.kind === "card-changed" && event.cardId === cardId),
        5000,
      );

      await writeFile(
        cardPath,
        cardText({ id: cardId, title: "外部", body: "第二次，內容比較長\n" }),
      );
      await waitFor(
        () =>
          fixture.events.some(
            (event) =>
              event.kind === "card-changed" &&
              event.cardId === cardId &&
              event.change === "updated",
          ),
        5000,
      );
      expect((await library.get(cardId))?.body).toBe("第二次，內容比較長\n");

      await rm(cardPath);
      await waitFor(
        () =>
          fixture.events.some(
            (event) =>
              event.kind === "card-changed" &&
              event.cardId === cardId &&
              event.change === "deleted",
          ),
        5000,
      );
      expect(await library.get(cardId)).toBeNull();
    } finally {
      watcher.stop();
    }
  });

  it("兩張卡引用同一個原檔：刪一張原檔還在，刪兩張才消失", async () => {
    const fixture = await makeFixture();
    const { library, storage } = fixture;
    const index = new CardIndexStore({ db: storage.cache });
    const assets = new LocalAssetStore({ layout: storage.layout, index });
    const stored = await assets.put({
      bytes: new TextEncoder().encode("fake image bytes"),
      mediaType: "image/png",
      extension: "png",
    });
    expect(stored.blobId).toMatch(/^[0-9a-f]{64}$/);

    const first = await library.create({
      kind: "image",
      title: "第一張圖",
      body: "圖一\n",
      assetBlobId: stored.blobId,
    });
    const second = await library.create({
      kind: "image",
      title: "第二張圖",
      body: "圖二\n",
      assetBlobId: stored.blobId,
    });
    expect(fixture.files.read(first.cardId)?.text).toContain(`assets/${stored.blobId}.png`);

    expect((await library.delete(first.cardId)).deletedAssets).toBe(0);
    expect(assets.filesFor(stored.blobId)).toHaveLength(1);

    expect((await library.delete(second.cardId)).deletedAssets).toBe(1);
    expect(assets.filesFor(stored.blobId)).toHaveLength(0);
  }, 20_000);

  it("一張卡變成 broken 後刪另一張，原檔還在：壞掉的檔案仍然算引用", async () => {
    const fixture = await makeFixture();
    const { library, storage, folder } = fixture;
    const index = new CardIndexStore({ db: storage.cache });
    const assets = new LocalAssetStore({ layout: storage.layout, index });
    const stored = await assets.put({
      bytes: new TextEncoder().encode("shared image"),
      mediaType: "image/png",
      extension: "png",
    });
    const broken = await library.create({
      kind: "image",
      title: "會壞掉的圖",
      body: "圖\n",
      assetBlobId: stored.blobId,
    });
    const other = await library.create({
      kind: "image",
      title: "另一張圖",
      body: "圖\n",
      assetBlobId: stored.blobId,
    });

    // 外部編輯把 title 拿掉：格式不符，但 asset 那行還在。
    const brokenPath = join(folder, "cards", `${broken.cardId}.md`);
    await writeFile(
      brokenPath,
      cardText({
        id: broken.cardId,
        title: "會壞掉的圖",
        body: "圖\n",
        kind: "image",
        asset: `assets/${stored.blobId}.png`,
        omitTitle: true,
      }),
    );
    await library.syncPaths([`${broken.cardId}.md`]);
    expect(library.rowOf(broken.cardId)?.broken).toBe(true);
    expect(library.rowOf(broken.cardId)?.assetId).toBe(stored.blobId);

    expect((await library.delete(other.cardId)).deletedAssets).toBe(0);
    expect(assets.filesFor(stored.blobId)).toHaveLength(1);
    expect(await readFile(brokenPath, "utf8")).toContain(`assets/${stored.blobId}.png`);
  }, 20_000);

  it("外部新增的卡片引用同一個原檔時，刪掉原持有卡也不刪原檔", async () => {
    const fixture = await makeFixture();
    const { library, storage, folder } = fixture;
    const index = new CardIndexStore({ db: storage.cache });
    const assets = new LocalAssetStore({ layout: storage.layout, index });
    const stored = await assets.put({
      bytes: new TextEncoder().encode("externally shared"),
      mediaType: "image/png",
      extension: "png",
    });
    const holder = await library.create({
      kind: "image",
      title: "原本持有的卡",
      body: "圖\n",
      assetBlobId: stored.blobId,
    });
    // 使用者直接放一張新卡進來，監看還在去抖（500 毫秒），索引不知道它。
    const externalId = newUlid(1);
    await writeFile(
      join(folder, "cards", `${externalId}.md`),
      cardText({
        id: externalId,
        title: "外部新增的卡",
        body: "圖\n",
        kind: "image",
        asset: `assets/${stored.blobId}.png`,
      }),
    );
    expect(library.rowOf(externalId)).toBeUndefined();

    expect((await library.delete(holder.cardId)).deletedAssets).toBe(0);
    expect(assets.filesFor(stored.blobId)).toHaveLength(1);

    // 索引跟上之後，刪掉最後一個引用才回收。
    await library.syncPaths([`${externalId}.md`]);
    expect((await library.delete(externalId)).deletedAssets).toBe(1);
    expect(assets.filesFor(stored.blobId)).toHaveLength(0);
  }, 20_000);

  it("外部改過 asset 的卡：刪卡時檔案與索引記的原檔都納入回收", async () => {
    const fixture = await makeFixture();
    const { library, storage, folder } = fixture;
    const index = new CardIndexStore({ db: storage.cache });
    const assets = new LocalAssetStore({ layout: storage.layout, index });
    const before = await assets.put({
      bytes: new TextEncoder().encode("before"),
      mediaType: "image/png",
      extension: "png",
    });
    const after = await assets.put({
      bytes: new TextEncoder().encode("after"),
      mediaType: "image/png",
      extension: "png",
    });
    const card = await library.create({
      kind: "image",
      title: "換過原檔的卡",
      body: "圖\n",
      assetBlobId: before.blobId,
    });
    // 外部把 asset 指到另一個原檔；索引還記著舊的。
    await writeFile(
      join(folder, "cards", `${card.cardId}.md`),
      cardText({
        id: card.cardId,
        title: "換過原檔的卡",
        body: "圖\n",
        kind: "image",
        asset: `assets/${after.blobId}.png`,
      }),
    );

    expect((await library.delete(card.cardId)).deletedAssets).toBe(2);
    expect(assets.filesFor(before.blobId)).toHaveLength(0);
    expect(assets.filesFor(after.blobId)).toHaveLength(0);
  }, 20_000);

  it("image 與 audio 沒有原檔時拒絕建立，note 不受影響", async () => {
    const fixture = await makeFixture();
    const { library } = fixture;
    await expect(
      library.create({ kind: "image", title: "沒有原檔", body: "圖\n" }),
    ).rejects.toMatchObject({ code: "invalid_message", details: { reason: "asset_required" } });
    await expect(
      library.create({ kind: "audio", title: "沒有原檔", body: "聲音\n" }),
    ).rejects.toMatchObject({ code: "invalid_message", details: { reason: "asset_required" } });
    const note = await library.create({ kind: "note", title: "純文字", body: "內容\n" });
    expect(note.frontmatter.asset).toBeUndefined();
  }, 20_000);

  it("補丁改寫時保留外部檔的欄位順序、縮排與註解", async () => {
    const fixture = await makeFixture();
    const { library, files, folder } = fixture;
    const cardId = newUlid();
    const original = [
      "---",
      "# 使用者的備註",
      `id: ${cardId}`,
      "kind: note # 種類",
      "x-custom: 保留",
      "title: 外部檔",
      "created: 2026-01-01T00:00:00.000Z",
      "x-block:",
      "  nested: yes",
      "---",
      "原本的內文\n",
    ].join("\n");
    await writeFile(join(folder, "cards", `${cardId}.md`), original);
    await library.syncPaths([`${cardId}.md`]);

    const current = await library.get(cardId);
    if (current === null) throw new Error("讀不到卡片");
    await library.patch({
      cardId,
      baseRevision: current.revision,
      patch: { format: "unified", text: "@@ -1,1 +1,2 @@\n 原本的內文\n+多一行" },
    });

    const text = files.read(cardId)?.text ?? "";
    expect(text).toContain("# 使用者的備註\nid:");
    expect(text).toContain("kind: note # 種類\n");
    expect(text).toContain("x-custom: 保留\n");
    expect(text).toContain("x-block:\n  nested: yes\n");
    expect(text).not.toContain('created: "');
    // 未知欄位維持在原本的位置：x-自訂 在 title 之前、x-區塊 在 created 之後。
    expect(text.indexOf("x-custom")).toBeLessThan(text.indexOf("title:"));
    expect(text.indexOf("x-block")).toBeGreaterThan(text.indexOf("created:"));
    expect(text.indexOf("updated:")).toBeGreaterThan(text.indexOf("created:"));
    expect(text.indexOf("updated:")).toBeLessThan(text.indexOf("x-block:"));
  }, 20_000);

  it("索引還沒完成時跳過原檔回收", async () => {
    const fixture = await makeFixture();
    const { library, storage } = fixture;
    const index = new CardIndexStore({ db: storage.cache });
    const assets = new LocalAssetStore({ layout: storage.layout, index });
    const stored = await assets.put({
      bytes: new TextEncoder().encode("audio bytes"),
      mediaType: "audio/mp4",
      extension: "m4a",
    });
    const card = await library.create({
      kind: "audio",
      title: "錄音",
      body: "錄音\n",
      assetBlobId: stored.blobId,
    });
    index.setReady(false);
    try {
      expect((await library.delete(card.cardId)).deletedAssets).toBe(0);
      expect(assets.filesFor(stored.blobId)).toHaveLength(1);
    } finally {
      index.setReady(true);
    }
  }, 20_000);

  it("保鮮寫 card_state；對話引用與載入寫 conversation_cards 與 card_loads", async () => {
    const fixture = await makeFixture();
    const { library, storage } = fixture;
    const card = await library.create({ kind: "note", title: "狀態", body: "內容\n" });
    expect(library.freshnessOf(card.cardId)).toBe(100);

    storage.state.run(
      "UPDATE card_state SET freshness = 25, freshness_at = ? WHERE card_id = ?",
      new Date(Date.now() - 30 * 86_400_000).toISOString(),
      card.cardId,
    );
    // 讀取當下計算：30 天前 25，現在約剩一半。
    expect(library.freshnessOf(card.cardId)).toBeCloseTo(12.5, 1);
    expect(await library.refresh(card.cardId)).toBe(100);
    expect(library.freshnessOf(card.cardId)).toBe(100);

    await library.get(card.cardId, { conversationId: "01CONVERSATION000000000000AA" });
    const reference = storage.state.get<{ load_count: number }>(
      "SELECT load_count FROM conversation_cards WHERE conversation_id = ? AND card_id = ?",
      "01CONVERSATION000000000000AA",
      card.cardId,
    );
    expect(reference).toBeDefined();

    await library.noteConversationLoad({
      conversationId: "01CONVERSATION000000000000AA",
      cardId: card.cardId,
    });
    const loads = storage.state.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_loads WHERE card_id = ? AND counts_as_load = 1",
      card.cardId,
    );
    expect(Number(loads?.n)).toBe(1);
  }, 20_000);

  it("開局發牌載入既有卡（linkToConversation=false）不綁對話專屬引用，會回滿 100 且不變孤兒", async () => {
    const fixture = await makeFixture();
    const { library, storage } = fixture;
    const card = await library.create({
      kind: "memory",
      title: "既有記憶",
      body: "原本已存在\n",
      allowSystemKinds: true,
    });

    storage.state.run(
      "UPDATE card_state SET freshness = 20, freshness_at = ? WHERE card_id = ?",
      new Date(Date.now() - 30 * 86_400_000).toISOString(),
      card.cardId,
    );
    expect(library.freshnessOf(card.cardId)).toBeLessThan(20);

    await library.noteConversationLoad({
      conversationId: "01CONVERSATION000000000000BB",
      cardId: card.cardId,
      kind: "deal",
      linkToConversation: false,
    });

    expect(library.freshnessOf(card.cardId)).toBe(100);
    const refs = storage.state.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM conversation_cards WHERE conversation_id = ? AND card_id = ?",
      "01CONVERSATION000000000000BB",
      card.cardId,
    );
    expect(Number(refs?.n)).toBe(0);
    const dealLoad = storage.state.get<{ kind: string; conversation_id: string | null }>(
      "SELECT kind, conversation_id FROM card_loads WHERE card_id = ? AND counts_as_load = 1",
      card.cardId,
    );
    expect(dealLoad).toEqual({ kind: "deal", conversation_id: null });
  }, 20_000);

  it("不重啟、把時間推進，新鮮度會隨讀取時間下降；卡片檔位元組不變", async () => {
    const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
    const fixture = await makeFixture(clock);
    const { library, files, storage } = fixture;
    const card = await library.create({ kind: "note", title: "時間卡", body: "會老化\n" });
    expect(library.freshnessOf(card.cardId)).toBe(100);
    const before = files.read(card.cardId)?.text;
    const bytesBefore = await readFile(join(fixture.folder, "cards", `${card.cardId}.md`));

    clock.now = new Date("2026-01-16T00:00:00.000Z"); // 半個半衰期
    const halfLife = library.freshnessOf(card.cardId);
    expect(halfLife).toBeCloseTo(100 * Math.SQRT1_2, 3);

    clock.now = new Date("2026-03-02T00:00:00.000Z"); // 兩個半衰期
    const twoHalfLives = library.freshnessOf(card.cardId);
    expect(twoHalfLives).toBeCloseTo(25, 2);
    expect(twoHalfLives).toBeLessThan(halfLife);

    // 讀取只計算不寫回；卡片檔不動。
    expect(files.read(card.cardId)?.text).toBe(before);
    expect(await readFile(join(fixture.folder, "cards", `${card.cardId}.md`))).toEqual(bytesBefore);
    const row = storage.state.get<{ freshness: number }>(
      "SELECT freshness FROM card_state WHERE card_id = ?",
      card.cardId,
    );
    expect(Number(row?.freshness)).toBe(100);
  }, 20_000);

  it("重建索引：刪掉快取後 rebuild 得到同樣的搜尋結果", async () => {
    const fixture = await makeFixture();
    const { library } = fixture;
    const target = await library.create({
      kind: "note",
      title: "重建目標",
      body: "中華民國臺灣的卡片內容\n",
    });
    const before = await library.search({ query: "卡片內容" });
    expect(before.items.map((hit) => hit.card.cardId)).toContain(target.cardId);

    const rebuilt = await library.rebuild();
    expect(rebuilt.indexed).toBeGreaterThan(0);
    const after = await library.search({ query: "卡片內容" });
    expect(after.items.map((hit) => hit.card.cardId)).toContain(target.cardId);
  }, 20_000);
});
