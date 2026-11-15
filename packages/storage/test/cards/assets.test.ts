import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalAssetStore } from "../../src/cards/assets.js";
import { CardIndexStore, type IndexedCard } from "../../src/cards/index-store.js";
import { Database } from "../../src/db.js";
import { StorageError } from "../../src/errors.js";
import { FolderLayout } from "../../src/paths.js";
import { openCacheDatabase } from "../../src/state-schema.js";
import { createTempRoot, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

const CARD_A = "01JCX8Q3W7Z9K5V2N4M6P8R0T1".toUpperCase();
const CARD_B = "01JCX8Q3W7Z9K5V2N4M6P8R0T2".toUpperCase();
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

interface Fixture {
  readonly temp: TempRoot;
  readonly layout: FolderLayout;
  readonly index: CardIndexStore;
  readonly assets: LocalAssetStore;
  readonly db: Database;
}

function setup(label = "cards-assets"): Fixture {
  const temp = createTempRoot(label);
  cleanups.push(temp.cleanup);
  const layout = new FolderLayout(temp.folder);
  const cachePath = path.join(temp.folder, "cache", "index.sqlite");
  mkdirSync(path.dirname(cachePath), { recursive: true });
  const { db } = openCacheDatabase({ filePath: cachePath });
  cleanups.push(() => db.close());
  const index = new CardIndexStore({ db });
  return { temp, layout, index, assets: new LocalAssetStore({ layout, index }), db };
}

function card(id: string, overrides: Partial<IndexedCard> = {}): IndexedCard {
  return {
    cardId: id,
    path: `cards/${id}.md`,
    mtimeMs: 1,
    sizeBytes: 1,
    contentHash: `hash-${id}`,
    indexedAt: "2026-11-15T00:00:00.000Z",
    broken: false,
    revision: `rev-${id}`,
    kind: "image",
    title: `圖 ${id.slice(-2)}`,
    body: "",
    tags: [],
    sources: [],
    links: [],
    persona: "default",
    createdAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
}

function assetFiles(fixture: Fixture): string[] {
  try {
    return readdirSync(path.join(fixture.temp.folder, "assets")).sort();
  } catch {
    return [];
  }
}

/** 在 `cards/` 直接放一份卡片檔，模擬使用者在外部編輯器寫入。 */
function writeCard(fixture: Fixture, cardId: string, text: string): string {
  const directory = path.join(fixture.temp.folder, "cards");
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${cardId}.md`);
  writeFileSync(target, text);
  return target;
}

function cardFile(cardId: string, kind: string, blobId?: string): string {
  return [
    "---",
    `id: ${cardId}`,
    `kind: ${kind}`,
    "title: 卡片",
    "created: 2026-11-14T00:00:00.000Z",
    ...(blobId === undefined ? [] : [`asset: assets/${blobId}.png`]),
    "---",
    "內文\n",
  ].join("\n");
}

describe("原檔的寫入", () => {
  it("以內容雜湊命名，同樣的內容只留一份，讀得回原位元組", async () => {
    const fixture = setup();
    const first = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    expect(first.blobId).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sizeBytes).toBe(PNG_BYTES.length);
    expect(first.relPath).toBe(`assets/${first.blobId}.png`);
    expect(assetFiles(fixture)).toEqual([`${first.blobId}.png`]);
    expect(Array.from(fixture.assets.read(first.blobId) ?? [])).toEqual(Array.from(PNG_BYTES));

    const second = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    expect(second.blobId).toBe(first.blobId);
    expect(assetFiles(fixture)).toEqual([`${first.blobId}.png`]);
    // 暫存區沒有留下半成品。
    expect(readdirSync(path.join(fixture.temp.folder, "tmp"))).toEqual([]);
  });

  it("同樣內容不同副檔名是同一個雜湊、兩個檔案", async () => {
    const fixture = setup();
    const png = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    const jpg = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/jpeg",
      extension: "jpg",
    });
    expect(jpg.blobId).toBe(png.blobId);
    expect(assetFiles(fixture)).toEqual([`${png.blobId}.jpg`, `${png.blobId}.png`].sort());
    expect(fixture.assets.filesFor(png.blobId)).toHaveLength(2);
  });

  it("逐段串流的內容與一次寫入的結果相同", async () => {
    const fixture = setup();
    const whole = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield PNG_BYTES.slice(0, 4);
      yield PNG_BYTES.slice(4, 7);
      yield PNG_BYTES.slice(7);
    }
    const streamed = await fixture.assets.put({
      bytes: chunks(),
      mediaType: "image/png",
      extension: "png",
    });
    expect(streamed.blobId).toBe(whole.blobId);
  });

  it("寫入時記下媒體類型，之後補的尺寸不會被重複匯入蓋掉", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    expect(fixture.index.getAssetMeta(blobId)).toEqual({
      assetId: blobId,
      mediaType: "image/png",
      sizeBytes: PNG_BYTES.length,
    });

    fixture.index.putAssetMeta({
      assetId: blobId,
      mediaType: "image/png",
      sizeBytes: PNG_BYTES.length,
      width: 640,
      height: 480,
    });
    await fixture.assets.put({ bytes: PNG_BYTES, mediaType: "image/png", extension: "png" });
    expect(fixture.index.getAssetMeta(blobId)?.width).toBe(640);
  });

  it("不合法的雜湊與副檔名被拒絕", async () => {
    const fixture = setup();
    expect(() => fixture.assets.read("../etc/passwd")).toThrowError(StorageError);
    await expect(
      fixture.assets.put({ bytes: PNG_BYTES, mediaType: "image/png", extension: "../x" }),
    ).rejects.toThrowError(StorageError);
    expect(assetFiles(fixture)).toEqual([]);
  });

  it("讀不存在的原檔回 undefined", () => {
    const fixture = setup();
    expect(fixture.assets.read("0".repeat(64))).toBeUndefined();
    expect(fixture.assets.sizeOf("0".repeat(64))).toBeUndefined();
  });

  it("檔案已存在但內容不同時不覆寫，維持原檔", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    const target = path.join(fixture.temp.folder, "assets", `${blobId}.png`);
    // 直接放一份同名的假檔，模擬外部改動；再次匯入同內容不應覆寫。
    writeFileSync(target, "changed");
    await fixture.assets.put({ bytes: PNG_BYTES, mediaType: "image/png", extension: "png" });
    expect(readFileSync(target, "utf8")).toBe("changed");
  });
});

describe("原檔的回收", () => {
  it("索引還沒完成時跳過回收，即使沒有卡片引用", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    expect(fixture.index.isReady).toBe(false);
    expect(fixture.assets.release(blobId)).toBe("skipped");
    expect(assetFiles(fixture)).toHaveLength(1);
  });

  it("還有卡片引用時保留，最後一個引用消失才刪檔與中繼資料", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    fixture.index.rebuild([card(CARD_A, { assetId: blobId }), card(CARD_B, { assetId: blobId })]);

    expect(fixture.assets.release(blobId)).toBe("retained");
    fixture.index.remove(CARD_A);
    expect(fixture.assets.release(blobId)).toBe("retained");
    expect(assetFiles(fixture)).toHaveLength(1);

    fixture.index.remove(CARD_B);
    expect(fixture.assets.release(blobId)).toBe("deleted");
    expect(assetFiles(fixture)).toEqual([]);
    expect(fixture.index.getAssetMeta(blobId)).toBeUndefined();
  });

  it("索引完成而且沒有引用時直接刪除", async () => {
    const fixture = setup();
    fixture.index.rebuild([]);
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    expect(fixture.assets.release(blobId)).toBe("deleted");
    expect(fixture.assets.release(blobId)).toBe("deleted");
  });

  it("索引沒記到、卡片檔還寫著這個原檔時保留", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    // 外部放進來的卡片檔，索引還沒掃到。
    writeCard(
      fixture,
      CARD_A,
      cardFile(CARD_A, "note").replace("---\n", `---\nasset: assets/${blobId}.png\n`),
    );
    fixture.index.rebuild([card(CARD_B, { kind: "note" })]);

    expect(fixture.assets.release(blobId)).toBe("retained");
    expect(assetFiles(fixture)).toEqual([`${blobId}.png`]);
  });

  it("格式不符的卡片檔仍然算引用：檔案裡的 asset 行就是引用", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    // 缺 title 的 broken 檔，還寫著 asset。
    writeCard(
      fixture,
      CARD_A,
      `---\nid: ${CARD_A}\nkind: image\nasset: assets/${blobId}.png\ncreated: 2026-11-14T00:00:00.000Z\n---\n內文\n`,
    );
    fixture.index.rebuild([
      {
        cardId: CARD_A,
        path: `cards/${CARD_A}.md`,
        mtimeMs: 1,
        sizeBytes: 1,
        contentHash: "hash-a",
        indexedAt: "2026-11-15T00:00:00.000Z",
        broken: true,
        brokenReason: "title 是必填欄位",
      },
    ]);

    expect(fixture.assets.release(blobId)).toBe("retained");
    expect(assetFiles(fixture)).toEqual([`${blobId}.png`]);
  });

  it("索引與卡片檔都沒有引用才刪除，兩個檔案一起刪", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "jpg",
    });
    writeCard(fixture, CARD_A, cardFile(CARD_A, "note"));
    fixture.index.rebuild([card(CARD_A, { kind: "note" })]);

    expect(fixture.assets.release(blobId)).toBe("deleted");
    expect(assetFiles(fixture)).toEqual([]);
  });

  it("卡片檔把雜湊寫成大寫時仍然算引用", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    // APFS 大小寫不敏感：雜湊全大寫指到的仍是同一個原檔。
    writeCard(
      fixture,
      CARD_A,
      cardFile(CARD_A, "image", blobId).replaceAll(blobId, blobId.toUpperCase()),
    );
    fixture.index.rebuild([card(CARD_B, { kind: "note" })]);

    expect(fixture.assets.release(blobId)).toBe("retained");
    expect(assetFiles(fixture)).toEqual([`${blobId}.png`]);
  });

  it("卡片檔讀不到時跳過回收，權限修好後可以回收", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    const target = writeCard(fixture, CARD_A, cardFile(CARD_A, "note"));
    fixture.index.rebuild([card(CARD_B, { kind: "note" })]);

    chmodSync(target, 0o000);
    cleanups.push(() => chmodSync(target, 0o600));
    try {
      expect(fixture.assets.release(blobId)).toBe("skipped");
      expect(fixture.assets.sweep()).toMatchObject({ skipped: true });
      expect(assetFiles(fixture)).toEqual([`${blobId}.png`]);
    } finally {
      chmodSync(target, 0o600);
    }

    expect(fixture.assets.release(blobId)).toBe("deleted");
    expect(assetFiles(fixture)).toEqual([]);
  });

  it("整批回收：沒有引用的原檔被刪掉，有引用的留著", async () => {
    const fixture = setup();
    const orphan = await fixture.assets.put({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      extension: "png",
    });
    const unrelated = await fixture.assets.put({
      bytes: new Uint8Array([4, 5, 6]),
      mediaType: "image/jpeg",
      extension: "jpg",
    });
    const keep = await fixture.assets.put({
      bytes: new Uint8Array([7, 8, 9]),
      mediaType: "image/png",
      extension: "png",
    });
    // 卡片檔只引用 keep，索引還沒掃到它（模擬外部放進來的檔案）。
    writeCard(fixture, CARD_A, cardFile(CARD_A, "image", keep.blobId));
    fixture.index.rebuild([]);

    const result = fixture.assets.sweep();

    expect(result).toMatchObject({ scanned: 3, deleted: 2, skipped: false });
    expect(assetFiles(fixture)).toEqual([`${keep.blobId}.png`]);
    expect(fixture.index.getAssetMeta(orphan.blobId)).toBeUndefined();
    expect(fixture.index.getAssetMeta(unrelated.blobId)).toBeUndefined();
    expect(fixture.index.getAssetMeta(keep.blobId)).toBeDefined();
  });

  it("整批回收：引用不分大小寫，大寫雜湊的原檔保留", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    writeCard(
      fixture,
      CARD_A,
      cardFile(CARD_A, "image", blobId).replaceAll(blobId, blobId.toUpperCase()),
    );
    fixture.index.rebuild([]);

    expect(fixture.assets.sweep()).toMatchObject({ deleted: 0, skipped: false });
    expect(assetFiles(fixture)).toEqual([`${blobId}.png`]);
  });

  it("整批回收：索引還沒完成時跳過，不動任何原檔", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    expect(fixture.index.isReady).toBe(false);

    expect(fixture.assets.sweep()).toEqual({ scanned: 0, deleted: 0, skipped: true });
    expect(assetFiles(fixture)).toEqual([`${blobId}.png`]);
  });

  it("整批回收：沒有 cards/ 資料夾時，沒有引用的原檔全部刪掉", async () => {
    const fixture = setup();
    await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    fixture.index.rebuild([]);

    expect(fixture.assets.sweep()).toMatchObject({ scanned: 1, deleted: 1 });
    expect(assetFiles(fixture)).toEqual([]);
  });

  it("兩張卡片檔共用同一個原檔：刪掉其中一張的索引列仍然保留", async () => {
    const fixture = setup();
    const { blobId } = await fixture.assets.put({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      extension: "png",
    });
    writeCard(fixture, CARD_A, cardFile(CARD_A, "image", blobId));
    writeCard(fixture, CARD_B, cardFile(CARD_B, "image", blobId));
    fixture.index.rebuild([card(CARD_B, { assetId: blobId })]);

    expect(fixture.assets.release(blobId)).toBe("retained");
    rmSync(path.join(fixture.temp.folder, "cards", `${CARD_A}.md`));
    // 剩下那張已經不在索引裡，但檔案還在，仍然算引用。
    expect(fixture.assets.release(blobId)).toBe("retained");
    rmSync(path.join(fixture.temp.folder, "cards", `${CARD_B}.md`));
    // 索引還留著剛才那張卡的列：說有引用就保留，寧可晚一點刪。
    expect(fixture.assets.release(blobId)).toBe("retained");
    fixture.index.remove(CARD_B);
    expect(fixture.assets.release(blobId)).toBe("deleted");
  });
});
