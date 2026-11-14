/* global process, setTimeout */
// 子行程夾具：跑真引擎流程，讓測試在工具執行中或等待審批時強制結束行程。
// 用建置後的 dist，因為 Node 直接執行 TypeScript 需要型別剝除，不是 CI 的前提。
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { createEngineAdapter } from "../../dist/index.js";
import { createFileApprovalLedger } from "./file-ledger.mjs";

const root = process.env.CARDIARY_ROOT;
const mode = process.env.CARDIARY_MODE;
if (root === undefined || mode === undefined) {
  throw new Error("缺少 CARDIARY_ROOT 或 CARDIARY_MODE");
}

const log = join(root, "effects.log");
const ledgerPath = join(root, "approvals.json");
await mkdir(join(root, "state"), { recursive: true });
await mkdir(join(root, "tmp"), { recursive: true });
await mkdir(join(root, "work"), { recursive: true });

function tool(name, replay, execute) {
  return {
    name,
    description: name,
    replay,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute,
  };
}

const tools = [
  tool("effect", "safe", async () => {
    await appendFile(log, "effect\n");
    return { ok: true, content: [{ type: "text", text: "effect-done" }] };
  }),
  tool("crash", "unsafe", async () => {
    await appendFile(log, "crash-enter\n");
    process.kill(process.pid, "SIGKILL");
    return { ok: true, content: [{ type: "text", text: "不應該到這裡" }] };
  }),
  tool("gated", "safe", async (_input, context) => {
    await appendFile(log, "enter\n");
    const resolution = await context.requestApproval({
      conversationId: context.conversationId,
      turnId: context.turnId,
      toolCallId: context.callId,
      action: {
        kind: "tool-execution",
        summary: "需要核准的副作用",
        toolName: "gated",
        toolInput: {},
      },
      risk: "medium",
      requestedBy: { kind: "tool", toolName: "gated" },
    });
    if (resolution.outcome !== "approved") {
      return { ok: false, message: `未核准：${resolution.outcome}` };
    }
    await appendFile(log, "effect\n");
    return { ok: true, content: [{ type: "text", text: "gated-done" }] };
  }),
];

const faux = fauxProvider();
const adapter = createEngineAdapter({
  environment: {
    stateDir: join(root, "state"),
    tempDir: join(root, "tmp"),
    defaultWorkingDir: join(root, "work"),
  },
  approvals: createFileApprovalLedger(ledgerPath),
  permissionGate: {
    evaluate: async () => ({ kind: "allow" }),
  },
  credentials: { resolve: async () => ({ provider: "faux", kind: "none", secret: "" }) },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  models: {
    open: async () => {
      const models = createModels();
      models.setProvider(faux.provider);
      return models;
    },
    close: async () => {},
  },
});
await adapter.open();
await adapter.configureModels({
  providers: [
    {
      provider: "faux",
      credentialRef: "test",
      models: [{ id: "faux-1", displayName: "Faux", contextWindow: 100000, input: ["text"] }],
    },
  ],
  roles: {
    main: { provider: "faux", model: "faux-1" },
    small: { provider: "faux", model: "faux-1" },
    writing: { provider: "faux", model: "faux-1" },
    "system-one": { provider: "faux", model: "faux-1" },
  },
});
await adapter.tools.register({
  bundleId: "child.tools",
  generation: 1,
  label: "child",
  tools,
});
const conversation = await adapter.createConversation({
  model: { provider: "faux", model: "faux-1" },
  systemContext: "子行程",
  toolBundles: [{ bundleId: "child.tools", generation: 1 }],
  clientRequestId: "child-conv",
});

if (mode === "crash") {
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("effect", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("crash", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("不應該到這裡"),
  ]);
} else {
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("gated", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("完成"),
  ]);
}

await adapter.sendMessage({
  conversationId: conversation.id,
  content: [{ type: "text", text: "開始" }],
  delivery: "queue",
  sender: { kind: "human", clientId: "child" },
  clientMessageId: "child-msg",
});

if (mode === "approval") {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const pending = await adapter.approvals.listPending();
    if (pending.length > 0) {
      process.stdout.write(`PENDING ${pending[0].id} ${pending[0].approvalKey}\n`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // 等待父行程強制結束這個行程。
  await new Promise(() => {});
} else {
  // crash 模式由工具自己 SIGKILL；這裡只是保底。
  await new Promise((resolve) => setTimeout(resolve, 30000));
}
