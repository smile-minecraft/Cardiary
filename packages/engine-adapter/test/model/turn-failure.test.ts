import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  EngineModelSource,
  ModelSettings,
  ProviderCredentialSource,
} from "../../src/index.js";
import {
  createEngineAdapter,
  createInMemoryApprovalLedger,
  createProviderModelSource,
} from "../../src/index.js";
import { silentLogger, waitFor } from "../support.js";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";

const SECRET = "sk-test-turn-failure-0001";

const servers: FakeOpenAI[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function sendOneTurn(behavior: Parameters<typeof startFakeOpenAI>[0]["chat"]): Promise<{
  readonly status: string;
  readonly failure: unknown;
}> {
  const server = await startFakeOpenAI({ chat: behavior });
  servers.push(server);
  const root = await mkdtemp(join(tmpdir(), "cardiary-model-failure-"));
  roots.push(root);
  const credentials: ProviderCredentialSource = {
    async resolve() {
      return { provider: "fake", kind: "api-key", secret: SECRET };
    },
  };
  const models: EngineModelSource = createProviderModelSource({ credentials });
  const settings: ModelSettings = {
    providers: [
      {
        provider: "fake",
        baseUrl: server.baseUrl,
        credentialRef: "cardiary/provider/fake",
        models: [{ id: "fake-model", contextWindow: 8_192, input: ["text"] }],
      },
    ],
    roles: {
      main: { provider: "fake", model: "fake-model" },
      small: { provider: "fake", model: "fake-model" },
      writing: { provider: "fake", model: "fake-model" },
      "system-one": { provider: "fake", model: "fake-model" },
    },
  };
  const adapter = createEngineAdapter({
    environment: {
      stateDir: join(root, "state"),
      tempDir: join(root, "tmp"),
      defaultWorkingDir: root,
    },
    approvals: createInMemoryApprovalLedger(),
    permissionGate: { evaluate: async () => ({ kind: "deny", reason: "測試不呼叫工具" }) },
    credentials,
    logger: silentLogger,
    models,
  });
  await adapter.open();
  try {
    await adapter.configureModels(settings);
    const conversation = await adapter.createConversation({
      purpose: "conversation",
      model: { provider: "fake", model: "fake-model" },
      systemContext: "測試",
      toolBundles: [],
    });
    const subscription = adapter.subscribe({ conversationId: conversation.id });
    const events: Array<Record<string, unknown>> = [];
    const collected = (async () => {
      for await (const event of subscription.events) {
        events.push(event as unknown as Record<string, unknown>);
      }
    })();
    try {
      await adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "你好" }],
        delivery: "reject",
        sender: { kind: "system", component: "test" },
      });
      const completed = await waitFor(
        () => events.find((event) => event.kind === "turn.completed"),
        "turn.completed",
        60_000,
      );
      return {
        status: String(completed.status),
        failure: completed.failure,
      };
    } finally {
      subscription.close();
      void collected;
    }
  } finally {
    await adapter.close();
  }
}

describe("模型錯誤變成回合失敗", () => {
  it("金鑰無效：回合 failed、model-unavailable、原因 credential_invalid", async () => {
    const result = await sendOneTurn(() => ({
      kind: "status",
      status: 401,
      body: JSON.stringify({ error: { message: "Incorrect API key provided" } }),
    }));
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      code: "model-unavailable",
      details: { reason: "credential_invalid", retryable: false },
    });
    const failure = result.failure as { message: string };
    expect(failure.message).not.toContain(SECRET);
  });

  it("額度用盡：原因 quota_exceeded、標成可重試", async () => {
    const result = await sendOneTurn(() => ({
      kind: "status",
      status: 429,
      body: JSON.stringify({ error: { message: "rate limit reached" } }),
    }));
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      code: "model-unavailable",
      details: { reason: "quota_exceeded", retryable: true },
    });
  }, 90_000);

  it("斷線：原因 connection_failed、回合不會卡住", async () => {
    const result = await sendOneTurn(() => ({
      kind: "status",
      status: 502,
      body: JSON.stringify({ error: { message: "upstream connect ECONNREFUSED" } }),
    }));
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      code: "model-unavailable",
      details: { reason: "connection_failed" },
    });
  }, 90_000);
});
