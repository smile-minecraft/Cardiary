import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { makeFolder, startTestHost, TestClient, type TestHost } from "../../helpers.js";

/**
 * 第一方模組的真實載入：`dist/modules/settings/`。
 *
 * `loadFirstPartyModules` 只在 `dist/modules` 找得到 `index.js`；單元測試
 * 直接組裝，這裡驗的是閘道 → 模組主機 → 設定儲存的完整路徑。
 */

const MODULES_DIRECTORY = fileURLToPath(new URL("../../../dist/modules", import.meta.url));
const SECRET = "{{SECRET_z9ncut8n}}";
const hosts: TestHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close().catch(() => undefined);
  }
});

interface CapturedOutput {
  text(): string;
  restore(): void;
}

function captureOutput(stream: NodeJS.WriteStream): CapturedOutput {
  const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  let collected = "";
  stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    collected +=
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
    return original(chunk, ...rest);
  }) as typeof stream.write;
  return {
    text: () => collected,
    restore: () => {
      stream.write = original as unknown as typeof stream.write;
    },
  };
}

async function hello(host: TestHost): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  const reply = await client.waitForReply(await client.hello(host.token));
  if (reply.kind === "error") throw new Error(`hello 失敗：${String(reply.code)}`);
  const subscribed = client.request("system.subscribe", {});
  await client.waitForReply(subscribed);
  return client;
}

async function boot(folder: Awaited<ReturnType<typeof makeFolder>>): Promise<TestHost> {
  const host = await startTestHost({
    folder,
    assembly: "fake",
    modulesDirectory: MODULES_DIRECTORY,
  });
  hosts.push(host);
  return host;
}

describe("模型與設定模組", () => {
  it("載入 modules/settings，提供 system.models.* 與 system.settings.*", async () => {
    const folder = await makeFolder();
    const host = await boot(folder);
    const client = await hello(host);
    try {
      const listed = await client.waitForReply(client.request("system.modules.get", {}));
      const modules = (listed.payload as { modules: Array<{ moduleId: string; state: string }> })
        .modules;
      expect(modules.find((entry) => entry.moduleId === "settings")?.state).toBe("active");

      const models = await client.waitForReply(client.request("system.models.get", {}));
      expect(models.payload).toMatchObject({
        providers: [],
        roles: [
          { role: "main", mode: "unset" },
          { role: "small", mode: "unset" },
          { role: "writing", mode: "unset" },
          { role: "system-one", mode: "unset" },
        ],
        resolved: [
          { role: "main", source: "none" },
          { role: "small", source: "none" },
          { role: "writing", source: "none" },
          { role: "system-one", source: "none" },
        ],
      });
    } finally {
      await client.close();
    }
  });

  it("system.models.set 設定供應商與角色；設定持久化，重啟後還在", async () => {
    const folder = await makeFolder();
    const first = await boot(folder);
    const client = await hello(first);
    try {
      const set = await client.waitForReply(
        client.request("system.models.set", {
          providers: [
            {
              providerId: "local",
              kind: "local",
              displayName: "本機",
              baseUrl: "http://127.0.0.1:1/v1",
              models: [{ modelId: "local-model", contextWindow: 32_768, input: ["text"] }],
            },
          ],
          roles: [
            {
              role: "main",
              mode: "model",
              ref: { providerId: "local", modelId: "local-model" },
            },
          ],
          clientRequestId: "set-1",
        }),
      );
      expect(set.kind).not.toBe("error");
      const resolved = (set.payload as { resolved: Array<Record<string, unknown>> }).resolved;
      expect(resolved[0]).toMatchObject({
        role: "main",
        source: "configured",
        ref: { providerId: "local", modelId: "local-model" },
      });
      expect(JSON.stringify(set.payload)).not.toContain(SECRET);
      await client.waitForEvent("system.models.changed");
    } finally {
      await client.close();
    }
    await first.close();

    const second = await boot(folder);
    const again = await hello(second);
    try {
      const models = await again.waitForReply(again.request("system.models.get", {}));
      const payload = models.payload as {
        providers: Array<{ providerId: string }>;
        roles: Array<{ role: string; mode: string }>;
      };
      expect(payload.providers.map((entry) => entry.providerId)).toEqual(["local"]);
      expect(payload.roles.find((entry) => entry.role === "main")).toEqual({
        role: "main",
        mode: "model",
        ref: { providerId: "local", modelId: "local-model" },
      });
    } finally {
      await again.close();
    }
  });

  it("system.settings.set 修改一般設定；模型鍵由 system.models.set 專用", async () => {
    const folder = await makeFolder();
    const host = await boot(folder);
    const client = await hello(host);
    try {
      const changed = await client.waitForReply(
        client.request("system.settings.set", {
          changes: [{ key: "models.summary.maxOutputTokens", value: 8_192 }],
          clientRequestId: "settings-1",
        }),
      );
      expect(changed.kind).not.toBe("error");
      expect(changed.payload).toMatchObject({ requiresApproval: false });
      await client.waitForEvent("system.settings.changed");

      const got = await client.waitForReply(client.request("system.settings.get", {}));
      const summary = (
        got.payload as { settings: Array<{ key: string; value: unknown }> }
      ).settings.find((entry) => entry.key === "models.summary.maxOutputTokens");
      expect(summary?.value).toBe(8_192);
    } finally {
      await client.close();
    }
  });

  it("設定變更不會把金鑰寫進資料夾、輸出或錯誤輸出", async () => {
    const folder = await makeFolder();
    const host = await boot(folder);
    const client = await hello(host);
    const stdout = captureOutput(process.stdout);
    const stderr = captureOutput(process.stderr);
    try {
      const reply = await client.waitForReply(
        client.request("system.models.set", {
          providers: [
            {
              providerId: "local",
              kind: "local",
              displayName: "本機",
              baseUrl: "http://127.0.0.1:1/v1",
              // 用戶端誤帶的金鑰欄位：協定沒有這些欄位，伺服器只讀 schema 內的。
              apiKey: SECRET,
              secret: SECRET,
              models: [{ modelId: "local-model", contextWindow: 32_768, input: ["text"] }],
            },
          ],
          roles: [
            {
              role: "main",
              mode: "model",
              ref: { providerId: "local", modelId: "local-model" },
            },
          ],
          clientRequestId: "set-2",
          apiKey: SECRET,
        }),
      );
      expect(reply.kind).not.toBe("error");
      await client.close().catch(() => undefined);
    } finally {
      stdout.restore();
      stderr.restore();
      // 保留：關閉交給 afterEach；資料夾掃描必須在關閉前做。
    }
    const found = await scanForSecret(folder.path, SECRET);
    expect(found).toEqual([]);
    expect(stdout.text()).not.toContain(SECRET);
    expect(stderr.text()).not.toContain(SECRET);
  });
});

async function scanForSecret(root: string, secret: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const content = await readFile(path);
      if (content.includes(secret)) found.push(path);
    }
  }
  await walk(root);
  return found;
}
