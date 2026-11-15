import { afterEach, describe, expect, it } from "vitest";

import type { ModelSettings } from "@cardiary/engine-adapter";

import { UNCONFIGURED_MODEL } from "../../src/models/state.js";
import { HOST_SERVICE_NAMES } from "../../src/modules/contract.js";
import { TestClient, startTestHost, type TestHost } from "../helpers.js";

/**
 * `session.create` 的主力模型檢查（`docs/design/models.md` 第 6 節）。
 *
 * 判斷標準是引擎建立對話時實際會用的模型；`models` 服務提供原因碼。
 * 沒有設定模組的組裝（假引擎、腳本化模型）由引擎自己持有模型，服務缺席
 * 不能反過來擋掉可用的對話。
 */

const hosts: TestHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

async function boot(options?: Parameters<typeof startTestHost>[0]): Promise<TestHost> {
  const host = await startTestHost(options);
  hosts.push(host);
  return host;
}

async function helloClient(host: TestHost): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  const requestId = await client.hello(host.token);
  await client.waitForReply(requestId);
  return client;
}

/** 假引擎的預設模型；`startTestHost` 沒有注入 `modelSettings` 時用它。 */
function configuredSettings(): ModelSettings {
  return {
    providers: [],
    roles: {
      main: { provider: "fake", model: "fake-main" },
      small: { provider: "fake", model: "fake-small" },
      writing: { provider: "fake", model: "fake-writing" },
      "system-one": { provider: "fake", model: "fake-system-one" },
    },
  };
}

/** 轉接層與模型模組共用的「沒有設定」佔位值。 */
function unconfiguredSettings(): ModelSettings {
  const selection = { ...UNCONFIGURED_MODEL };
  return {
    providers: [],
    roles: {
      main: selection,
      small: selection,
      writing: selection,
      "system-one": selection,
    },
  };
}

function provideModels(host: TestHost, configured: () => boolean): void {
  host.host.hostServices.provide(HOST_SERVICE_NAMES.models, {
    configured,
    async invoke(): Promise<never> {
      throw new Error("這個測試不會呼叫背景模型");
    },
  });
}

async function createSession(
  client: TestClient,
  clientRequestId = "cr-model-gate",
): Promise<{ readonly code?: string; readonly details?: Record<string, unknown> }> {
  const id = client.request("session.create", { clientRequestId });
  return client.waitForReply(id);
}

describe("session.create 的模型檢查", () => {
  it("沒有設定 main：回 unsupported 與 model_not_configured，不建立對話", async () => {
    const host = await boot({ modelSettings: unconfiguredSettings() });
    provideModels(host, () => false);
    const client = await helloClient(host);

    const reply = await createSession(client);
    expect(reply.code).toBe("unsupported");
    expect(reply.details).toEqual({ reason: "model_not_configured" });

    // 沒有建立對話：列表仍是空的。
    const list = client.request("session.list", {});
    const listed = await client.waitForReply(list);
    expect((listed.payload as { sessions: unknown[] }).sessions).toEqual([]);

    // 檢查在去重之前：同一個 clientRequestId 重送仍是同一個錯誤，不是 conflict。
    const retry = await createSession(client);
    expect(retry.code).toBe("unsupported");
    expect(retry.details).toEqual({ reason: "model_not_configured" });
    await client.close();
  });

  it("有設定 main：正常建立對話", async () => {
    const host = await boot({ modelSettings: configuredSettings() });
    provideModels(host, () => true);
    const client = await helloClient(host);

    const reply = await createSession(client);
    expect(reply.code).toBeUndefined();
    const session = (reply.payload as { session: { id: string } }).session;
    expect(session.id).toBeTruthy();

    const list = client.request("session.list", {});
    const listed = await client.waitForReply(list);
    expect((listed.payload as { sessions: { id: string }[] }).sessions.map((s) => s.id)).toContain(
      session.id,
    );
    await client.close();
  });

  it("models 服務缺席、引擎有模型：照常建立（假引擎與腳本化組裝）", async () => {
    const host = await boot();
    const client = await helloClient(host);

    const reply = await createSession(client);
    expect(reply.code).toBeUndefined();
    expect((reply.payload as { session: { id: string } }).session.id).toBeTruthy();
    await client.close();
  });

  it("models 服務缺席、引擎也沒有模型：回 unsupported 與 model_unavailable，不崩潰", async () => {
    const host = await boot({ modelSettings: unconfiguredSettings() });
    const client = await helloClient(host);

    const reply = await createSession(client);
    expect(reply.code).toBe("unsupported");
    expect(reply.details).toEqual({ reason: "model_unavailable" });
    await client.close();
  });

  it("models 服務查詢丟錯：不讓請求變成 internal，仍回明確原因", async () => {
    const host = await boot({ modelSettings: unconfiguredSettings() });
    provideModels(host, () => {
      throw new Error("模型服務壞了");
    });
    const client = await helloClient(host);

    const reply = await createSession(client);
    expect(reply.code).toBe("unsupported");
    expect(reply.details).toEqual({ reason: "model_unavailable" });
    await client.close();
  });

  it("models 服務說已設定、引擎卻沒有模型：不建立第一個請求一定失敗的對話", async () => {
    const host = await boot({ modelSettings: unconfiguredSettings() });
    provideModels(host, () => true);
    const client = await helloClient(host);

    const reply = await createSession(client);
    expect(reply.code).toBe("unsupported");
    expect(reply.details).toEqual({ reason: "model_unavailable" });
    await client.close();
  });

  it("models 服務在閘道啟動後才提供：設定變更對下一次建立生效", async () => {
    const host = await boot({ modelSettings: unconfiguredSettings() });
    const client = await helloClient(host);

    const blocked = await createSession(client, "cr-before");
    expect(blocked.code).toBe("unsupported");
    expect(blocked.details).toEqual({ reason: "model_unavailable" });

    // 設定模組可能比閘道晚啟用：它會先設定引擎、再提供 models 服務。
    await host.host.engine.configureModels(configuredSettings());
    provideModels(host, () => true);
    const created = await createSession(client, "cr-after");
    expect(created.code).toBeUndefined();
    expect((created.payload as { session: { id: string } }).session.id).toBeTruthy();
    await client.close();
  });
});
