import { fstatSync } from "node:fs";
import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { bundleOf, createFixture, gateWith, toolThenAnswer } from "./support.js";
import type { ToolDefinition } from "../src/index.js";

function scriptTool(script: string): ToolDefinition {
  return {
    name: "run-script",
    description: "透過共用 wrapper 跑一段 shell",
    replay: "unsafe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_input, context) {
      const child = context.spawn({ command: "/bin/sh", args: ["-c", script] });
      const result = await child.collect();
      if (result.code !== 0) {
        return { ok: false, message: result.stderr || `exit ${result.code}` };
      }
      return { ok: true, content: [{ type: "text", text: result.stdout.trim() }] };
    },
  };
}

async function runAndRead(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  tool: ToolDefinition,
): Promise<string> {
  await fixture.adapter.tools.register(bundleOf("test.spawn", [tool], 1));
  const conversation = await fixture.adapter.createConversation({
    model: { provider: "faux", model: "faux-1" },
    systemContext: "前綴",
    toolBundles: [{ bundleId: "test.spawn", generation: 1 }],
  });
  fixture.faux.setResponses(toolThenAnswer("run-script", {}, "完成"));
  await fixture.adapter.sendMessage({
    conversationId: conversation.id,
    content: [{ type: "text", text: "跑" }],
    delivery: "queue",
    sender: { kind: "human", clientId: "test" },
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const history = await fixture.adapter.readConversationHistory({
      conversationId: conversation.id,
    });
    const toolMessage = history.messages.find((message) => message.role === "tool");
    if (toolMessage !== undefined) {
      return toolMessage.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待工具結果逾時");
}

describe("工具子行程", () => {
  it("TMPDIR、TMP、TEMP 指向 tempDir，檔案不落在資料夾外", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      const script = [
        'echo "TMPDIR=$TMPDIR"',
        'echo "TMP=$TMP"',
        'echo "TEMP=$TEMP"',
        'name="$TMPDIR/probe-$$"',
        'touch "$name"',
        'echo "file=$name"',
      ].join("\n");
      const output = await runAndRead(fixture, scriptTool(script));
      const tempDir = fixture.environment.tempDir;
      expect(output).toContain(`TMPDIR=${tempDir}`);
      expect(output).toContain(`TMP=${tempDir}`);
      expect(output).toContain(`TEMP=${tempDir}`);
      const fileLine = output.split("\n").find((line) => line.startsWith("file="));
      const file = fileLine?.slice("file=".length) ?? "";
      expect(file.startsWith(tempDir)).toBe(true);

      const spilled = await readdir(tempDir, { recursive: true });
      expect(spilled.some((entry) => String(entry).includes("probe-"))).toBe(true);
      const outside = await readdir(fixture.environment.defaultWorkingDir).catch(() => []);
      expect(outside).toEqual([]);
      const rootFiles = await readdir(fixture.root);
      expect(rootFiles.every((name) => ["state", "tmp", "work"].includes(name))).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 30000);

  it("要求 inherit 被拒絕，stdio 只有 pipe 或 ignore", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      const tool: ToolDefinition = {
        name: "run-script",
        description: "驗證 stdio",
        replay: "unsafe",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute(_input, context) {
          try {
            context.spawn({ command: "/bin/echo", args: ["x"], stdio: "inherit" as never });
            return { ok: true, content: [{ type: "text", text: "沒有被拒絕" }] };
          } catch (error) {
            return {
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
      };
      const output = await runAndRead(fixture, tool);
      expect(output).toContain("只允許 pipe 或 ignore");
    } finally {
      await fixture.cleanup();
    }
  }, 30000);

  it("工具的 fd 0／1／2 與服務的 stdin／stdout 不同", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      // 用 Node 的 fstatSync 讀 inode，不用 /usr/bin/stat：BSD 的 `-f` 在
      // Ubuntu 是別的意思，這個測試要在兩個平台都能跑。
      const program =
        'const fs=require("node:fs");for(const fd of [0,1,2])console.log("inode"+fd+"="+fs.fstatSync(fd).ino)';
      const script = `"${process.execPath}" -e '${program}'`;
      const output = await runAndRead(fixture, scriptTool(script));
      const read = (name: string): number => {
        const value = new RegExp(`${name}=(\\d+)`).exec(output)?.[1];
        expect(value, `找不到 ${name}：${output}`).toBeDefined();
        return Number(value);
      };
      const serviceInode = Number(fstatSync(0).ino);
      const serviceOut = Number(fstatSync(1).ino);
      expect(read("inode0")).toBeGreaterThan(0);
      expect(read("inode0")).not.toBe(serviceInode);
      expect(read("inode1")).not.toBe(serviceOut);
      expect(read("inode1")).not.toBe(read("inode0"));
    } finally {
      await fixture.cleanup();
    }
  }, 30000);

  it("暫停對整個 process group 送訊號，孫行程也被殺掉", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      const tool: ToolDefinition = {
        name: "run-script",
        description: "啟動孫行程後終止整個 group",
        replay: "unsafe",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute(_input, context) {
          const child = context.spawn({
            command: "/bin/sh",
            args: ["-c", "sleep 60 & echo $!; wait"],
          });
          const grandchild = await new Promise<number>((resolve) => {
            child.child.stdout?.once("data", (chunk: Buffer) => {
              resolve(Number(chunk.toString().trim().split("\n")[0]));
            });
          });
          child.terminate("SIGKILL");
          await child.exited;
          return { ok: true, content: [{ type: "text", text: String(grandchild) }] };
        },
      };
      const output = await runAndRead(fixture, tool);
      const grandchild = Number(output.trim());
      expect(grandchild).toBeGreaterThan(0);
      const deadline = Date.now() + 3000;
      let alive = true;
      while (Date.now() < deadline) {
        try {
          process.kill(grandchild, 0);
          await new Promise((resolve) => setTimeout(resolve, 20));
        } catch {
          alive = false;
          break;
        }
      }
      expect(alive).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }, 30000);
});
