import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteDeviceTokenStore, type Storage, type StoredDeviceToken } from "../../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

/** 一個格式正確但只用來做 byte search 的假 Token；不會被寫進任何地方。 */
const PLAINTEXT_TOKEN = `cdt_${"Z".repeat(43)}`;

const temps: TempRoot[] = [];

function newTemp(): TempRoot {
  const temp = createTempRoot("device-store");
  temps.push(temp);
  return temp;
}

function openStorage(temp: TempRoot): Storage {
  return openTestStorage(temp);
}

afterEach(() => {
  while (temps.length > 0) {
    temps.pop()?.cleanup();
  }
});

function makeRecord(overrides: Partial<StoredDeviceToken> = {}): StoredDeviceToken {
  return {
    deviceId: "dev_1",
    deviceName: "測試手機",
    deviceKind: "web",
    tokenHash: "a".repeat(64),
    fingerprint: "AAAA-BBBB-CCCC-DDDD",
    prefix: "cdt_12345678",
    createdAt: "2026-11-16T00:00:00.000Z",
    ...overrides,
  };
}

function stateFiles(temp: TempRoot): Buffer[] {
  const directory = path.join(temp.folder, "state");
  return ["cardiary.sqlite", "cardiary.sqlite-wal", "cardiary.sqlite-shm"].flatMap((name) => {
    const file = path.join(directory, name);
    return existsSync(file) ? [readFileSync(file)] : [];
  });
}

describe("SqliteDeviceTokenStore", () => {
  it("插入後可以用雜湊與識別碼取出，並保留顯示前綴", async () => {
    const temp = newTemp();
    const storage = openStorage(temp);
    const store = new SqliteDeviceTokenStore(storage.state);
    const record = makeRecord();

    await store.insert(record);

    expect(await store.findByHash(record.tokenHash)).toEqual(record);
    expect(await store.findById(record.deviceId)).toEqual(record);
    expect(await store.list()).toEqual([record]);
    storage.close();
  });

  it("重新開啟資料庫後紀錄還在；裝置種類因資料表沒有欄位而未知", async () => {
    const temp = newTemp();
    const first = openStorage(temp);
    const record = makeRecord();
    await new SqliteDeviceTokenStore(first.state).insert(record);
    first.close();

    const second = openStorage(temp);
    const reopened = await new SqliteDeviceTokenStore(second.state).findByHash(record.tokenHash);

    expect(reopened).toEqual({ ...record, deviceKind: "unknown" });
    second.close();
  });

  it("撤銷後重新開啟仍然撤銷，且不覆寫第一次的撤銷時間", async () => {
    const temp = newTemp();
    const first = openStorage(temp);
    const store = new SqliteDeviceTokenStore(first.state);
    await store.insert(makeRecord());
    await store.revoke("dev_1", "2026-11-16T01:00:00.000Z");
    first.close();

    const second = openStorage(temp);
    const reopened = new SqliteDeviceTokenStore(second.state);
    const again = await reopened.revoke("dev_1", "2026-11-17T01:00:00.000Z");

    expect(again?.revokedAt).toBe("2026-11-16T01:00:00.000Z");
    expect((await reopened.findByHash("a".repeat(64)))?.revokedAt).toBe("2026-11-16T01:00:00.000Z");
    expect(await reopened.list()).toHaveLength(1);
    second.close();
  });

  it("撤銷不存在的裝置回 undefined", async () => {
    const temp = newTemp();
    const storage = openStorage(temp);
    const store = new SqliteDeviceTokenStore(storage.state);

    expect(await store.revoke("dev_missing", "2026-11-16T01:00:00.000Z")).toBeUndefined();
    storage.close();
  });

  it("deviceId 重複時拋錯，不會覆寫既有的紀錄", async () => {
    const temp = newTemp();
    const storage = openStorage(temp);
    const store = new SqliteDeviceTokenStore(storage.state);
    await store.insert(makeRecord());

    await expect(
      store.insert(
        makeRecord({ tokenHash: "b".repeat(64), createdAt: "2026-11-17T00:00:00.000Z" }),
      ),
    ).rejects.toThrow(/裝置已存在/);
    expect((await store.list())[0]?.tokenHash).toBe("a".repeat(64));
    storage.close();
  });

  it("不同的裝置不能共用同一個雜湊", async () => {
    const temp = newTemp();
    const storage = openStorage(temp);
    const store = new SqliteDeviceTokenStore(storage.state);
    await store.insert(makeRecord());

    await expect(
      store.insert(makeRecord({ deviceId: "dev_2", prefix: "cdt_99999999" })),
    ).rejects.toThrow();
    storage.close();
  });

  it("last_used_at 只在介面之外：插入後是 NULL，撤銷不會動它", async () => {
    const temp = newTemp();
    const storage = openStorage(temp);
    const store = new SqliteDeviceTokenStore(storage.state);
    await store.insert(makeRecord());

    const lastUsedAt = () =>
      storage.state.get<{ last_used_at: string | null }>(
        "SELECT last_used_at FROM device_tokens WHERE id = ?",
        "dev_1",
      )?.last_used_at;

    expect(lastUsedAt()).toBeNull();
    await store.revoke("dev_1", "2026-11-16T01:00:00.000Z");
    expect(lastUsedAt()).toBeNull();
    storage.close();
  });

  it("清單依建立時間由舊到新", async () => {
    const temp = newTemp();
    const storage = openStorage(temp);
    const store = new SqliteDeviceTokenStore(storage.state);
    await store.insert(
      makeRecord({
        deviceId: "dev_b",
        tokenHash: "b".repeat(64),
        prefix: "cdt_bbbbbbbb",
        createdAt: "2026-11-16T02:00:00.000Z",
      }),
    );
    await store.insert(
      makeRecord({
        deviceId: "dev_a",
        tokenHash: "c".repeat(64),
        prefix: "cdt_cccccccc",
        createdAt: "2026-11-16T01:00:00.000Z",
      }),
    );

    expect((await store.list()).map((record) => record.deviceId)).toEqual(["dev_a", "dev_b"]);
    storage.close();
  });

  it("狀態資料庫找不到 Token 明文，只有雜湊與顯示前綴", async () => {
    const temp = newTemp();
    const storage = openStorage(temp);
    const store = new SqliteDeviceTokenStore(storage.state);
    const tokenHash = createHash("sha256").update(PLAINTEXT_TOKEN).digest("hex");
    await store.insert(
      makeRecord({ tokenHash, prefix: PLAINTEXT_TOKEN.slice(0, "cdt_".length + 8) }),
    );
    storage.close();

    const files = stateFiles(temp);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.includes(tokenHash))).toBe(true);
    expect(files.some((file) => file.includes(PLAINTEXT_TOKEN))).toBe(false);
  });
});
