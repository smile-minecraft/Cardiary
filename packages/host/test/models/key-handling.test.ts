import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 靜態掃描：服務端沒有列舉或寫入金鑰的路徑，協定也沒有金鑰欄位。 */

const HOST_SRC = fileURLToPath(new URL("../../src", import.meta.url));
const ENGINE_SRC = fileURLToPath(new URL("../../../engine-adapter/src", import.meta.url));
const PROTOCOL_SCHEMA = fileURLToPath(
  new URL("../../../protocol/schema/protocol.schema.json", import.meta.url),
);

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("金鑰的路徑", () => {
  it("broker 只呼叫 broker.keychain.get，沒有列舉、寫入或刪除", async () => {
    const routes: string[] = [];
    for (const file of [...(await sourceFiles(HOST_SRC)), ...(await sourceFiles(ENGINE_SRC))]) {
      const content = await readFile(file, "utf8");
      for (const match of content.matchAll(/keychain\.[a-z-]+/g)) {
        routes.push(match[0]);
      }
    }
    expect([...new Set(routes)]).toEqual(["keychain.get"]);
  });

  it("協定 schema 沒有 apiKey 或 secret 欄位", async () => {
    const schema = await readFile(PROTOCOL_SCHEMA, "utf8");
    expect(schema.includes('"apiKey"')).toBe(false);
    expect(schema.includes('"secret"')).toBe(false);
    expect(schema.includes('"keychain"')).toBe(false);
    // 只帶帳號名，不是金鑰本身。
    expect(schema.includes('"credentialRef"')).toBe(true);
  });

  it("模型與設定模組不直接讀寫鑰匙圈；憑證只經 ProviderCredentialSource", async () => {
    for (const directory of [
      join(HOST_SRC, "models"),
      join(HOST_SRC, "settings"),
      join(HOST_SRC, "modules", "settings"),
    ]) {
      for (const file of await sourceFiles(directory)) {
        const content = await readFile(file, "utf8");
        expect(content.includes("keychain.")).toBe(false);
        expect(content.includes("broker.keychain")).toBe(false);
      }
    }
  });
});
