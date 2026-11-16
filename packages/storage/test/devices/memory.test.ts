import { describe, expect, it } from "vitest";

import { MemoryDeviceTokenStore, type StoredDeviceToken } from "../../src/devices/index.js";

function makeRecord(overrides: Partial<StoredDeviceToken> = {}): StoredDeviceToken {
  return {
    deviceId: "dev_1",
    deviceName: "測試手機",
    deviceKind: "web",
    tokenHash: "a".repeat(64),
    fingerprint: "AAAA-BBBB-CCCC-DDDD",
    createdAt: "2026-11-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("MemoryDeviceTokenStore", () => {
  it("插入後可以用雜湊與識別碼取出", async () => {
    const store = new MemoryDeviceTokenStore();
    const record = makeRecord();
    await store.insert(record);
    expect(await store.findByHash(record.tokenHash)).toEqual(record);
    expect(await store.findById(record.deviceId)).toEqual(record);
    expect(await store.list()).toEqual([record]);
  });

  it("deviceId 重複時拋錯", async () => {
    const store = new MemoryDeviceTokenStore();
    await store.insert(makeRecord());
    await expect(store.insert(makeRecord())).rejects.toThrow();
  });

  it("撤銷之後雜湊仍查得到，但帶著 revokedAt", async () => {
    const store = new MemoryDeviceTokenStore();
    await store.insert(makeRecord());
    const revoked = await store.revoke("dev_1", "2026-11-16T01:00:00.000Z");
    expect(revoked?.revokedAt).toBe("2026-11-16T01:00:00.000Z");
    const found = await store.findByHash("a".repeat(64));
    expect(found?.revokedAt).toBe("2026-11-16T01:00:00.000Z");
  });

  it("重複撤銷是安全的：保留第一次的撤銷時間", async () => {
    const store = new MemoryDeviceTokenStore();
    await store.insert(makeRecord());
    await store.revoke("dev_1", "2026-11-16T01:00:00.000Z");
    const again = await store.revoke("dev_1", "2026-11-17T01:00:00.000Z");
    expect(again?.revokedAt).toBe("2026-11-16T01:00:00.000Z");
  });

  it("撤銷不存在的裝置回 undefined", async () => {
    const store = new MemoryDeviceTokenStore();
    expect(await store.revoke("dev_missing", "2026-11-16T01:00:00.000Z")).toBeUndefined();
  });

  it("清單依建立時間排序", async () => {
    const store = new MemoryDeviceTokenStore();
    await store.insert(
      makeRecord({
        deviceId: "dev_b",
        tokenHash: "b".repeat(64),
        createdAt: "2026-11-16T02:00:00.000Z",
      }),
    );
    await store.insert(
      makeRecord({
        deviceId: "dev_a",
        tokenHash: "c".repeat(64),
        createdAt: "2026-11-16T01:00:00.000Z",
      }),
    );
    expect((await store.list()).map((record) => record.deviceId)).toEqual(["dev_a", "dev_b"]);
  });
});
