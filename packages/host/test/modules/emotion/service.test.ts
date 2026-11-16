/**
 * 情緒狀態的主機整合測試。
 *
 * 用真的狀態檔、真的 `EmotionService`、假引擎與閘道，驗證：兩場對話
 * 共用同一份狀態、每一則訊息帶自己送出當下的快照、快照只有一行且在
 * token 預算內，以及模組沒有提供服務時上下文不含這一層。
 *
 * 尾端插入的位置由轉接層的測試負責（`engine-adapter/test/context`）：
 * 這裡看的是閘道交給引擎的那一行，轉接層把它接在時間之後、訊息尾端。
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { estimateTokens, formatEmotionLine, type EmotionState } from "@cardiary/domain";
import type { EngineLogger } from "@cardiary/engine-adapter";
import { EmotionStore } from "@cardiary/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MemoryApprovalLedger,
  MemoryDeletionIntents,
  MemoryEventLog,
  MemoryRequestDedupe,
  MemoryRuntimeState,
  MemoryTurnIndex,
} from "../../../src/index.js";
import { Gateway } from "../../../src/gateway/server.js";
import { HOST_SERVICE_NAMES, type ModuleHostBridge } from "../../../src/modules/contract.js";
import { EmotionService } from "../../../src/modules/emotion/service.js";
import type { StorageBundle } from "../../../src/storage/interfaces.js";
import { TestClient } from "../../helpers.js";
import { createContextFixture, type ContextFixture } from "../../context/support.js";

const silentLogger: EngineLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const CLIENT_TOKEN = "E".repeat(43);

let fixture: ContextFixture;
let host: Host | null = null;

interface Host {
  readonly gateway: Gateway;
  readonly port: number;
  readonly client: TestClient;
  close(): Promise<void>;
}

beforeEach(async () => {
  fixture = await createContextFixture();
});

afterEach(async () => {
  await host?.close();
  host = null;
  fixture.close();
});

function memoryStorage(): StorageBundle {
  return {
    events: new MemoryEventLog(),
    runtime: new MemoryRuntimeState(),
    dedupe: new MemoryRequestDedupe(),
    approvals: new MemoryApprovalLedger(),
    turnIndex: new MemoryTurnIndex(),
    deletions: new MemoryDeletionIntents(),
    folder: { path: fixture.root, folderId: "folder_emotion", displayName: "情緒" },
  } as StorageBundle;
}

/** 測試只關心閘道交給引擎的尾端上下文，不依賴引擎的公開型別。 */
interface SentRequest {
  readonly trailingContext?: string;
}

/** 記下閘道交給引擎的每一次送出；其他呼叫一律轉給真正的假引擎。 */
function recordingEngine(sent: SentRequest[]): ContextFixture["engine"] {
  const engine = fixture.engine;
  const calls = engine as unknown as Record<PropertyKey, unknown>;
  return new Proxy(engine, {
    get(target, property) {
      if (property === "sendMessage" || property === "sendMessageWithClientId") {
        return async (request: SentRequest) => {
          sent.push(request);
          const method = calls[property] as (value: SentRequest) => Promise<unknown>;
          return method.call(target, request);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function modulesWith(services: ReadonlyMap<string, unknown>): ModuleHostBridge {
  return {
    listModules: () => [],
    activeToolBundles: () => [],
    setModuleEnabled: async () => {
      throw new Error("測試不啟用模組");
    },
    hasExactHandler: () => false,
    hasPrefixHandler: () => false,
    dispatchProtocol: async () => {
      throw new Error("測試不分派協定");
    },
    dispatchHttp: async () => null,
    hostServices: {
      get<T>(name: string): T | undefined {
        return services.get(name) as T | undefined;
      },
    },
  } as unknown as ModuleHostBridge;
}

async function start(sent: SentRequest[], services: ReadonlyMap<string, unknown>): Promise<Host> {
  const gateway = new Gateway({
    engine: recordingEngine(sent),
    storage: memoryStorage(),
    epoch: "epoch-emotion",
    clientToken: CLIENT_TOKEN,
    logger: silentLogger,
    status: () => ({
      folderState: "ready",
      displayName: "情緒",
      writable: true,
      serviceState: "running",
      version: "0.1.0",
      uptimeSeconds: 0,
      activeTasks: 0,
    }),
    modules: modulesWith(services),
  });
  const port = await gateway.listen(0);
  const client = await TestClient.connect(`ws://127.0.0.1:${port}/v1/ws`);
  await client.waitForReply(await client.hello(CLIENT_TOKEN));
  return {
    gateway,
    port,
    client,
    close: async () => {
      await client.close();
      await gateway.close();
    },
  };
}

function emotionService(stateDirectory: string): EmotionService {
  return new EmotionService(new EmotionStore(stateDirectory, () => {}), () => new Date());
}

async function createSession(client: TestClient): Promise<string> {
  const reply = await client.waitForReply(
    client.request("session.create", { clientRequestId: `cr-${Math.random()}` }),
  );
  return (reply.payload as { session: { id: string } }).session.id;
}

async function sendMessage(client: TestClient, sessionId: string, text: string): Promise<void> {
  const reply = await client.waitForReply(
    client.request("session.send_message", { sessionId, text, delivery: "queue" }),
  );
  if (reply.kind !== "response") {
    throw new Error(`send_message 失敗：${String(reply.code)} ${JSON.stringify(reply.payload)}`);
  }
}

describe("情緒狀態", () => {
  it("兩場對話共用同一份狀態，每一則訊息帶著送出當下的快照", async () => {
    const sent: SentRequest[] = [];
    const directory = join(fixture.root, "state");
    mkdirSync(directory, { recursive: true });
    host = await start(sent, new Map([[HOST_SERVICE_NAMES.emotion, emotionService(directory)]]));

    const first = await createSession(host.client);
    const second = await createSession(host.client);
    await sendMessage(host.client, first, "謝謝，太好了");
    await sendMessage(host.client, second, "真糟糕，我很失望");

    expect(sent).toHaveLength(2);
    const leading = sent[0]?.trailingContext;
    const following = sent[1]?.trailingContext;
    expect(leading).toBeTypeOf("string");
    expect(following).toBeTypeOf("string");
    // 快照是送出當下算的：第二則從第一則留下的狀態繼續調整。
    const valenceOf = (line: string): number => Number(/平穩程度 (-?\d\.\d{2})/u.exec(line)?.[1]);
    expect(valenceOf(leading ?? "")).toBeGreaterThan(0);
    expect(valenceOf(following ?? "")).toBeLessThan(valenceOf(leading ?? ""));
    const state = JSON.parse(readFileSync(join(directory, "emotion.json"), "utf8")) as EmotionState;
    expect(following).toBe(formatEmotionLine(state));
    expect(state.valence).toBeLessThan(0.01);
  });

  it("快照只有一行，且在 120 token 的預算內", async () => {
    const sent: SentRequest[] = [];
    const directory = join(fixture.root, "state");
    mkdirSync(directory, { recursive: true });
    host = await start(sent, new Map([[HOST_SERVICE_NAMES.emotion, emotionService(directory)]]));

    const sessionId = await createSession(host.client);
    await sendMessage(host.client, sessionId, "你好");

    const line = sent[0]?.trailingContext ?? "";
    expect(line).not.toContain("\n");
    expect(estimateTokens(line)).toBeLessThanOrEqual(120);
    expect(line).toMatch(
      /^情緒狀態：、平穩程度 -?\d\.\d{2}（-1 到 1）、激發程度 \d\.\d{2}（0 到 1）、信心 \d\.\d{2}（0 到 1）、專注 \d\.\d{2}（0 到 1）$/u,
    );
  });

  it("模組沒有提供服務時，送出的訊息不帶這一層，也不建立狀態檔", async () => {
    const sent: SentRequest[] = [];
    const directory = join(fixture.root, "state");
    host = await start(sent, new Map());

    const sessionId = await createSession(host.client);
    await sendMessage(host.client, sessionId, "你好");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.trailingContext).toBeUndefined();
    expect(existsSync(join(directory, "emotion.json"))).toBe(false);
  });
});
