import { describe, expect, it } from "vitest";

import { constantTimeEqual } from "../../src/pairing/constant-time.js";
import {
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  formatShortCode,
  generateShortCode,
  isShortCodeShape,
  normalizeShortCode,
  verifyShortCode,
} from "../../src/pairing/short-code.js";

describe("短碼字母表", () => {
  it("不含易混淆的 0、1、I、L、O、U", () => {
    for (const banned of ["0", "1", "I", "L", "O", "U"]) {
      expect(SHORT_CODE_ALPHABET).not.toContain(banned);
    }
  });

  it("長度是 8 個字元", () => {
    expect(SHORT_CODE_LENGTH).toBe(8);
  });

  it("每個字元都出現在字母表裡", () => {
    const code = generateShortCode(() => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toHaveLength(SHORT_CODE_LENGTH);
    for (const char of code) {
      expect(SHORT_CODE_ALPHABET).toContain(char);
    }
  });

  it("固定的亂數來源產生固定的短碼", () => {
    const code = generateShortCode(() => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toBe("23456789");
  });

  it("純粹由 255 組成的壞亂數會放棄並擲出錯誤，而不是無限迴圈", () => {
    expect(() => generateShortCode(() => new Uint8Array(8).fill(255))).toThrow(
      "亂數來源無法產生可用的短碼位元組",
    );
  });
});

describe("正規化與形狀", () => {
  it("去掉空白與連字號、轉大寫", () => {
    expect(normalizeShortCode(" ab-cd efgh ")).toBe("ABCDEFGH");
  });

  it("接受顯示格式 ABCD-2345，不在字母表的字元一律拒絕", () => {
    expect(isShortCodeShape("ABCD-2345")).toBe(false);
    expect(isShortCodeShape("ABCD2345")).toBe(true);
    expect(isShortCodeShape("ABCD0345")).toBe(false); // 字母表沒有 0
    expect(isShortCodeShape("ABCDO345")).toBe(false); // 字母表沒有 O
    expect(isShortCodeShape("ABCD23")).toBe(false); // 太短
  });

  it("顯示格式是四個字元一組、用連字號分隔", () => {
    expect(formatShortCode("ABCD2345")).toBe("ABCD-2345");
    expect(formatShortCode("abcd2345")).toBe("ABCD-2345");
  });
});

describe("常數時間比對", () => {
  it("忽略大小寫與分隔符號", () => {
    expect(verifyShortCode("abcd-2345", "ABCD2345")).toBe(true);
    expect(verifyShortCode("ABCD 2345", "ABCD2345")).toBe(true);
  });

  it("不同的短碼回傳 false", () => {
    expect(verifyShortCode("ABCD2345", "ABCD2346")).toBe(false);
  });

  it("形狀不合法的輸入回傳 false，不會擲出錯誤", () => {
    expect(verifyShortCode("!!!", "ABCD2345")).toBe(false);
    expect(verifyShortCode("ABCD2345", "")).toBe(false);
    expect(verifyShortCode("00000000", "00000000")).toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("相同字串回傳 true，一個一個字元對照", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("不同內容或不同長度回傳 false", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("abcd", "abc")).toBe(false);
  });
});
