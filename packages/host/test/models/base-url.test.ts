import { describe, expect, it } from "vitest";

import { ModelSettingsError } from "../../src/models/errors.js";
import { normalizeProviders } from "../../src/models/state.js";
import { provider } from "./support.js";

/**
 * 端點是金鑰的邊界。
 *
 * 請求會帶著金鑰送到 `baseUrl`；非本機位址用 http 等於把金鑰以明文交給
 * 任意端點。主機在設定時就拒絕，轉接層建立供應商時再擋一次。
 */

describe("供應商端點的傳輸規則", () => {
  it("非本機端點只接受 https", () => {
    let error: unknown;
    try {
      normalizeProviders([
        provider({ providerId: "remote", kind: "api-key", baseUrl: "http://api.example.com/v1" }),
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ModelSettingsError);
    expect((error as ModelSettingsError).field).toBe("providers[0].baseUrl");
    expect((error as ModelSettingsError).message).toContain("https");

    const providers = normalizeProviders([
      provider({ providerId: "remote", kind: "api-key", baseUrl: "https://api.example.com/v1" }),
    ]);
    expect(providers[0]?.baseUrl).toBe("https://api.example.com/v1");
  });

  it("本機端點可以用 http", () => {
    for (const baseUrl of [
      "http://127.0.0.1:8080/v1",
      "http://127.10.20.30:8080/v1",
      "http://localhost:8080/v1",
      "http://[::1]:8080/v1",
    ]) {
      const providers = normalizeProviders([provider({ providerId: "local", baseUrl })]);
      expect(providers[0]?.baseUrl).toBe(baseUrl);
    }
  });

  it("冒充本機位址的網域不算 loopback", () => {
    expect(() =>
      normalizeProviders([
        provider({ providerId: "fake-local", baseUrl: "http://127.0.0.1.example.com/v1" }),
      ]),
    ).toThrow(ModelSettingsError);
    expect(() =>
      normalizeProviders([
        provider({ providerId: "fake-local", baseUrl: "http://localhost.example.com/v1" }),
      ]),
    ).toThrow(ModelSettingsError);
  });
});
