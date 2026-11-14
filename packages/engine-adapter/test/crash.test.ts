import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { appendFile } from "node:fs/promises";

import { answer, bundleOf, createFixture, gateWith, waitFor } from "./support.js";
import type { ToolDefinition } from "../src/index.js";
import { createFileApprovalLedger } from "./fixtures/file-ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "engine-child.mjs");

interface ChildRun {
  readonly process: ReturnType<typeof spawn>;
  readonly lines: string[];
  readonly exited: Promise<number | null>;
}

function startChild(root: string, mode: "crash" | "approval"): ChildRun {
  const child = spawn(process.execPath, [fixturePath], {
    env: { ...process.env, CARDIARY_ROOT: root, CARDIARY_MODE: mode },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.length > 0) {
        lines.push(line);
      }
    }
  });
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code));
  });
  return { process: child, lines, exited };
}

async function readEffects(root: string): Promise<string[]> {
  try {
    return (await readFile(join(root, "effects.log"), "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("當機續跑", () => {
  it("工具執行中強制結束行程，重啟後已完成的工具不重跑、被中斷的工具回 interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "cardi-crash-"));
    try {
      const child = startChild(root, "crash");
      const code = await child.exited;
      expect(code).not.toBe(0);
      const before = await readEffects(root);
      expect(before).toEqual(["effect", "crash-enter"]);

      const fixture = await createFixture({ root, responses: answer("從中斷處完成") });
      try {
        const found = await fixture.adapter.findConversationByClientRequestId("child-conv");
        expect(found).not.toBeNull();
        const restored = await fixture.adapter.restoreConversation(found!.id);
        expect(restored.recoveredTurns.length).toBeGreaterThan(0);

        const deadline = Date.now() + 15000;
        let rendered = "";
        while (Date.now() < deadline) {
          const history = await fixture.adapter.readConversationHistory({
            conversationId: found!.id,
          });
          rendered = history.messages
            .map((message) =>
              message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
            )
            .join("\n");
          const conversation = await fixture.adapter.getConversation(found!.id);
          if (conversation?.state === "idle" && rendered.includes("從中斷處完成")) {
            break;
          }
          await new Promise((resolveTick) => setTimeout(resolveTick, 30));
        }
        const after = await readEffects(root);
        // 已完成的第一個工具沒有重跑；被 SIGKILL 中斷的 unsafe 工具沒有重跑。
        expect(after).toEqual(["effect", "crash-enter"]);
        expect(rendered).toContain("interrupted");
        expect(rendered).toContain("從中斷處完成");
      } finally {
        await fixture.cleanup();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);

  it("等待審批時強制結束行程，重啟後先寫入的核准讓工具續跑、副作用只一次", async () => {
    const root = await mkdtemp(join(tmpdir(), "cardi-approval-crash-"));
    try {
      const child = startChild(root, "approval");
      const pendingLine = await waitFor(
        () => child.lines.find((line) => line.startsWith("PENDING ")),
        "子行程送出審批請求",
        20000,
      );
      const [, requestId, approvalKey] = pendingLine.split(" ");
      expect(requestId).toBeTruthy();
      expect(approvalKey).toMatch(/^[0-9a-f]{64}$/);

      child.process.kill("SIGKILL");
      await child.exited;
      expect(await readEffects(root)).toEqual(["enter"]);

      // 停機期間先寫入核准：重開後工具重跑時讀到同一個 key 的決定。
      const ledger = createFileApprovalLedger(join(root, "approvals.json"));
      const committed = await ledger.commitDecision({
        requestId: requestId as string,
        verdict: "approve",
        decidedAt: new Date().toISOString(),
        decidedBy: { kind: "human", clientId: "parent" },
      });
      expect(committed).toBe("committed");

      // 註冊表只在行程內；重啟後要在 open() 之前重新註冊對話釘選的版本。
      const restoreTool = (): ToolDefinition => ({
        name: "gated",
        description: "需要核准的副作用",
        replay: "safe",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute(_input, context) {
          await appendFile(join(root, "effects.log"), "enter\n");
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
          await appendFile(join(root, "effects.log"), "effect\n");
          return { ok: true, content: [{ type: "text", text: "gated-done" }] };
        },
      });
      const fixture = await createFixture({
        root,
        ledger: createFileApprovalLedger(join(root, "approvals.json")),
        responses: answer("已核准"),
        gate: gateWith({ kind: "allow" }),
      });
      try {
        // 真實流程：open() 只載入狀態，宿主註冊釘選的工具組之後才 restore（resume）。
        await fixture.adapter.tools.register(bundleOf("child.tools", [restoreTool()], 1));
        const found = await fixture.adapter.findConversationByClientRequestId("child-conv");
        expect(found).not.toBeNull();
        await fixture.adapter.restoreConversation(found!.id);
        await waitFor(async () => {
          const conversation = await fixture.adapter.getConversation(found!.id);
          const history = await fixture.adapter.readConversationHistory({
            conversationId: found!.id,
          });
          const text = history.messages
            .map((message) =>
              message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
            )
            .join("\n");
          return conversation?.state === "idle" && text.includes("gated-done") ? true : undefined;
        }, "重跑後完成");
        const after = await readEffects(root);
        // 工具重跑一次（enter 兩次），副作用只發生一次。
        expect(after).toEqual(["enter", "enter", "effect"]);
        const pending = await fixture.adapter.approvals.listPending();
        expect(pending).toHaveLength(0);
      } finally {
        await fixture.cleanup();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90000);
});

void resolve;
