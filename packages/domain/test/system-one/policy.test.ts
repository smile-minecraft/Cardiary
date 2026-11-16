import { describe, expect, it } from "vitest";

import { JEV_PROFILE, MODEL_PROFILE, systemOneProfile } from "../../src/system-one/index.js";

describe("System One 門檻規則", () => {
  it("Jev 的門檻 0.6、最多 20 張、逾時 5 秒", () => {
    expect(JEV_PROFILE).toEqual({ threshold: 0.6, candidateLimit: 20, timeoutMs: 5_000 });
  });

  it("小型語言模型的門檻 0.75、最多 5 張、逾時 8 秒", () => {
    expect(MODEL_PROFILE).toEqual({ threshold: 0.75, candidateLimit: 5, timeoutMs: 8_000 });
  });

  it("依模式取對應的設定檔", () => {
    for (const [mode, profile] of [
      ["jev", JEV_PROFILE],
      ["model", MODEL_PROFILE],
    ] as [JudgedSystemOneMode, typeof JEV_PROFILE][]) {
      expect(systemOneProfile(mode)).toBe(profile);
    }
  });

  it("不合法的模式丟 RangeError，而不是回傳空的設定檔", () => {
    expect(() => systemOneProfile("none" as never)).toThrow(RangeError);
  });
});
