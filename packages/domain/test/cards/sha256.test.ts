import { describe, expect, it } from "vitest";

import { sha256HexOf as sha256Hex, utf8Bytes } from "../../src/cards/sha256.js";

// FIPS 180-4 與 RFC 4231 的標準向量，另加 UTF-8 多位元組字元。
const VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
  ["a".repeat(1_000_000), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
  ["會議筆記", "a440895ccb076ca7a7053e5cd403ded5fd54e6cb1f5a344c660ff63129e925cb"],
];

describe("SHA-256", () => {
  for (const [input, expected] of VECTORS) {
    it(`符合標準向量：${input.slice(0, 16)}${input.length > 16 ? "…" : ""}`, () => {
      expect(sha256Hex(input)).toBe(expected);
    });
  }

  it("接受 Uint8Array", () => {
    expect(sha256Hex(utf8Bytes("abc"))).toBe(sha256Hex("abc"));
  });
});
