import { describe, expect, it } from "vitest";

import {
  DomainRuleError,
  domainRuleMatches,
  isIpLiteralHost,
  isPrivateHost,
  matchesAllowedDomain,
  parseDomainRule,
  parseDomainRules,
  redirectChainStaysAllowed,
} from "../../src/permissions/domains.js";

const rules = parseDomainRules([
  "example.com",
  "*.docs.example.com",
  "files.example.net/downloads",
]);

describe("網域清單的規則", () => {
  it("精確 host 只比對自己，不含子網域", () => {
    expect(matchesAllowedDomain(rules, new URL("https://example.com/a"))).toBe(true);
    expect(matchesAllowedDomain(rules, new URL("https://www.example.com/a"))).toBe(false);
  });

  it("萬用字元比對子網域，不含 apex", () => {
    expect(matchesAllowedDomain(rules, new URL("https://api.docs.example.com/x"))).toBe(true);
    expect(matchesAllowedDomain(rules, new URL("https://docs.example.com/x"))).toBe(false);
  });

  it("路徑前綴的邊界在斜線", () => {
    expect(matchesAllowedDomain(rules, new URL("https://files.example.net/downloads"))).toBe(true);
    expect(matchesAllowedDomain(rules, new URL("https://files.example.net/downloads/a.zip"))).toBe(
      true,
    );
    expect(matchesAllowedDomain(rules, new URL("https://files.example.net/downloadsx"))).toBe(
      false,
    );
    expect(matchesAllowedDomain(rules, new URL("https://files.example.net/"))).toBe(false);
  });

  it("帶埠號或帳號的 URL 不比對", () => {
    expect(matchesAllowedDomain(rules, new URL("https://example.com:8443/a"))).toBe(false);
    expect(matchesAllowedDomain(rules, new URL("https://user@example.com/a"))).toBe(false);
  });

  it("路徑前綴只有 / 時等於不限路徑", () => {
    const rule = parseDomainRule("example.com/");
    expect(domainRuleMatches(rule, new URL("https://example.com/"))).toBe(true);
    expect(domainRuleMatches(rule, new URL("https://example.com/deep/path"))).toBe(true);
  });

  it("規則字串前後的空白會被去掉", () => {
    expect(parseDomainRule("  example.com  ")).toEqual({ host: "example.com" });
  });
});

describe("不接受的網域規則", () => {
  it.each([
    ["https://example.com", "協定"],
    ["example.com:443", "埠號"],
    ["user@example.com", "帳號"],
    ["example.com?x=1", "查詢字串"],
    ["example.com#top", "片段"],
    ["exa mple.com", "空白"],
    ["", "空字串"],
    ["*.com", "太寬的萬用網域"],
    ["api.*.example.com", "萬用字元不在最前面"],
    ["example.com/../etc", "路徑穿越"],
    ["example.com//a", "連續斜線"],
    ["example.com\\a", "反斜線"],
    ["-bad.example.com", "標籤開頭是連字號"],
  ])("拒絕 %s（%s）", (input) => {
    expect(() => parseDomainRule(input)).toThrow(DomainRuleError);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.20.0.1",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
  ])("拒絕私有或本機 IP %s", (input) => {
    expect(() => parseDomainRule(input)).toThrow(DomainRuleError);
  });

  it.each(["2130706433", "0x7f000001", "8.8.8.8", "[::1]", "fe80::1"])(
    "拒絕 IP 字面值 %s",
    (input) => {
      expect(() => parseDomainRule(input)).toThrow(DomainRuleError);
    },
  );

  it.each(["localhost", "api.localhost", "printer.local", "nas.internal", "router.home.arpa"])(
    "拒絕本機名稱 %s",
    (input) => {
      expect(() => parseDomainRule(input)).toThrow(DomainRuleError);
    },
  );

  it("IP 與私有網段的判斷本身也能單獨用", () => {
    expect(isIpLiteralHost("192.168.0.1")).toBe(true);
    expect(isIpLiteralHost("example.com")).toBe(false);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});

describe("重新導向逐腳比對", () => {
  it("整條鏈都在清單內才成立", () => {
    expect(
      redirectChainStaysAllowed(rules, [
        new URL("https://example.com/start"),
        new URL("https://example.com/next"),
      ]),
    ).toBe(true);
  });

  it("任何一腳不在清單內就停止", () => {
    expect(
      redirectChainStaysAllowed(rules, [
        new URL("https://example.com/start"),
        new URL("https://attacker.test/next"),
      ]),
    ).toBe(false);
  });

  it("空的鏈不算通過", () => {
    expect(redirectChainStaysAllowed(rules, [])).toBe(false);
  });
});
