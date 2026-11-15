import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { ApprovalRequest, EngineEvent } from "@cardiary/engine-adapter";
import type { FakeModelStep } from "@cardiary/engine-fake";

import type { RunningHost } from "../../../src/bootstrap.js";
import type { CardEnvironment } from "../../../src/modules/contract.js";
import { HOST_SERVICE_NAMES } from "../../../src/modules/contract.js";
import {
  LOCAL_TOOLS_BUNDLE_ID,
  LOCAL_TOOLS_SERVICES,
} from "../../../src/modules/local-tools/index.js";
import { ALLOWLIST_DETAIL_LABELS } from "../../../src/permissions/gate.js";
import type { AllowlistEntry } from "../../../src/permissions/allowlist.js";
import type { PermissionDecisionService } from "../../../src/permissions/decisions.js";
import { startTestHost, TestClient, waitUntil, type TestHost } from "../../helpers.js";

/**
 * 本機工具的端到端行為：真的主機組裝、真的權限閘道、真的子行程。
 *
 * 這裡直接對引擎建立對話並釘選 local-tools 工具組。產品對話目前由閘道
 * 建立、只釘選示範工具組；閘道要釘選模組工具組是組合根的後續工作，
 * 不是這個模組能自己決定的（見工作交接的障礙）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const distModule = join(here, "../../../dist/modules/local-tools/index.js");
const human = { kind: "human" as const, clientId: "test-client" };

const hosts: TestHost[] = [];

afterEach(async () => {
  for (const testHost of hosts.splice(0)) {
    await testHost.close();
  }
});

async function modulesDirectory(): Promise<string> {
  if (!existsSync(distModule)) {
    throw new Error(`找不到 ${distModule}；請先執行 pnpm build。`);
  }
  const directory = await mkdtemp(join(tmpdir(), "cardiary-local-tools-modules-"));
  await mkdir(join(directory, "local-tools"), { recursive: true });
  await writeFile(
    join(directory, "local-tools", "index.js"),
    `export { hostModule } from ${JSON.stringify(pathToFileURL(distModule).href)};\n`,
  );
  return directory;
}

interface Conversation {
  readonly host: TestHost;
  readonly running: RunningHost;
  readonly conversationId: string;
}

async function startConversation(
  scripts: readonly (readonly FakeModelStep[])[] = [],
): Promise<Conversation> {
  const host = await startTestHost({
    demo: false,
    modulesDirectory: await modulesDirectory(),
    scripts,
  });
  hosts.push(host);
  const running = host.host;
  const bundles = await running.engine.tools.list();
  const localTools = bundles.find((bundle) => bundle.bundleId === LOCAL_TOOLS_BUNDLE_ID);
  expect(localTools).toBeDefined();
  const conversation = await running.engine.createConversation({
    title: "本機工具測試",
    model: { provider: "faux", model: "faux-1" },
    systemContext: "測試本機工具",
    toolBundles: [{ bundleId: LOCAL_TOOLS_BUNDLE_ID, generation: localTools!.generation }],
    permissionMode: "hard-rules",
  });
  return { host, running, conversationId: conversation.id };
}

/** 跑一個回合，遇到審批就交給 `onApproval`；回合結束才回傳。 */
async function runTurn(
  conversation: Conversation,
  text: string,
  onApproval: (request: ApprovalRequest) => Promise<void> | void = async () => {
    throw new Error("這個回合不該建立審批");
  },
): Promise<readonly EngineEvent[]> {
  const subscription = conversation.running.engine.subscribe({
    conversationId: conversation.conversationId,
  });
  const iterator = subscription.events[Symbol.asyncIterator]();
  const events: EngineEvent[] = [];
  try {
    await conversation.running.engine.sendMessage({
      conversationId: conversation.conversationId,
      content: [{ type: "text", text }],
      delivery: "queue",
      sender: human,
    });
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      const event = next.value;
      events.push(event);
      if (event.kind === "approval.requested") {
        await onApproval(event.request);
      }
      if (event.kind === "turn.completed") break;
    }
  } finally {
    subscription.close();
  }
  return events;
}

function toolOutcomes(events: readonly EngineEvent[]) {
  return events.filter((event) => event.kind === "tool.finished");
}

/** 這一回合唯一一個工具結果；不是剛好一個就回 `null`。 */
function singleOutcome(events: readonly EngineEvent[]) {
  const finished = toolOutcomes(events);
  if (finished.length !== 1) return null;
  const event = finished[0]!;
  return event.kind === "tool.finished" ? event.outcome : null;
}

function approveWith(
  conversation: Conversation,
  effect: "approve" | "reject" | "approve_always",
): (request: ApprovalRequest) => Promise<AllowlistEntry | null> {
  return async (request) => {
    if (effect === "approve_always") {
      const decisions = conversation.host.host.hostServices.get<PermissionDecisionService>(
        LOCAL_TOOLS_SERVICES.permissionDecision,
      );
      expect(decisions).toBeDefined();
      const outcome = await decisions!.decide({
        requestId: request.id,
        effect,
        decidedBy: human,
      });
      expect(outcome.outcome).toBe("accepted");
      return outcome.outcome === "accepted" ? outcome.allowlist : null;
    }
    const result = await conversation.running.engine.approvals.decide({
      requestId: request.id,
      verdict: effect === "reject" ? "deny" : "approve",
      decidedBy: human,
    });
    expect(result.outcome).toBe("accepted");
    return null;
  };
}

describe("本機檔案與終端機的實際行為", () => {
  it("讀工作目錄的檔案自動放行，不建立審批", async () => {
    const conversation = await startConversation([
      [{ kind: "tool", toolName: "read_file", input: { path: "notes.md" } }],
    ]);
    await writeFile(join(conversation.host.folder.path, "notes.md"), "筆記內容\n");

    const events = await runTurn(conversation, "讀檔");

    expect(events.some((event) => event.kind === "approval.requested")).toBe(false);
    const outcome = singleOutcome(events);
    expect(outcome).not.toBeNull();
    expect(outcome!.ok).toBe(true);
  });

  it("寫檔建立審批；核准後才寫入", async () => {
    const conversation = await startConversation([
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: "approved.md", content: "核准後寫入" },
        },
      ],
    ]);
    const requests: ApprovalRequest[] = [];

    await runTurn(conversation, "寫檔", async (request) => {
      requests.push(request);
      await approveWith(conversation, "approve")(request);
    });

    expect(requests).toHaveLength(1);
    const details = requests[0]!.draft.action.details ?? [];
    expect(
      details.find((detail) => detail.label === ALLOWLIST_DETAIL_LABELS.actionKind)?.value,
    ).toBe("fs.write");
    expect(details.find((detail) => detail.label === ALLOWLIST_DETAIL_LABELS.scopeKey)?.value).toBe(
      realpathSync(conversation.host.folder.path),
    );
    expect(readFileSync(join(conversation.host.folder.path, "approved.md"), "utf8")).toBe(
      "核准後寫入",
    );
  });

  it("核准並一律允許後，同工具同目錄的下一寫檔不再詢問", async () => {
    const conversation = await startConversation([
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: "first.md", content: "第一次" },
        },
      ],
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: "sub/next.md", content: "第二次" },
        },
      ],
    ]);
    await mkdir(join(conversation.host.folder.path, "sub"), { recursive: true });

    let granted: AllowlistEntry | null = null;
    await runTurn(conversation, "第一次", async (request) => {
      granted = await approveWith(conversation, "approve_always")(request);
    });
    expect(granted).not.toBeNull();
    expect(granted!.scopeKey).toBe(realpathSync(conversation.host.folder.path));

    const events = await runTurn(conversation, "第二次");
    expect(events.some((event) => event.kind === "approval.requested")).toBe(false);
    expect(readFileSync(join(conversation.host.folder.path, "sub/next.md"), "utf8")).toBe("第二次");
  });

  it("白名單存在時，憑證檔仍然直接拒絕", async () => {
    const conversation = await startConversation([
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: "first.md", content: "第一次" },
        },
      ],
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: ".env", content: "SECRET=1" },
        },
      ],
    ]);

    await runTurn(conversation, "第一次", async (request) => {
      await approveWith(conversation, "approve_always")(request);
    });

    const events = await runTurn(conversation, "寫金鑰檔");
    expect(events.some((event) => event.kind === "approval.requested")).toBe(false);
    expect(singleOutcome(events)?.ok).toBe(false);
    expect(existsSync(join(conversation.host.folder.path, ".env"))).toBe(false);
  });

  it.skipIf(process.platform !== "darwin")(
    "按過「一律允許」之後，保護路徑仍由作業系統拒絕",
    async () => {
      const conversation = await startConversation([
        [
          {
            kind: "tool",
            toolName: "run_command",
            input: { command: "echo warmup > warmup.txt" },
          },
        ],
        [
          {
            kind: "tool",
            toolName: "run_command",
            // 路徑藏在程式字串裡，解析器的掃描看不到真正的目標；白名單會放行，
            // 這一筆要證明 OS 層仍擋住 state/cardiary.sqlite。
            input: {
              command: `node -e 'require("node:fs").writeFileSync("state/cardiary.sqlite", "hacked")'`,
            },
          },
        ],
      ]);
      const folder = conversation.host.folder.path;
      const stateDb = join(folder, "state", "cardiary.sqlite");
      const before = readFileSync(stateDb);

      const warmup = await runTurn(conversation, "先跑正常指令", async (request) => {
        await approveWith(conversation, "approve_always")(request);
      });
      expect(singleOutcome(warmup)?.ok).toBe(true);

      const events = await runTurn(conversation, "再跑越界指令");
      expect(events.some((event) => event.kind === "approval.requested")).toBe(false);
      const outcome = singleOutcome(events);
      expect(outcome).not.toBeNull();
      expect(outcome!.ok).toBe(false);
      expect(
        outcome!.diagnostics?.some(
          (diagnostic) =>
            diagnostic.code === "permission-denied" && diagnostic.message === "sandbox-denied",
        ),
      ).toBe(true);
      expect(readFileSync(stateDb).equals(before)).toBe(true);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "核准藏在程式字串裡的越界指令後，作業系統沙盒仍拒絕寫入資料夾外",
    async () => {
      const conversation = await startConversation([
        [
          {
            kind: "tool",
            toolName: "run_command",
            input: {
              command: `node -e 'require("node:fs").writeFileSync("../escape.txt", "x")'`,
            },
          },
        ],
      ]);
      const escape = join(realpathSync(join(conversation.host.folder.path, "..")), "escape.txt");

      const events = await runTurn(conversation, "越界寫入", async (request) => {
        await approveWith(conversation, "approve")(request);
      });

      const outcome = singleOutcome(events);
      expect(outcome).not.toBeNull();
      expect(outcome!.ok).toBe(false);
      expect(
        outcome!.diagnostics?.some(
          (diagnostic) =>
            diagnostic.code === "permission-denied" && diagnostic.message === "sandbox-denied",
        ),
      ).toBe(true);
      expect(existsSync(escape)).toBe(false);
      // 模型看得到的訊息不含 OS 原文或路徑。
      const serialized = JSON.stringify(outcome);
      expect(serialized.toLowerCase()).not.toContain("operation not permitted");
      expect(serialized).not.toContain(escape);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "工具輸出超過上限時只留頭尾，完整內容進 tmp 並登記，關機後清空",
    async () => {
      const conversation = await startConversation([
        [
          {
            kind: "tool",
            toolName: "run_command",
            input: { command: "seq 1 20000" },
          },
        ],
      ]);

      const events = await runTurn(conversation, "大輸出", async (request) => {
        await approveWith(conversation, "approve")(request);
      });

      const outcome = singleOutcome(events);
      expect(outcome).not.toBeNull();
      expect(outcome!.ok).toBe(true);
      const text =
        outcome!.content?.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
      expect(text).toContain("輸出被截斷");
      expect(text).toContain("tmp/local-tools/");
      expect(text).toContain("20000");

      const spillRoot = join(conversation.host.folder.path, "tmp", "local-tools");
      const turnDirectories = await readdir(spillRoot);
      expect(turnDirectories).toHaveLength(1);
      const spillFiles = await readdir(join(spillRoot, turnDirectories[0]!));
      expect(spillFiles).toHaveLength(1);
      const spillPath = join(spillRoot, turnDirectories[0]!, spillFiles[0]!);
      expect(readFileSync(spillPath, "utf8")).toContain("20000");

      const cardEnvironment = conversation.host.host.hostServices.get<CardEnvironment>(
        HOST_SERVICE_NAMES.cardStorage,
      );
      expect(cardEnvironment).toBeDefined();
      const rows = cardEnvironment!.state.all<{ rel_path: string }>(
        "SELECT rel_path FROM file_registry WHERE owner_kind = 'tool-call'",
      );
      expect(rows).toHaveLength(1);

      const folder = conversation.host.folder.path;
      hosts.splice(hosts.indexOf(conversation.host), 1);
      await conversation.host.close();

      expect(existsSync(spillRoot)).toBe(false);
      // tmp 區域本身留著，只有這個回合的暫存目錄被清掉。
      expect(existsSync(join(folder, "tmp"))).toBe(true);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "緊急全部暫停後，執行中的指令已經結束，沒有孤兒行程",
    async () => {
      const conversation = await startConversation([
        [
          {
            kind: "tool",
            toolName: "run_command",
            input: { command: "echo $$ > pause.pid; sleep 30" },
          },
        ],
      ]);
      const pidFile = join(conversation.host.folder.path, "pause.pid");

      const turn = runTurn(conversation, "長指令", async (request) => {
        await approveWith(conversation, "approve")(request);
      });
      await waitUntil(() => existsSync(pidFile), 5000);
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      expect(Number.isInteger(pid)).toBe(true);

      const client = await TestClient.connect(conversation.host.url);
      try {
        const hello = await client.hello(conversation.host.token);
        await client.waitForReply(hello);
        const pause = client.request("approval.pause_all", { reason: "測試" });
        const reply = await client.waitForReply(pause);
        expect(reply.kind).toBe("response");
      } finally {
        await client.close();
      }

      await turn;
      await waitUntil(() => !isRunning(pid), 5000);
      expect(isRunning(pid)).toBe(false);
    },
    30_000,
  );
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
