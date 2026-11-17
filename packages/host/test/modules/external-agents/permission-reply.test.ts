/**
 * 外部代理權限回覆的主機層往返測試。
 *
 * 這裡用真的 ExternalAgentsService、真的 SpawnRegistry 與 sandbox-exec 啟動
 * 一隻說 ACP 的假代理子行程。假代理會從 JSON-RPC 請求帶一個數字 id 0 或一個
 * 字串 id 提出權限請求，只有收到的回覆「id 型別與值都等於原請求、optionId
 * 也是它的選項」時才寫執行紀錄並回一輪完成。橋接層如果把 replyToken 轉成
 * 字串，假代理就會看出型別不符而不完成，測試因此失敗。
 *
 * 假代理不認識產品的 encoder，也不共用產品的正規化邏輯；它直接用 JSON 比對
 * id 的 typeof 與值，避免把數字轉成字串而掩蓋問題。
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CardiaryPaths } from "@cardiary/module-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  AgentApprovalRequestInput,
  AgentApprovalsService,
} from "../../../src/modules/contract.js";
import { ExternalAgentsService } from "../../../src/modules/external-agents/service.js";
import { agentStoragePaths, readRecord } from "../../../src/modules/external-agents/store.js";
import { SpawnRegistry } from "../../../src/spawn/wrapper.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const roots: string[] = [];
const agentDirs: string[] = [];
const harnesses: { service: ExternalAgentsService; registry: SpawnRegistry }[] = [];
const originalOpencodeCommand = process.env.CARDIARY_AGENT_COMMAND_OPENCODE;

type Outcome = "approved" | "denied" | "expired" | "withdrawn";

interface ApprovalEntry {
  readonly approvalId: string;
  readonly input: AgentApprovalRequestInput;
}

/** 記得每個 requestId 的決定；不論 decide 與 waitForDecision 誰先到都不會漏。 */
class RecordingApprovals implements AgentApprovalsService {
  readonly entries: ApprovalEntry[] = [];
  #count = 0;
  #pending = new Map<string, (value: { outcome: Outcome }) => void>();
  #decided = new Map<string, Outcome>();

  async request(input: AgentApprovalRequestInput): Promise<{ approvalId: string }> {
    this.#count += 1;
    const approvalId = `appr_${this.#count}`;
    this.entries.push({ approvalId, input });
    return { approvalId };
  }

  waitForDecision(approvalId: string): Promise<{ outcome: Outcome }> {
    const decided = this.#decided.get(approvalId);
    if (decided) {
      this.#decided.delete(approvalId);
      return Promise.resolve({ outcome: decided });
    }
    return new Promise((resolve) => this.#pending.set(approvalId, resolve));
  }

  async withdraw(approvalId: string): Promise<void> {
    this.#settle(approvalId, "withdrawn");
  }

  async withdrawPendingForAgent(): Promise<void> {
    for (const approvalId of [...this.#pending.keys()]) {
      this.#settle(approvalId, "withdrawn");
    }
  }

  approve(approvalId: string): void {
    this.#settle(approvalId, "approved");
  }

  deny(approvalId: string): void {
    this.#settle(approvalId, "denied");
  }

  approvalIdFor(requestId: string): string {
    const entry = this.entries.find((item) => item.input.requestId === requestId);
    if (!entry) throw new Error(`找不到審批：${requestId}`);
    return entry.approvalId;
  }

  #settle(approvalId: string, outcome: Outcome): void {
    const resolve = this.#pending.get(approvalId);
    if (resolve) {
      this.#pending.delete(approvalId);
      resolve({ outcome });
      return;
    }
    this.#decided.set(approvalId, outcome);
  }
}

/**
 * 假代理的原始程式。所有設定走 plan.json；它不 import 任何產品程式。
 *
 * 收到 session/prompt 後送一筆 session/request_permission，等回覆後直接比對
 * `typeof reply.id` 與值和原請求是否相同、optionId 是否等於預期。只有兩者都
 * 對才寫 marker 並回一輪完成；錯了就記 mismatch 且刻意不完成，讓 host 卡住。
 */
const AGENT_SOURCE = String.raw`import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const plan = JSON.parse(readFileSync(new URL("./plan.json", import.meta.url), "utf8"));
const log = (entry) => appendFileSync(plan.logFile, JSON.stringify(entry) + "\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");

let permissionResolve = null;
const waitPermission = () => new Promise((resolve) => { permissionResolve = resolve; });

let promptSent = false;
async function runPrompt() {
  if (promptSent) return;
  promptSent = true;
  const req = plan.request;
  send({
    jsonrpc: "2.0",
    id: req.id,
    method: "session/request_permission",
    params: {
      sessionId: "sess_fake",
      toolCall: { toolName: "bash", title: req.title, rawInput: { command: "touch marker" } },
      options: [
        { optionId: req.allowOptionId, kind: "allow_once", name: "Allow once" },
        { optionId: req.denyOptionId, kind: "reject_once", name: "Reject" },
      ],
    },
  });
  const reply = await waitPermission();
  const replyId = reply.id;
  const optionId = reply.result?.outcome?.optionId;
  const typeOk = typeof replyId === typeof req.id && replyId === req.id;
  const optionOk = optionId === req.expectedOptionId;
  log({
    event: "permission-reply",
    requestId: req.id,
    requestType: typeof req.id,
    replyId,
    replyIdType: typeof replyId,
    optionId,
    typeOk,
    optionOk,
  });
  if (!typeOk || !optionOk) {
    log({ event: "mismatch-no-complete", requestId: req.id });
    return;
  }
  if (optionId === req.allowOptionId) {
    writeFileSync(plan.markerFile, "executed\n");
    log({ event: "executed", requestId: req.id });
  } else {
    log({ event: "denied", requestId: req.id });
  }
  send({ jsonrpc: "2.0", id: 100, result: { stopReason: "end_turn" } });
  log({ event: "completed" });
  setInterval(() => undefined, 1000);
}

function handle(frame) {
  if (frame.method === "initialize") {
    send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    return;
  }
  if (frame.method === "session/new") {
    send({ jsonrpc: "2.0", id: frame.id, result: { sessionId: "sess_fake" } });
    return;
  }
  if (frame.method === "session/set_config_option") {
    send({ jsonrpc: "2.0", id: frame.id, result: {} });
    return;
  }
  if (frame.method === "session/prompt") {
    void runPrompt();
    return;
  }
  if (frame.method === "session/cancel") {
    log({ event: "cancel" });
    setTimeout(() => process.exit(0), 10);
    return;
  }
  if (frame.result !== undefined && permissionResolve) {
    const resolve = permissionResolve;
    permissionResolve = null;
    resolve(frame);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let frame;
  try { frame = JSON.parse(text); } catch { log({ event: "bad-frame", text }); return; }
  handle(frame);
});
lines.on("close", () => process.exit(0));
`;

interface StrictAgentRequest {
  readonly id: number | string;
  readonly title: string;
  readonly allowOptionId: string;
  readonly denyOptionId: string;
  readonly expectedOptionId: string;
}

async function installStrictAgent(
  request: StrictAgentRequest,
  workingDirectory: string,
): Promise<{
  readonly command: string;
  readonly logFile: string;
  readonly markerFile: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "cardiary-permission-reply-agent-"));
  agentDirs.push(dir);
  const logFile = join(workingDirectory, "agent.log");
  const markerFile = join(workingDirectory, "marker.txt");
  const script = join(dir, "agent.mjs");
  const wrapper = join(dir, "agent");
  await writeFile(join(dir, "plan.json"), JSON.stringify({ request, logFile, markerFile }), "utf8");
  await writeFile(script, AGENT_SOURCE, "utf8");
  await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, "utf8");
  await chmod(wrapper, 0o755);
  return { command: wrapper, logFile, markerFile };
}

async function readAgentLog(logFile: string): Promise<readonly Record<string, unknown>[]> {
  try {
    return (await readFile(logFile, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function eventually(check: () => Promise<boolean> | boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("條件等待逾時");
}

async function makeHarness(): Promise<{
  service: ExternalAgentsService;
  registry: SpawnRegistry;
  approvals: RecordingApprovals;
  paths: CardiaryPaths;
  workingDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-permission-reply-root-"));
  roots.push(root);
  const workingDirectory = await mkdtemp(join(tmpdir(), "cardiary-permission-reply-work-"));
  roots.push(workingDirectory);
  const paths: CardiaryPaths = {
    root,
    cards: join(root, "cards"),
    assets: join(root, "assets"),
    boards: join(root, "boards"),
    skills: join(root, "skills"),
    state: join(root, "state"),
    modules: join(root, "modules"),
    cache: join(root, "cache"),
    tmp: join(root, "tmp"),
    logs: join(root, "logs"),
  };
  const registry = new SpawnRegistry();
  const approvals = new RecordingApprovals();
  const service = new ExternalAgentsService({
    paths,
    spawn: registry,
    approvals,
    emitState: () => undefined,
    now: () => NOW,
    homeDir: join(root, "home"),
    timeouts: {
      cancelGraceMs: 30,
      termGraceMs: 30,
      killGraceMs: 30,
      exitTaskTimeoutMs: 100,
      startupCleanupBudgetMs: 200,
    },
  });
  harnesses.push({ service, registry });
  return { service, registry, approvals, paths, workingDirectory };
}

/** 等到假代理服務端寫出該次權限回覆的紀錄。 */
async function waitForReplyLog(logFile: string): Promise<void> {
  await eventually(async () =>
    (await readAgentLog(logFile)).some((entry) => entry.event === "permission-reply"),
  );
}

describe.skipIf(process.platform !== "darwin")("外部代理權限回覆的主機層往返", () => {
  beforeEach(() => {
    delete process.env.CARDIARY_AGENT_COMMAND_OPENCODE;
  });

  afterEach(async () => {
    if (originalOpencodeCommand === undefined) delete process.env.CARDIARY_AGENT_COMMAND_OPENCODE;
    else process.env.CARDIARY_AGENT_COMMAND_OPENCODE = originalOpencodeCommand;
    // 不管測試成功或失敗，先收掉服務與子行程再刪測試目錄，避免留下孤兒行程。
    for (const { service, registry } of harnesses.splice(0)) {
      await service.shutdown().catch(() => undefined);
      await registry.cancelAll(100);
    }
    for (const dir of agentDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it("數字 id 0 的核准：回覆保留 number 型別與實際 allow optionId，動作才執行", async () => {
    const { service, registry, approvals, paths, workingDirectory } = await makeHarness();
    const request: StrictAgentRequest = {
      id: 0,
      title: "執行 bash",
      allowOptionId: "one-shot-choice",
      denyOptionId: "deny-this",
      expectedOptionId: "one-shot-choice",
    };
    const agent = await installStrictAgent(request, workingDirectory);
    process.env.CARDIARY_AGENT_COMMAND_OPENCODE = agent.command;

    const started = await service.start({
      agentKind: "opencode",
      workingDirectory,
      prompt: "做點事",
    });
    approvals.approve(started.approvalId!);

    // 工具審批真的出現，而且標明是 opencode 的工具執行。
    await eventually(() =>
      approvals.entries.some((entry) => entry.input.requestId === "permission:opencode:0"),
    );
    const toolEntry = approvals.entries.find(
      (entry) => entry.input.requestId === "permission:opencode:0",
    )!;
    expect(toolEntry.input.kind).toBe("tool-execution");
    expect(toolEntry.input.toolName).toBe("bash");
    expect(toolEntry.input.summary).toContain("OpenCode");

    // 還沒核准之前，被請求的動作不能執行。
    expect(existsSync(agent.markerFile)).toBe(false);

    approvals.approve(toolEntry.approvalId);
    await waitForReplyLog(agent.logFile);

    const log = await readAgentLog(agent.logFile);
    const reply = log.find((entry) => entry.event === "permission-reply")!;
    expect(reply.replyIdType).toBe("number");
    expect(reply.replyId).toBe(0);
    expect(reply.optionId).toBe("one-shot-choice");
    expect(reply.typeOk).toBe(true);
    expect(reply.optionOk).toBe(true);

    const storage = agentStoragePaths(paths);
    await eventually(
      async () => (await readRecord(storage, started.agentSessionId))?.status === "completed",
    );
    expect(log.some((entry) => entry.event === "executed")).toBe(true);
    expect(existsSync(agent.markerFile)).toBe(true);

    // 完成後服務收拾子行程，不留孤兒。
    await service.stop(started.agentSessionId);
    await eventually(() => registry.runningCount === 0);
  });

  it("字串 id 的拒絕：回覆保留 string 型別與實際 deny optionId，動作不執行", async () => {
    const { service, registry, approvals, paths, workingDirectory } = await makeHarness();
    const request: StrictAgentRequest = {
      id: "perm-string-7",
      title: "執行 bash",
      allowOptionId: "one-shot-choice",
      denyOptionId: "deny-this",
      expectedOptionId: "deny-this",
    };
    const agent = await installStrictAgent(request, workingDirectory);
    process.env.CARDIARY_AGENT_COMMAND_OPENCODE = agent.command;

    const started = await service.start({
      agentKind: "opencode",
      workingDirectory,
      prompt: "做點事",
    });
    approvals.approve(started.approvalId!);

    await eventually(() =>
      approvals.entries.some(
        (entry) => entry.input.requestId === "permission:opencode:perm-string-7",
      ),
    );
    const toolEntry = approvals.entries.find(
      (entry) => entry.input.requestId === "permission:opencode:perm-string-7",
    )!;
    expect(existsSync(agent.markerFile)).toBe(false);

    approvals.deny(toolEntry.approvalId);
    await waitForReplyLog(agent.logFile);

    const log = await readAgentLog(agent.logFile);
    const reply = log.find((entry) => entry.event === "permission-reply")!;
    expect(reply.replyIdType).toBe("string");
    expect(reply.replyId).toBe("perm-string-7");
    expect(reply.optionId).toBe("deny-this");
    expect(reply.typeOk).toBe(true);
    expect(reply.optionOk).toBe(true);

    const storage = agentStoragePaths(paths);
    await eventually(
      async () => (await readRecord(storage, started.agentSessionId))?.status === "completed",
    );
    expect(log.some((entry) => entry.event === "denied")).toBe(true);
    expect(existsSync(agent.markerFile)).toBe(false);

    await service.stop(started.agentSessionId);
    await eventually(() => registry.runningCount === 0);
  }, 30_000);

  // 四種組合一起驗證：id 的型別（數字 0／字串）與決定（核准／拒絕）互不影響。
  // 每組都嚴格比對回覆的 typeof 與值、實際 optionId；只有核准才寫 marker。
  const cases = [
    {
      id: 0 as number | string,
      requestId: "permission:opencode:0",
      decision: "approve" as const,
      expectedOptionId: "table-allow",
      expectMarker: true,
    },
    {
      id: 0 as number | string,
      requestId: "permission:opencode:0",
      decision: "deny" as const,
      expectedOptionId: "table-deny",
      expectMarker: false,
    },
    {
      id: "perm-table-str" as number | string,
      requestId: "permission:opencode:perm-table-str",
      decision: "approve" as const,
      expectedOptionId: "table-allow",
      expectMarker: true,
    },
    {
      id: "perm-table-str" as number | string,
      requestId: "permission:opencode:perm-table-str",
      decision: "deny" as const,
      expectedOptionId: "table-deny",
      expectMarker: false,
    },
  ];
  for (const testCase of cases) {
    const idType = typeof testCase.id;
    it(`id 為 ${idType} 且${testCase.decision === "approve" ? "核准" : "拒絕"}：回覆保留型別與實際 optionId，marker ${testCase.expectMarker ? "出現" : "不出現"}`, async () => {
      const { service, registry, approvals, paths, workingDirectory } = await makeHarness();
      const request: StrictAgentRequest = {
        id: testCase.id,
        title: "執行 bash",
        allowOptionId: "table-allow",
        denyOptionId: "table-deny",
        expectedOptionId: testCase.expectedOptionId,
      };
      const agent = await installStrictAgent(request, workingDirectory);
      process.env.CARDIARY_AGENT_COMMAND_OPENCODE = agent.command;

      const started = await service.start({
        agentKind: "opencode",
        workingDirectory,
        prompt: "做點事",
      });
      approvals.approve(started.approvalId!);

      await eventually(() =>
        approvals.entries.some((entry) => entry.input.requestId === testCase.requestId),
      );
      const toolEntry = approvals.entries.find(
        (entry) => entry.input.requestId === testCase.requestId,
      )!;
      // 未核准前不能執行。
      expect(existsSync(agent.markerFile)).toBe(false);

      if (testCase.decision === "approve") approvals.approve(toolEntry.approvalId);
      else approvals.deny(toolEntry.approvalId);
      await waitForReplyLog(agent.logFile);

      const log = await readAgentLog(agent.logFile);
      const reply = log.find((entry) => entry.event === "permission-reply")!;
      expect(reply.replyIdType).toBe(idType);
      expect(reply.replyId).toBe(testCase.id);
      expect(reply.optionId).toBe(testCase.expectedOptionId);
      expect(reply.typeOk).toBe(true);
      expect(reply.optionOk).toBe(true);

      const storage = agentStoragePaths(paths);
      await eventually(
        async () => (await readRecord(storage, started.agentSessionId))?.status === "completed",
      );
      expect(existsSync(agent.markerFile)).toBe(testCase.expectMarker);
      expect(
        log.some((entry) => entry.event === (testCase.expectMarker ? "executed" : "denied")),
      ).toBe(true);

      await service.stop(started.agentSessionId);
      await eventually(() => registry.runningCount === 0);
    }, 30_000);
  }
});
