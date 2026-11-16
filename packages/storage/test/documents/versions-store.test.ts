process.env.TZ = "UTC";
import { rmSync } from "node:fs";

import { sha256Hex } from "@cardiary/domain";

import { afterEach, describe, expect, it } from "vitest";

import { CardVersionsStore, type Storage } from "../../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function fixture(
  retention: { maxRecent: number; keepDailyCheckpoint: boolean } = {
    maxRecent: 50,
    keepDailyCheckpoint: true,
  },
  start = "2026-01-01T00:00:00.000Z",
): {
  readonly store: CardVersionsStore;
  readonly storage: Storage;
  readonly temp: TempRoot;
  readonly advance: (days: number) => void;
} {
  const temp = createTempRoot("m3-versions");
  const storage = openTestStorage(temp);
  cleanups.push(() => storage.close());
  cleanups.push(() => rmSync(temp.root, { recursive: true, force: true }));
  let current = Date.parse(start);
  return {
    storage,
    temp,
    store: new CardVersionsStore(storage.state, {
      retention,
      now: () => new Date(current),
    }),
    advance: (days: number) => {
      current += days * 24 * 60 * 60 * 1000;
    },
  };
}

const BODY_0 = ["line one", "line two"].join("\n");
const BODY_1 = ["line one", "line TWO"].join("\n");
const BODY_2 = ["line one", "line THREE"].join("\n");
const PATCH_1 = ["@@ -2,1 +2,1 @@", "-line two", "+line TWO"].join("\n");
const PATCH_2 = ["@@ -2,1 +2,1 @@", "-line TWO", "+line THREE"].join("\n");

function appendChange(
  store: CardVersionsStore,
  cardId: string,
  baseRevision: string,
  body: string,
  patch: string,
) {
  return store.appendPatch({
    cardId,
    baseRevision,
    body,
    revision: `rev-${sha256Hex(body).slice(0, 8)}`,
    bodyHash: sha256Hex(body),
    patch: { format: "unified", text: patch },
  });
}

describe("卡片版本儲存", () => {
  it("接受補丁後 new version 可還原，還原本身也是新版本", () => {
    const { store } = fixture();
    const card = "01J00000000000000000000000";
    store.create(card, BODY_0, "rev-0", sha256Hex(BODY_0));
    const second = appendChange(store, card, "rev-0", BODY_1, PATCH_1);

    const restored = store.restore(card, second.versionId);
    expect(restored.body).toBe(BODY_1);
    expect(restored.version.kind).toBe("restore");
    expect(restored.version.patchFormat).toBe("replace");
    expect(store.latest(card)?.versionId).toBe(restored.version.versionId);
    expect(store.count(card)).toBe(3);
  });

  it("拒絕補丁時不新增版本，內容不變", () => {
    const { store } = fixture();
    const card = "01J0000000000000000000000099";
    const first = store.create(card, BODY_0, "rev-0", sha256Hex(BODY_0));
    expect(store.count(card)).toBe(1);
    expect(store.list(card)[0]?.patchText).toBe(BODY_0);
    expect(store.latest(card)?.versionId).toBe(first.versionId);
  });

  it("超過上限時最舊版被合併，保留版仍可還原且合併範圍可追溯", () => {
    const { store } = fixture({ maxRecent: 3, keepDailyCheckpoint: false });
    const card = "01J00000000000000000000002";
    store.create(card, BODY_0, "rev-0", sha256Hex(BODY_0));
    appendChange(store, card, "rev-0", BODY_1, PATCH_1);
    const third = appendChange(store, card, "rev-1", BODY_2, PATCH_2);
    appendChange(store, card, "rev-2", `${BODY_2}\nextra`, "@@ -3,0 +4,1 @@\n+extra");
    appendChange(store, card, "rev-3", `${BODY_2}\nextra\nmore`, "@@ -4,0 +5,1 @@\n+more");

    const versions = store.list(card);
    expect(versions.map((version) => version.seq)).toEqual([1, 3, 4, 5]);
    expect(versions.find((version) => version.seq === 3)?.mergedCount).toBe(1);
    expect(versions.find((version) => version.seq === 3)?.mergedSeqRange).toBe("2-2");
    expect(store.restore(card, third.versionId).body).toBe(BODY_2);
  });

  it("上限為 0 表示不限，不合併任何版本", () => {
    const { store } = fixture({ maxRecent: 0, keepDailyCheckpoint: false });
    const card = "01J00000000000000000000003";
    store.create(card, BODY_0, "rev-0", sha256Hex(BODY_0));
    for (let index = 0; index < 60; index += 1) {
      appendChange(
        store,
        card,
        `rev-${index}`,
        `${BODY_0}\n${index}`,
        `@@ -3,0 +${index + 3},1 @@\n+${index}`,
      );
    }
    expect(store.count(card)).toBe(61);
    expect(store.list(card).at(-1)?.mergedCount).toBe(0);
  });

  it("跨日的第一筆改成每日檢查點，仍可還原", () => {
    const { store, advance } = fixture();
    const card = "01J00000000000000000000004";
    store.create(card, BODY_0, "rev-0", sha256Hex(BODY_0));
    appendChange(store, card, "rev-0", BODY_1, PATCH_1);
    advance(1);
    const checkpoint = appendChange(store, card, "rev-1", BODY_2, PATCH_2);

    expect(checkpoint.kind).toBe("checkpoint");
    expect(checkpoint.patchFormat).toBe("replace");
    expect(checkpoint.patchText).toBe(BODY_2);
    expect(store.restore(card, checkpoint.versionId).body).toBe(BODY_2);
  });

  it("刪卡後查不到任何版本", () => {
    const { store } = fixture();
    const card = "01J00000000000000000000005";
    store.create(card, BODY_0, "rev-0", sha256Hex(BODY_0));
    appendChange(store, card, "rev-0", BODY_1, PATCH_1);
    expect(store.deleteCard(card)).toBe(2);
    expect(store.list(card)).toEqual([]);
    expect(store.count(card)).toBe(0);
  });

  it("重開資料庫後版本歷史一致", () => {
    const { store, storage, temp } = fixture();
    const card = "01J00000000000000000000006";
    store.create(card, BODY_0, "rev-0", sha256Hex(BODY_0));
    const second = appendChange(store, card, "rev-0", BODY_1, PATCH_1);
    const before = store.list(card);

    storage.close();
    const reopened = openTestStorage(temp);
    cleanups.push(() => reopened.close());
    const afterStore = new CardVersionsStore(reopened.state);
    expect(afterStore.list(card)).toEqual(before);
    expect(afterStore.restore(card, second.versionId).body).toBe(BODY_1);
  });
});
