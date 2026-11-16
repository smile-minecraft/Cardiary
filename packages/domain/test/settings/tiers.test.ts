import { describe, expect, it } from "vitest";

import {
  decideSettingAction,
  isSettingVisible,
  normalizeSettingTier,
} from "../../src/settings/index.js";

describe("normalizeSettingTier", () => {
  it("只接受已知分級，其他一律 human-only", () => {
    expect(normalizeSettingTier("free")).toBe("free");
    expect(normalizeSettingTier("approval")).toBe("approval");
    expect(normalizeSettingTier("human-only")).toBe("human-only");
    expect(normalizeSettingTier(undefined)).toBe("human-only");
    expect(normalizeSettingTier("FREE")).toBe("human-only");
    expect(normalizeSettingTier({})).toBe("human-only");
  });
});

describe("decideSettingAction", () => {
  it("代理改 free 直接生效，approval 只能提議", () => {
    expect(decideSettingAction("free", "agent", "change")).toEqual({
      allowed: true,
      effect: "apply",
    });
    expect(decideSettingAction("approval", "agent", "propose")).toEqual({
      allowed: true,
      effect: "propose",
    });
    expect(decideSettingAction("approval", "agent", "change")).toEqual({
      allowed: true,
      effect: "propose",
    });
  });

  it("代理不能讀取、列出或提議 human-only，未標級也一樣", () => {
    for (const tier of ["human-only", undefined, "unknown"]) {
      for (const action of ["read", "list", "change", "propose", "decide"] as const) {
        const decision = decideSettingAction(tier, "agent", action);
        expect(decision.allowed, `${String(tier)}/${action}`).toBe(false);
      }
    }
    expect(isSettingVisible(undefined, "agent")).toBe(false);
    expect(isSettingVisible("human-only", "agent")).toBe(false);
  });

  it("代理不能核准提議", () => {
    expect(decideSettingAction("approval", "agent", "decide").allowed).toBe(false);
    expect(decideSettingAction("free", "agent", "decide").allowed).toBe(false);
  });

  it("人工與系統可以讀寫所有分級，也包括核准", () => {
    for (const actor of ["human", "system"] as const) {
      for (const tier of ["free", "approval", "human-only"] as const) {
        for (const action of ["read", "list", "change", "propose", "decide"] as const) {
          expect(
            decideSettingAction(tier, actor, action).allowed,
            `${actor}/${tier}/${action}`,
          ).toBe(true);
        }
      }
    }
  });
});
