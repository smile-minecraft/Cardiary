import { describe, expect, it } from "vitest";

import { settingLevel } from "../../src/settings/catalog.js";
import { SettingsService } from "../../src/settings/service.js";
import { MemorySettingsStore } from "../models/support.js";

describe("一般設定", () => {
  it("第一次讀摘要上限是 4,096，分級是 free", () => {
    const service = new SettingsService(new MemorySettingsStore());
    expect(service.get("models.summary.maxOutputTokens")).toBe(4_096);
    expect(settingLevel("models.summary.maxOutputTokens", "human-only")).toBe("free");
  });

  it("寫入時保存 JSON 值並留下變更紀錄", () => {
    const store = new MemorySettingsStore();
    const service = new SettingsService(store);
    const result = service.set({
      key: "models.summary.maxOutputTokens",
      value: 8_192,
      actor: "user:device-1",
    });
    expect(result.item).toMatchObject({
      key: "models.summary.maxOutputTokens",
      value: 8_192,
      level: "free",
    });
    expect(store.changes).toEqual([
      {
        key: "models.summary.maxOutputTokens",
        oldValue: null,
        newValue: "8192",
      },
    ]);
    expect(service.get("models.summary.maxOutputTokens")).toBe(8_192);
  });

  it("未列在目錄的鍵視為 human-only", () => {
    const store = new MemorySettingsStore();
    const service = new SettingsService(store);
    service.set({ key: "unknown.key", value: true, actor: "user:device-1" });
    expect(store.get("unknown.key")?.level).toBe("human-only");
  });

  it("一次寫多筆時全部成功才生效，變更通知逐筆送出", () => {
    const store = new MemorySettingsStore();
    const service = new SettingsService(store);
    const changes: string[] = [];
    service.onChange((change) => changes.push(change.item.key));

    const results = service.setMany([
      { key: "models.providers", value: [], actor: "user:device-1", level: "approval" },
      { key: "models.roles", value: [], actor: "user:device-1", level: "approval" },
    ]);
    expect(results.map((result) => result.item.key)).toEqual(["models.providers", "models.roles"]);
    expect(store.get("models.providers")?.value).toBe("[]");
    expect(store.get("models.roles")?.value).toBe("[]");
    expect(changes).toEqual(["models.providers", "models.roles"]);
  });

  it("寫多筆時一筆失敗就整批不生效，也不送變更通知", () => {
    const store = new MemorySettingsStore();
    const service = new SettingsService(store);
    const changes: string[] = [];
    service.onChange((change) => changes.push(change.item.key));
    store.failOnKey = "models.roles";

    expect(() =>
      service.setMany([
        { key: "models.providers", value: [], actor: "user:device-1", level: "approval" },
        { key: "models.roles", value: [], actor: "user:device-1", level: "approval" },
      ]),
    ).toThrow(/注入的設定寫入失敗/);
    expect(store.get("models.providers")).toBeNull();
    expect(store.get("models.roles")).toBeNull();
    expect(changes).toEqual([]);
  });

  it("清單包含模型鍵與預設的摘要上限，依鍵排序", () => {
    const service = new SettingsService(new MemorySettingsStore());
    const keys = service.list().map((entry) => entry.key);
    expect(keys).toContain("models.providers");
    expect(keys).toContain("models.roles");
    expect(keys).toContain("models.summary.maxOutputTokens");
    expect([...keys].sort()).toEqual(keys);
  });
});
