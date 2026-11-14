import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";

import {
  createEngineAdapter,
  createInMemoryApprovalLedger,
} from "../src/index.js";
import type {
  ApprovalLedger,
  EngineAdapter,
  EngineAdapterOptions,
  EngineEnvironment,
  EngineLogger,
  EngineModelSource,
  JsonValue,
  ModelSettings,
  ToolBundleDraft,
  ToolDefinition,
  ToolPermissionGate,
  ToolPermissionVerdict,
} from "../src/index.js";

export const silentLogger: EngineLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface Fixture {
  readonly adapter: EngineAdapter;
  readonly faux: ReturnType<typeof fauxProvider>;
  readonly environment: EngineEnvironment;
  readonly ledger: ApprovalLedger;
  readonly root: string;
  close(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface FixtureOptions {
  readonly root?: string;
  readonly ledger?: ApprovalLedger;
  readonly gate?: ToolPermissionGate;
  readonly purger?: EngineAdapterOptions["purger"];
  readonly faux?: ReturnType<typeof fauxProvider>;
  readonly environment?: Partial<EngineEnvironment>;
  /** 在 `open()` 之前先排好的模型回應；續跑時第一個模型請求就會用到。 */
  readonly responses?: readonly AssistantMessage[];
  /** 在 `open()` 之前執行；主機就是在這個時機註冊模組的工具組。 */
  readonly beforeOpen?: (adapter: EngineAdapter) => Promise<void>;
}

/** 假模型 + SQLite 引擎的測試夾具；不需要金鑰與網路。 */
export async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "cardi-adapter-")));
  const environment: EngineEnvironment = {
    stateDir: join(root, "state"),
    tempDir: join(root, "tmp"),
    defaultWorkingDir: join(root, "work"),
    ...options.environment,
  };
  const faux = options.faux ?? fauxProvider();
  if (options.responses !== undefined) {
    faux.setResponses([...options.responses]);
  }
  const modelSource: EngineModelSource = {
    async open(): Promise<unknown> {
      const models = createModels();
      models.setProvider(faux.provider);
      return models;
    },
    async close() {},
  };
  const ledger = options.ledger ?? createInMemoryApprovalLedger();
  const gate: ToolPermissionGate =
    options.gate ?? { evaluate: async () => ({ kind: "ask-human", action: { kind: "tool-execution", summary: "執行工具" }, risk: "medium" }) };
  const adapter = createEngineAdapter({
    environment,
    approvals: ledger,
    permissionGate: gate,
    credentials: { resolve: async () => ({ provider: "faux", kind: "none", secret: "" }) },
    logger: silentLogger,
    models: modelSource,
    ...(options.purger === undefined ? {} : { purger: options.purger }),
  });
  if (options.beforeOpen !== undefined) {
    await options.beforeOpen(adapter);
  }
  await adapter.open();
  await adapter.configureModels(settingsFor());
  return {
    adapter,
    faux,
    environment,
    ledger,
    root,
    async close() {
      await adapter.close();
    },
    async cleanup() {
      await adapter.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function settingsFor(): ModelSettings {
  const selection = { provider: "faux", model: "faux-1" };
  return {
    providers: [
      {
        provider: "faux",
        credentialRef: "test",
        models: [{ id: "faux-1", displayName: "Faux", contextWindow: 100000, input: ["text"] }],
      },
    ],
    roles: { main: selection, small: selection, writing: selection, "system-one": selection },
  };
}

/** 腳本化模型回應：一次工具呼叫 + 最後的文字。 */
export function toolThenAnswer(name: string, input: Record<string, JsonValue>, answer = "完成"): AssistantMessage[] {
  return [
    fauxAssistantMessage([fauxToolCall(name, input) as ToolCall], { stopReason: "toolUse" }),
    fauxAssistantMessage(answer),
  ];
}

export function answer(text: string): AssistantMessage[] {
  return [fauxAssistantMessage(text)];
}

/** 可調整行為的權限閘道。 */
export function gateWith(verdict: ToolPermissionVerdict): ToolPermissionGate {
  return { evaluate: async () => verdict };
}

/** 收集事件直到條件成立。 */
export async function waitFor<T>(
  check: () => T | undefined | Promise<T | undefined>,
  label: string,
  timeoutMs = 8000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined && value !== false) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待逾時：${label}`);
}

/** 建立一個工具組草稿。 */
export function bundleOf(
  bundleId: string,
  tools: readonly ToolDefinition[],
  generation = 1,
): ToolBundleDraft & { generation: number } {
  return { bundleId, generation, label: bundleId, tools };
}

/** 一個會等待審批的工具。 */
export function approvalTool(options: {
  readonly name?: string;
  readonly replay?: "safe" | "unsafe";
  readonly run?: (input: JsonValue, context: { tempDir: string; turnId: string }) => Promise<void>;
} = {}): ToolDefinition {
  const name = options.name ?? "deploy";
  return {
    name,
    description: "需要審批的測試工具",
    replay: options.replay ?? "safe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(input, context) {
      const resolution = await context.requestApproval({
        conversationId: context.conversationId,
        turnId: context.turnId,
        toolCallId: context.callId,
        action: { kind: "tool-execution", summary: `執行 ${name}`, toolName: name, toolInput: input },
        risk: "medium",
        requestedBy: { kind: "tool", toolName: name },
      });
      if (resolution.outcome !== "approved") {
        return {
          ok: false,
          message: resolution.outcome === "expired" ? "審批逾時" : "使用者拒絕",
          diagnostics: [{ code: resolution.outcome === "expired" ? "approval-expired" : "approval-denied" }],
        };
      }
      await options.run?.(input, { tempDir: context.tempDir, turnId: context.turnId });
      return { ok: true, content: [{ type: "text", text: `${name}-done` }] };
    },
  };
}

export async function collectEvents(
  adapter: EngineAdapter,
  conversationId: string,
  afterSeq = 0,
): Promise<{ events: unknown[]; close: () => void }> {
  const subscription = adapter.subscribe({ conversationId, afterSeq });
  const events: unknown[] = [];
  const task = (async () => {
    for await (const event of subscription.events) {
      events.push(event);
    }
  })();
  void task;
  return { events, close: () => subscription.close() };
}
