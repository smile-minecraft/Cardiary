import { describe, expect, it } from "vitest";

import {
  correctEstimates,
  correctionFactor,
  estimateTokens,
  requestTokensOf,
} from "../../src/context/index.js";

describe("token 估算", () => {
  it("用字元數除以 2.5 無條件進位", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcdef")).toBe(3);
  });

  it("request_tokens 是 input 加 cacheRead 加 cacheWrite", () => {
    expect(requestTokensOf({ inputTokens: 40, cacheReadTokens: 4000, cacheWriteTokens: 0 })).toBe(
      4040,
    );
  });

  it("沒有上一輪用量時不校正", () => {
    expect(correctionFactor(null, 1000)).toBe(1);
    expect(correctionFactor(undefined, 1000)).toBe(1);
    expect(correctionFactor(0, 1000)).toBe(1);
  });

  it("校正係數是 request_tokens 除以估算前綴", () => {
    expect(correctionFactor(2000, 1000)).toBe(2);
    expect(correctionFactor(500, 1000)).toBe(0.5);
  });

  it("誇張的係數被夾住，估算不會爆走", () => {
    expect(correctionFactor(1_000_000, 10)).toBe(4);
    expect(correctionFactor(1, 1_000_000)).toBe(0.25);
  });

  it("加總等於 usedTokens 在四捨五入之後仍成立", () => {
    const { estimates, total } = correctEstimates([1, 2, 3, 4], 1.37);

    expect(estimates).toEqual([1, 3, 4, 5]);
    expect(total).toBe(estimates.reduce((sum, value) => sum + value, 0));
  });

  it("負數或壞掉的估算視為 0", () => {
    const { estimates, total } = correctEstimates([-5, Number.NaN, 2], 1);

    expect(estimates).toEqual([0, 0, 2]);
    expect(total).toBe(2);
  });
});
