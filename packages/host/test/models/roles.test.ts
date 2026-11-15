import { describe, expect, it } from "vitest";

import {
  modelsStateOf,
  normalizeSetInput,
  resolveRoles,
  snapshotOf,
} from "../../src/models/state.js";
import { ModelSettingsError } from "../../src/models/errors.js";
import { model, provider } from "./support.js";

const main = provider({
  providerId: "main",
  models: [model("main-model", { maxOutputTokens: 8_192 })],
});
const small = provider({
  providerId: "small",
  models: [model("small-model", { maxOutputTokens: 4_096 })],
});
const writing = provider({
  providerId: "writing",
  models: [model("writing-model", { maxOutputTokens: 8_192 })],
});
const one = provider({
  providerId: "one",
  models: [model("one-model", { maxOutputTokens: 2_048 })],
});
const providers = [main, small, writing, one];

function rolesMap(
  entries: ReadonlyArray<
    readonly [
      "main" | "small" | "writing" | "system-one",
      "unset" | "none" | "model",
      (readonly [string, string])?,
    ]
  >,
): Map<
  "main" | "small" | "writing" | "system-one",
  {
    role: "main" | "small" | "writing" | "system-one";
    mode: "unset" | "none" | "model";
    ref?: { providerId: string; modelId: string };
  }
> {
  const map = new Map<
    "main" | "small" | "writing" | "system-one",
    {
      role: "main" | "small" | "writing" | "system-one";
      mode: "unset" | "none" | "model";
      ref?: { providerId: string; modelId: string };
    }
  >();
  for (const [role, mode, ref] of entries) {
    map.set(
      role,
      ref === undefined
        ? { role, mode }
        : { role, mode, ref: { providerId: ref[0], modelId: ref[1] } },
    );
  }
  return map;
}

describe("模型角色解析", () => {
  it("只設主力時，小模型與寫作退回主力、System One 退回小模型", () => {
    const resolved = resolveRoles([main], rolesMap([["main", "model", ["main", "main-model"]]]));
    expect(resolved.main.selection).toEqual({ provider: "main", model: "main-model" });
    expect(resolved.small.selection).toEqual({ provider: "main", model: "main-model" });
    expect(resolved.small.source).toBe("fallback-main");
    expect(resolved.writing.source).toBe("fallback-main");
    expect(resolved["system-one"].selection).toEqual({ provider: "main", model: "main-model" });
    expect(resolved["system-one"].source).toBe("fallback-small");
  });

  it("只設主力與小模型時，System One 退回小模型", () => {
    const resolved = resolveRoles(
      [main, small],
      rolesMap([
        ["main", "model", ["main", "main-model"]],
        ["small", "model", ["small", "small-model"]],
      ]),
    );
    expect(resolved["system-one"].selection).toEqual({ provider: "small", model: "small-model" });
    expect(resolved["system-one"].source).toBe("fallback-small");
  });

  it("System One 明確設為無時不啟用，即使小模型已設定", () => {
    const resolved = resolveRoles(
      [main, small],
      rolesMap([
        ["main", "model", ["main", "main-model"]],
        ["small", "model", ["small", "small-model"]],
        ["system-one", "none"],
      ]),
    );
    expect(resolved["system-one"].selection).toBeNull();
    expect(resolved["system-one"].source).toBe("none");
  });

  it("沒有設定主力時，所有角色都沒有模型", () => {
    const resolved = resolveRoles([], new Map());
    expect(resolved.main.selection).toBeNull();
    expect(resolved.small.selection).toBeNull();
    expect(resolved.writing.selection).toBeNull();
    expect(resolved["system-one"].selection).toBeNull();
    for (const entry of resolved.list) {
      expect(entry.source).toBe("none");
    }
  });

  it("角色指到不存在的模型時，整份設定被拒絕", () => {
    expect(() =>
      normalizeSetInput({
        providers: [main],
        roles: [{ role: "main", mode: "model", ref: { providerId: "main", modelId: "missing" } }],
        currentProviders: [],
        currentRoles: new Map(),
      }),
    ).toThrow(ModelSettingsError);
  });

  it("主力不能設為無；小模型設為無等於退回主力", () => {
    expect(() =>
      normalizeSetInput({
        providers: [main],
        roles: [{ role: "main", mode: "none" }],
        currentProviders: [],
        currentRoles: new Map(),
      }),
    ).toThrow(ModelSettingsError);
    const normalized = normalizeSetInput({
      providers: [main],
      roles: [{ role: "small", mode: "none" }],
      currentProviders: [],
      currentRoles: new Map(),
    });
    expect(normalized.roles.get("small")?.mode).toBe("unset");
  });

  it("state 與協定形狀一致，未設定的角色也會列出", () => {
    const snapshot = snapshotOf([main], rolesMap([["main", "model", ["main", "main-model"]]]));
    const state = modelsStateOf(snapshot);
    expect(state.roles.map((entry) => entry.role)).toEqual([
      "main",
      "small",
      "writing",
      "system-one",
    ]);
    expect(state.resolved.map((entry) => [entry.role, entry.source])).toEqual([
      ["main", "configured"],
      ["small", "fallback-main"],
      ["writing", "fallback-main"],
      ["system-one", "fallback-small"],
    ]);
  });

  it("三家供應商各宣告模型時，角色可以指向不同供應商", () => {
    const snapshot = snapshotOf(
      providers,
      rolesMap([
        ["main", "model", ["main", "main-model"]],
        ["small", "model", ["small", "small-model"]],
        ["writing", "model", ["writing", "writing-model"]],
        ["system-one", "model", ["one", "one-model"]],
      ]),
    );
    expect(snapshot.resolved.writing.selection).toEqual({
      provider: "writing",
      model: "writing-model",
    });
    expect(snapshot.resolved["system-one"].selection).toEqual({
      provider: "one",
      model: "one-model",
    });
  });
});
