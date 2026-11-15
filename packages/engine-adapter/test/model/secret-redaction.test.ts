import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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

/**
 * 供應商錯誤回顯金鑰時，原文不能落地。
 *
 * 這條測試跑一個真的 Pi 回合：假供應商回 401，body 與 header 都含這次
 * 請求的金鑰（原文、Bearer 形式與 URL 編碼）。回合結束後掃描整個資料夾
 * （含 `state/engine.sqlite` 與 WAL／SHM）、行程的 stdout／stderr 和事件，
 * 都必須找不到金鑰；對外失敗仍然是乾淨的 `credential_invalid`。
 */

const SECRET = "sk-test-model-source-0123456789";
const ENCODED = encodeURIComponent(SECRET);

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

async function filesIn(root: string): Promise<Array<{ path: string; content: Buffer }>> {
  const files: Array<{ path: string; content: Buffer }> = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      files.push({ path, content: await readFile(path) });
    }
  }
  await walk(root);
  return files;
}

function filesWith(files: Array<{ path: string; content: Buffer }>, needle: string): string[] {
  return files.filter((file) => file.content.includes(needle)).map((file) => file.path);
}

describe("模型錯誤不外洩金鑰", () => {
  it("供應商回顯金鑰時，資料夾、輸出與事件都找不到金鑰，對外仍是 credential_invalid", async () => {
    const server = await startFakeOpenAI({
      chat: () => ({
        kind: "status",
        status: 401,
        body: JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${SECRET}. Authorization: Bearer ${SECRET}; encoded=${ENCODED}`,
          },
        }),
        headers: { "x-echo-authorization": `Bearer ${SECRET}` },
      }),
    });
    servers.push(server);
    const root = await mkdtemp(join(tmpdir(), "cardiary-secret-redaction-"));
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

    const stdout = captureOutput(process.stdout);
    const stderr = captureOutput(process.stderr);
    let failure: unknown;
    const events: Array<Record<string, unknown>> = [];
    try {
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
          failure = completed.failure;
        } finally {
          subscription.close();
          void collected;
        }
      } finally {
        await adapter.close();
      }
    } finally {
      stdout.restore();
      stderr.restore();
    }

    // 假供應商真的收到這次請求與金鑰，否則後面的掃描沒有意義。
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);

    // 對外失敗只有固定的原因與中文說明。
    expect(failure).toMatchObject({
      code: "model-unavailable",
      details: { reason: "credential_invalid", retryable: false },
    });

    const files = await filesIn(root);
    expect(files.some((file) => file.path.endsWith("state/engine.sqlite"))).toBe(true);
    expect(filesWith(files, SECRET)).toEqual([]);
    expect(filesWith(files, ENCODED)).toEqual([]);
    // 清洗過的原文確實進了引擎的持久化，證明上面掃的是同一份錯誤。
    expect(files.some((file) => file.content.includes("[redacted]"))).toBe(true);

    const frames = JSON.stringify(events);
    expect(frames).not.toContain(SECRET);
    expect(frames).not.toContain(ENCODED);
    expect(stdout.text()).not.toContain(SECRET);
    expect(stdout.text()).not.toContain(ENCODED);
    expect(stderr.text()).not.toContain(SECRET);
    expect(stderr.text()).not.toContain(ENCODED);
  }, 90_000);

  it("金鑰含引號與反斜線時，錯誤原文裡重複跳脫的形式也換掉", async () => {
    // 引擎持久化前還會再 JSON.stringify 一次；含 json= 的跳脫形式要能被清掉。
    const secret = 'sk-proj-"slash\\key"';
    const once = JSON.stringify(secret).slice(1, -1);
    const twice = JSON.stringify(once).slice(1, -1);
    const server = await startFakeOpenAI({
      chat: () => ({
        kind: "status",
        status: 401,
        body: JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${secret}; json=${once}`,
          },
        }),
      }),
    });
    servers.push(server);
    const root = await mkdtemp(join(tmpdir(), "cardiary-secret-redaction-esc-"));
    roots.push(root);
    const credentials: ProviderCredentialSource = {
      async resolve() {
        return { provider: "fake", kind: "api-key", secret };
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
        await waitFor(
          () => events.find((event) => event.kind === "turn.completed"),
          "turn.completed",
          60_000,
        );
      } finally {
        subscription.close();
        void collected;
      }
    } finally {
      await adapter.close();
    }

    const files = await filesIn(root);
    const leaks = files.filter(
      (file) =>
        file.content.includes(secret) ||
        file.content.includes(once) ||
        file.content.includes(twice),
    );
    expect(leaks.map((file) => file.path)).toEqual([]);
  }, 90_000);
});
