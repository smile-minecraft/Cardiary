import { describe, expect, it } from "vitest";

import { matchCredentialArgument, matchCredentialPath } from "../../src/permissions/index.js";

describe("憑證樣式", () => {
  it.each([
    ["/Users/example/.ssh/id_ed25519", ".ssh/**"],
    ["/Users/example/.ssh/known_hosts", ".ssh/**"],
    ["/Users/example/.aws/credentials", ".aws/**"],
    ["/Users/example/.gnupg/pubring.kbx", ".gnupg/**"],
    ["/Users/example/project/.env", ".env"],
    ["/Users/example/project/.env.local", ".env.*"],
    ["/Users/example/project/prod.env", "*.env"],
    ["/tmp/cert.pem", "*.pem"],
    ["/tmp/store.p12", "*.p12"],
    ["/tmp/tls.key", "*.key"],
    ["/Users/example/Library/Keychains/login.keychain-db", "keychain*"],
    ["/Users/example/project/.netrc", ".netrc"],
    ["/Users/example/project/.npmrc", ".npmrc"],
    ["/Users/example/project/credentials", "credentials"],
    ["/Users/example/project/secrets.json", "secrets.json"],
    ["/Users/example/.config/gh/hosts.yml", ".config/gh/hosts.yml"],
    ["/Users/example/Library/Application Support/Google/Chrome/Default/Cookies", "Cookies"],
    ["/Users/example/Library/Application Support/Google/Chrome/Local State", "Local State"],
    [
      "/Users/example/Library/Application Support/Google/Chrome/Default/Login Data-journal",
      "Login Data*",
    ],
  ])("%s 命中 %s", (path, pattern) => {
    expect(matchCredentialPath(path)).toBe(pattern);
  });

  it.each([
    "/Users/example/project/notes.md",
    "/Users/example/Cardiary/cards/abc.md",
    "/Users/example/.config/other/settings.json",
    "/Users/example/.config/gh/config.yml",
    "/Users/example/project/keyboard-layout.json",
    "/Users/example/project/env.md",
  ])("%s 不命中", (path) => {
    expect(matchCredentialPath(path)).toBeNull();
  });

  it("大小寫不敏感", () => {
    expect(matchCredentialPath("/Users/example/KEYS/ID_RSA")).toBe("id_rsa*");
    expect(matchCredentialPath("/tmp/STORE.P12")).toBe("*.p12");
  });

  it.each([
    ["--file=.env", ".env"],
    ["/Users/example/.ssh/id_rsa", ".ssh/**"],
    ["-w", null],
    ["notes.md", null],
    ["--include=*.pem", "*.pem"],
  ])("參數 %s 的比對結果是 %s", (argument, expected) => {
    expect(matchCredentialArgument(argument)).toBe(expected);
  });
});
