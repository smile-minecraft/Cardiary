import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { startTestHost, makeFolder, TestClient, type TestHost } from "../../helpers.js";

/**
 * 組合根接上模組主機的整合測試。
 *
 * 模組目錄用暫存目錄，避免依賴 `dist/modules/` 裡實際有哪些模組；驗證的
 * 是掃描、啟用、停用持久化與引擎權限回呼的呼叫當下解析。
 */

interface ModuleOptions {
  readonly id: string;
  readonly activate: string;
}

async function makeModulesDirectory(modules: readonly ModuleOptions[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-bootstrap-modules-"));
  for (const module of modules) {
    await mkdir(join(root, module.id), { recursive: true });
    await writeFile(
      join(root, module.id, "index.js"),
      `
export const hostModule = {
  manifest: {
    id: ${JSON.stringify(module.id)},
    name: ${JSON.stringify(module.id)},
    version: "1.0.0",
    hostApiVersion: "1",
    dependencies: [],
    permissions: [],
    settings: [],
  },
  async activate(context) {
    ${module.activate}
  },
};
`,
    );
  }
  return root;
}

const hosts: TestHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

function boot(options: Parameters<typeof startTestHost>[0]): Promise<TestHost> {
  const started = startTestHost(options);
  void started.then((host) => hosts.push(host));
  return started;
}

async function hello(host: TestHost): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  const reply = await client.waitForReply(await client.hello(host.token));
  if (reply.kind === "error") throw new Error(`hello 失敗：${String(reply.code)}`);
  return client;
}

async function createSession(client: TestClient): Promise<string> {
  const created = await client.waitForReply(
    client.request("session.create", { clientRequestId: `cr-${Math.random()}` }),
  );
  return (created.payload as { session: { id: string } }).session.id;
}

describe("組合根的模組接線", () => {
  it("掃描模組目錄、接上閘道；停用後協定前綴消失，重啟後停用狀態仍在", async () => {
    const folder = await makeFolder();
    const directory = await makeModulesDirectory([
      {
        id: "alpha",
        activate:
          'context.services.protocol.registerNamespace("alpha", async (request) => ({ type: request.type }));',
      },
    ]);

    const first = await boot({ folder, modulesDirectory: directory });
    const client = await hello(first);
    try {
      const listed = await client.waitForReply(client.request("system.modules.get", {}));
      const modules = (listed.payload as { modules: Array<{ moduleId: string; state: string }> })
        .modules;
      expect(modules.find((module) => module.moduleId === "alpha")?.state).toBe("active");

      const ping = await client.waitForReply(client.request("alpha.ping", {}));
      expect((ping.payload as { type: string }).type).toBe("alpha.ping");

      const disabled = await client.waitForReply(
        client.request("system.modules.set_enabled", {
          moduleId: "alpha",
          enabled: false,
          clientRequestId: `disable-${Math.random()}`,
        }),
      );
      expect((disabled.payload as { module: { state: string } }).module.state).toBe("inactive");
      const blocked = await client.waitForReply(client.request("alpha.ping", {}));
      expect(blocked.code).toBe("unsupported");
    } finally {
      await client.close().catch(() => undefined);
    }
    await first.close();

    const second = await boot({ folder, modulesDirectory: directory });
    const again = await hello(second);
    try {
      const listed = await again.waitForReply(again.request("system.modules.get", {}));
      const modules = (
        listed.payload as { modules: Array<{ moduleId: string; enabled: boolean; state: string }> }
      ).modules;
      const alpha = modules.find((module) => module.moduleId === "alpha");
      expect(alpha?.enabled).toBe(false);
      expect(alpha?.state).toBe("inactive");
    } finally {
      await again.close().catch(() => undefined);
    }
  }, 30_000);

  it("引擎的權限回呼在呼叫當下取模組提供的 toolPermissionGate", async () => {
    const modulesDirectory = await makeModulesDirectory([
      {
        id: "gatekeeper",
        activate:
          'context.services.host.provide("toolPermissionGate", { evaluate: async () => ({ kind: "allow" }) });',
      },
    ]);
    const host = await boot({
      modulesDirectory,
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "hi" } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const client = await hello(host);
    try {
      const sessionId = await createSession(client);
      client.request("session.subscribe", { sessionId });
      client.request("session.send_message", {
        sessionId,
        text: "用工具",
        delivery: "queue",
      });
      const call = await client.waitForEvent("stream.tool_call", 6000);
      expect((call.payload as { name?: string }).name).toBe("demo.echo");
      // 權限閘道回 allow：不該出現審批請求。
      expect(client.frames.some((frame) => frame.type === "approval.requested")).toBe(false);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 30_000);
});
