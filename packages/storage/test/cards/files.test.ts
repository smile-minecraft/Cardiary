import { chmodSync, mkdirSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CardFileStore, isTempFileName } from "../../src/cards/files.js";
import { FolderLayout } from "../../src/paths.js";
import { StorageError } from "../../src/errors.js";
import { createTempRoot, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

const CARD_A = "01JCX8Q3W7Z9K5V2N4M6P8R0T1";
const CARD_B = "01JCX8Q3W7Z9K5V2N4M6P8R0T2";

function setup(label = "cards-files"): { temp: TempRoot; store: CardFileStore; now: Date } {
  const temp = createTempRoot(label);
  cleanups.push(temp.cleanup);
  const now = new Date("2026-11-15T04:00:00.000Z");
  const store = new CardFileStore({
    layout: new FolderLayout(temp.folder),
    now: () => now,
  });
  store.ensureDirectory();
  return { temp, store, now };
}

describe("卡片檔的讀寫", () => {
  it("寫入後讀回原樣，檔名是 <id>.md，資料夾沒有殘留暫存檔", () => {
    const { store, temp } = setup();
    const text = "---\nid: 01JCX8Q3W7Z9K5V2N4M6P8R0T1\n---\n\n第一行\n第二行\n";

    const entry = store.write({ cardId: CARD_A, text });
    expect(entry.fileName).toBe(`${CARD_A}.md`);
    expect(readdirSync(path.join(temp.folder, "cards"))).toEqual([`${CARD_A}.md`]);

    const read = store.read(CARD_A);
    expect(read?.text).toBe(text);
    expect(read?.sizeBytes).toBe(Buffer.byteLength(text));
    expect(store.list()).toEqual([
      expect.objectContaining({ cardId: CARD_A, fileName: `${CARD_A}.md` }),
    ]);
  });

  it("覆寫換成新內容，舊版不會留下來", () => {
    const { store } = setup();
    store.write({ cardId: CARD_A, text: "舊版" });
    store.write({ cardId: CARD_A, text: "新版" });
    expect(store.read(CARD_A)?.text).toBe("新版");
    expect(store.list()).toHaveLength(1);
  });

  it("檔名大小寫不影響；id 一律以正規化的大寫寫入", () => {
    const { store } = setup();
    store.write({ cardId: CARD_A.toLowerCase(), text: "x" });
    expect(store.list()[0]?.fileName).toBe(`${CARD_A}.md`);
    expect(store.read(CARD_A.toLowerCase())?.text).toBe("x");
  });

  it("讀不到的卡片回 undefined，不是丟錯", () => {
    const { store } = setup();
    expect(store.read(CARD_B)).toBeUndefined();
    expect(store.remove(CARD_B)).toBe(false);
  });

  it("CRLF 的內容原樣保存，寫入不自己改換行", () => {
    const { store } = setup();
    const crlf = "---\r\nid: a\r\n---\r\nbody\r\n";
    store.write({ cardId: CARD_A, text: crlf });
    expect(store.read(CARD_A)?.text).toBe(crlf);
  });

  it("不是 ULID 的識別碼與路徑穿越都被拒絕，寫入不會發生", () => {
    const { store, temp } = setup();
    expect(() => store.write({ cardId: "../../etc/passwd", text: "x" })).toThrowError(StorageError);
    expect(() => store.write({ cardId: "not-a-ulid", text: "x" })).toThrowError(StorageError);
    expect(readdirSync(path.join(temp.folder, "cards"))).toEqual([]);
  });

  it("寫入失敗時不留下自己的暫存檔", () => {
    const { store, temp } = setup();
    const directory = path.join(temp.folder, "cards");
    chmodSync(directory, 0o500);
    try {
      expect(() => store.write({ cardId: CARD_A, text: "x" })).toThrowError(StorageError);
    } finally {
      chmodSync(directory, 0o700);
    }
    expect(readdirSync(directory)).toEqual([]);
  });
});

describe("卡片資料夾的掃描", () => {
  it("只列一般檔案：暫存檔、隱藏檔、目錄與符號連結都不算卡片", () => {
    const { store, temp } = setup();
    const directory = path.join(temp.folder, "cards");
    store.write({ cardId: CARD_A, text: "a" });
    writeFileSync(path.join(directory, `.${CARD_B}.0123abcd.tmp`), "temp");
    writeFileSync(path.join(directory, ".DS_Store"), "junk");
    writeFileSync(path.join(directory, "notes.txt"), "not a card");
    mkdirSync(path.join(directory, `${CARD_B}.md`));
    const outside = path.join(temp.out, "outside.md");
    writeFileSync(outside, "outside");
    symlinkSync(outside, path.join(directory, "01JCX8Q3W7Z9K5V2N4M6P8R0T3.md"));

    expect(store.list().map((entry) => entry.cardId)).toEqual([CARD_A]);
    expect(store.read("01JCX8Q3W7Z9K5V2N4M6P8R0T3")).toBeUndefined();
  });

  it("清掉超過一小時的暫存檔，未滿一小時與其他檔名不動", () => {
    const { store, temp, now } = setup();
    const directory = path.join(temp.folder, "cards");
    const stale = path.join(directory, `.${CARD_A}.aaaabbbb.tmp`);
    const fresh = path.join(directory, `.${CARD_B}.ccccdddd.tmp`);
    const other = path.join(directory, ".cache-note");
    writeFileSync(stale, "stale");
    writeFileSync(fresh, "fresh");
    writeFileSync(other, "other");
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    utimesSync(stale, twoHoursAgo, twoHoursAgo);
    utimesSync(other, twoHoursAgo, twoHoursAgo);

    const removed = store.cleanupTempFiles();
    expect(removed).toEqual([`.${CARD_A}.aaaabbbb.tmp`]);
    expect(isTempFileName(`.${CARD_A}.aaaabbbb.tmp`)).toBe(true);
    expect(readdirSync(directory).sort()).toEqual(
      [`.${CARD_B}.ccccdddd.tmp`, ".cache-note"].sort(),
    );
  });

  it("cards/ 不存在時，列出與清理都回空集合", () => {
    const temp = createTempRoot("cards-missing");
    cleanups.push(temp.cleanup);
    const store = new CardFileStore({ layout: new FolderLayout(temp.folder) });
    expect(store.list()).toEqual([]);
    expect(store.cleanupTempFiles()).toEqual([]);
  });
});
