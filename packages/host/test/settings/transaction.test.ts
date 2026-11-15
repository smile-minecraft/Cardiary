import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Storage } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { TransactionalSettingsStore } from "../../src/settings/store.js";
import type { StoreSettingInput } from "../../src/settings/service.js";

/**
 * `TransactionalSettingsStore.setMany` 對真 SQLite 的承諾。
 *
 * 供應商與角色是一組設定，一起生效或一起回滾；一旦其中一筆寫到一半
 * 失敗，半套設定比沒有設定更糟。這裡用真 SQLite 的 CHECK 約束觸發
 * `BEGIN IMMEDIATE ... COMMIT` 中途的失敗，確認整批回滾、變更紀錄也
 * 回滾，當下的連線沒有卡在交易裡，之後還能繼續寫入。
 */

const storages: Storage[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const storage of storages.splice(0)) {
    storage.close();
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeStore(): Promise<{
  readonly storage: Storage;
  readonly store: TransactionalSettingsStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-settings-transaction-"));
  roots.push(root);
  const storage = Storage.open({ path: root, initialize: true });
  storages.push(storage);
  const store = new TransactionalSettingsStore(storage.state, storage.settings);
  return { storage, store };
}

const PROVIDERS: StoreSettingInput = {
  key: "models.providers",
  value: "[]",
  level: "approval",
  updatedBy: "user:test",
};

const ROLES: StoreSettingInput = {
  key: "models.roles",
  value: "[]",
  level: "approval",
  updatedBy: "user:test",
};

describe("設定的真 SQLite 交易", () => {
  it("兩鍵一起寫，兩鍵都在、變更紀錄也都在", async () => {
    const { storage, store } = await makeStore();
    const before = storage.settings.changeCount();

    const results = store.setMany([PROVIDERS, ROLES]);

    expect(results.map((record) => record.key)).toEqual(["models.providers", "models.roles"]);
    expect(store.get("models.providers")?.value).toBe("[]");
    expect(store.get("models.roles")?.value).toBe("[]");
    expect(storage.settings.changeCount()).toBe(before + 2);
    expect(storage.state.inTransaction).toBe(false);
  });

  it("中途一筆觸發 CHECK 約束失敗時，整批回滾、變更紀錄也回滾、連線不卡在交易裡", async () => {
    const { storage, store } = await makeStore();
    const before = storage.settings.changeCount();

    // `level` 沒有通過 CHECK 約束：SQLite 在 COMMIT 前就會回報錯誤。
    const invalid = {
      key: "models.roles",
      value: "{}",
      level: "bogus",
      updatedBy: "user:test",
    } as unknown as StoreSettingInput;

    expect(() => store.setMany([PROVIDERS, invalid])).toThrow();

    expect(store.get("models.providers")).toBeNull();
    expect(store.get("models.roles")).toBeNull();
    expect(storage.settings.changeCount()).toBe(before);
    expect(storage.state.inTransaction).toBe(false);

    // 交易已經結束，連線可以繼續用。
    store.setMany([PROVIDERS, ROLES]);
    expect(store.get("models.providers")?.value).toBe("[]");
    expect(store.get("models.roles")?.value).toBe("[]");
    expect(storage.settings.changeCount()).toBe(before + 2);
  });
});
