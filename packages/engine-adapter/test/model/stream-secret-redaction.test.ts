import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
 * 200 的 `text/event-stream` 也要在交回 pi-ai 之前清洗。
 *
 * OpenAI 相容端點可以先回 200，再在串流中途送 `error` 事件；事件裡的
 * message 若回顯這次請求的金鑰，pi-ai 會原文放進對話資料夾的 `state/
 * engine.sqlite`。這條測試跑一個真的 Pi 回合，假供應商回 200 串流與
 * 含金鑰的 error 事件；回合結束後掃描整個資料夾（含 `entries`、
 * `submissions` 與 `document_revisions` 所在的資料庫與 WAL／SHM）、
 * stdout／stderr 與事件 frames，都必須找不到金鑰；對外失敗仍然是
 * 乾淨的 `credential_invalid`。
 */

const SECRET = "sk-test-stream-redaction-0001";

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

/** 對 `state/engine.sqlite` 做一次全表掃描；只回「有沒有找到」，不回內容。 */
function sqliteContains(root: string, needle: string): boolean {
  const db = new DatabaseSync(join(root, "state/engine.sqlite"), { readOnly: true });
  try {
    const tables = db
      .prepare("select name from sqlite_master where type = ?")
      .all("table") as Array<{ name: string }>;
    for (const table of tables) {
      for (const row of db.prepare(`select * from "${table.name}"`).all()) {
        if (JSON.stringify(row).includes(needle)) {
          return true;
        }
      }
    }
    return false;
  } finally {
    db.close();
  }
}

interface TurnResult {
  readonly root: string;
  readonly events: Array<Record<string, unknown>>;
  readonly completed: Record<string, unknown>;
  readonly stdoutText: string;
  readonly stderrText: string;
}

async function runTurnWithBehavior(behavior: {
  readonly chat: Parameters<typeof startFakeOpenAI>[0]["chat"];
}): Promise<TurnResult> {
  const server = await startFakeOpenAI(behavior);
  servers.push(server);
  const root = await mkdtemp(join(tmpdir(), "cardiary-stream-redaction-"));
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
  const events: Array<Record<string, unknown>> = [];
  let completed: Record<string, unknown> | undefined;
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
        completed = await waitFor(
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
  } finally {
    stdout.restore();
    stderr.restore();
  }

  // 假供應商真的收到這次請求與金鑰，否則後面的掃描沒有意義。
  expect(servers.at(-1)?.requests).toHaveLength(1);
  expect(servers.at(-1)?.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);

  return {
    root,
    events,
    completed: completed ?? {},
    stdoutText: stdout.text(),
    stderrText: stderr.text(),
  };
}

describe("200 串流裡的 error 事件不外洩金鑰", () => {
  it("error 事件把金鑰送出來時，資料夾、事件與輸出都找不到金鑰，對外仍是 credential_invalid", async () => {
    const sse = [
      `data: ${JSON.stringify({
        error: {
          message: `Incorrect API key provided: ${SECRET}`,
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const { root, events, completed, stdoutText, stderrText } = await runTurnWithBehavior({
      chat: () => ({ kind: "stream-raw", chunks: sse }),
    });

    expect(completed).toMatchObject({
      status: "failed",
      failure: {
        code: "model-unavailable",
        details: { reason: "credential_invalid", retryable: false },
      },
    });

    const files = await filesIn(root);
    expect(files.some((file) => file.path.endsWith("state/engine.sqlite"))).toBe(true);
    // 這三張表是引擎持久化錯誤原文的地方。
    expect(sqliteContains(root, SECRET)).toBe(false);
    expect(filesWith(files, SECRET)).toEqual([]);
    // 清洗過的原文確實進了引擎的持久化，證明上面掃的是同一份錯誤。
    expect(files.some((file) => file.content.includes("[redacted]"))).toBe(true);

    const frames = JSON.stringify(events);
    expect(frames).not.toContain(SECRET);
    expect(stdoutText).not.toContain(SECRET);
    expect(stderrText).not.toContain(SECRET);
  }, 90_000);

  it("金鑰切成兩個 chunk 送來時也換掉，持久化掃描找不到金鑰", async () => {
    const middle = Math.floor(SECRET.length / 2);
    const sse = [
      'data: {"error":{"message":"Incorrect API key provided: ',
      SECRET.slice(0, middle),
      `${SECRET.slice(middle)}","type":"invalid_request_error","code":"invalid_api_key"}}\n\n`,
      "data: [DONE]\n\n",
    ];
    const { root, events, completed, stdoutText, stderrText } = await runTurnWithBehavior({
      chat: () => ({ kind: "stream-raw", chunks: sse }),
    });

    expect(completed).toMatchObject({
      status: "failed",
      failure: {
        code: "model-unavailable",
        details: { reason: "credential_invalid", retryable: false },
      },
    });

    const files = await filesIn(root);
    expect(sqliteContains(root, SECRET)).toBe(false);
    expect(filesWith(files, SECRET)).toEqual([]);

    const frames = JSON.stringify(events);
    expect(frames).not.toContain(SECRET);
    expect(stdoutText).not.toContain(SECRET);
    expect(stderrText).not.toContain(SECRET);
  }, 90_000);

  it("正常的 200 串流回覆不受清洗影響，逐字收到完整的中文", async () => {
    const text = "串流內容完成";
    const { events, completed, stdoutText, stderrText } = await runTurnWithBehavior({
      chat: () => ({ kind: "text", text }),
    });

    expect(completed).toMatchObject({ status: "completed" });
    const deltas = events
      .filter((event) => event.kind === "assistant.text.delta")
      .map((event) => (typeof event.text === "string" ? event.text : ""));
    expect(deltas.join("")).toContain(text);

    // 正常回覆一個字都沒被換掉。
    expect(stdoutText).not.toContain(SECRET);
    expect(stderrText).not.toContain(SECRET);
  }, 90_000);
});
