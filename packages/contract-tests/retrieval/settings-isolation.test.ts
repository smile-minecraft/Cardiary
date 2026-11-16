import { describe, expect, it } from "vitest";
import type { HostModule, ModuleServices, SettingChange } from "@cardiary/module-api";
import { HostModuleRegistry } from "../../host/src/modules/registry.js";

describe("模組設定隔離", () => {
  it("只讀與接收自己宣告的鍵，停用後停止通知", async () => {
    const listeners = new Set<(change: SettingChange) => void>();
    const values: Record<string, boolean> = { "a.enabled": true, "b.enabled": false };
    const events: string[] = [];
    const services = {
      settings: {
        get: (key: string) => values[key],
        getLevel: () => "free",
        onChange: (callback: (change: SettingChange) => void) => {
          listeners.add(callback);
          return () => {
            listeners.delete(callback);
          };
        },
      },
    } as unknown as ModuleServices;
    const tools = { register: async () => {}, retire: async () => {}, list: async () => [] };
    const registry = new HostModuleRegistry({ tools, services, events: { emit: () => {} } });
    let foreign: unknown;
    let own: unknown;
    const moduleA: HostModule = {
      manifest: {
        id: "a",
        name: "a",
        version: "1.0.0",
        hostApiVersion: "1",
        dependencies: [],
        permissions: [],
        settings: [{ key: "a.enabled", title: "A", kind: "boolean" }],
      },
      activate(context) {
        foreign = context.services.settings.get("b.enabled");
        own = context.services.settings.get("a.enabled");
        context.services.settings.onChange((change) => {
          events.push(change.key);
        });
      },
    };
    await registry.load(moduleA);
    await registry.activate("a");
    expect(own).toBe(true);
    expect(foreign).toBeUndefined();
    const change = (key: string): SettingChange => ({
      key,
      previousValue: false,
      nextValue: true,
      level: "free",
      changedBy: { kind: "system", component: "test" },
      changedAt: new Date().toISOString(),
    });
    for (const listener of listeners) listener(change("b.enabled"));
    for (const listener of listeners) listener(change("a.enabled"));
    expect(events).toEqual(["a.enabled"]);
    await registry.deactivate("a");
    expect(listeners.size).toBe(0);
  });
});
