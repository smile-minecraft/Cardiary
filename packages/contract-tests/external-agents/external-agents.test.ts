import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";
import { installFakeAgent, type FakeAgentMode } from "./fake-agent.js";

/**
 * 外部代理的協定契約：對真的主機行程跑，代理是真的被 spawn 出來、
 * 被 sandbox-exec 包住、說真的供應商協定（OpenCode 與 Claude 都走 ACP）。
 *
 * 核准與拒絕走 `approval.decide`；`agent.start` 的回應就帶啟動審批的 id，
 * 所以就算引擎不對「沒有會話的審批」發 `approval.requested`，客戶端仍能
 * 決定。代理自己的權限請求由主機轉成同一組審批，待決定的 id 跟著
 * `agent.state_changed` 的 `pendingPermission` 送到客戶端。
 *
 * 沙盒只在 macOS 有（`/usr/bin/sandbox-exec`）；其他平台整組跳過。
 */

const darwin = process.platform === "darwin";
/** 每個案例都要真的 spawn 行程、等沙盒與代理回應。 */
const TEST_TIMEOUT = 30_000;
const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined);
  }
});

async function bootWithAgent(options: {
  readonly mode: FakeAgentMode;
  readonly kind: "opencode" | "claude-code";
  readonly steps?: readonly string[];
  readonly folder?: TestFolder;
}): Promise<{
  service: SpawnedService;
  client: ProtocolClient;
  workingDirectory: string;
  markerFile: string;
  agent: Awaited<ReturnType<typeof installFakeAgent>>;
}> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "cardiary-agent-work-"));
  const markerFile = join(workingDirectory, "marker.txt");
  const agent = await installFakeAgent({
    kind: options.kind,
    mode: options.mode,
    markerFile,
    workingDirectory,
    ...(options.steps === undefined ? {} : { steps: options.steps }),
  });
  const env =
    options.kind === "opencode"
      ? { CARDIARY_AGENT_COMMAND_OPENCODE: agent.command }
      : {
          CARDIARY_AGENT_COMMAND_CLAUDE_CODE: agent.command,
          CARDIARY_CLAUDE_OAUTH_TOKEN: "sk-ant-test",
        };
  const service = await spawnService({
    ...(options.folder === undefined ? {} : { folder: options.folder }),
    env,
  });
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  const subscribe = client.request("system.subscribe", {});
  await client.waitForReply(subscribe);
  return { service, client, workingDirectory, markerFile, agent };
}

async function startAgent(
  client: ProtocolClient,
  input: { kind: "opencode" | "claude-code"; workingDirectory: string; prompt?: string },
): Promise<{ agentSessionId: string; approvalId: string }> {
  const id = client.request("agent.start", {
    agentKind: input.kind,
    workingDirectory: input.workingDirectory,
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
  });
  const reply = await client.waitForReply(id);
  if (reply.kind === "error") throw new Error(`agent.start 失敗：${String(reply.code)}`);
  return reply.payload as { agentSessionId: string; approvalId: string };
}

async function decide(
  client: ProtocolClient,
  approvalId: string,
  optionId: "approve" | "deny",
): Promise<void> {
  const id = client.request("approval.decide", { approvalId, optionId });
  const reply = await client.waitForReply(id);
  if (reply.kind === "error") throw new Error(`approval.decide 失敗：${String(reply.code)}`);
}

interface AgentStatePayload {
  readonly agentSessionId: string;
  readonly agentKind: string;
  readonly status: string;
  readonly message?: string;
  readonly progress?: { step: string; label: string; completed: number; total: number };
  readonly resultUnknown?: boolean;
  readonly pendingPermission?: { approvalId: string; toolName: string; description?: string };
}

async function waitForState(
  client: ProtocolClient,
  agentSessionId: string,
  predicate: (payload: AgentStatePayload) => boolean,
  ms = 10_000,
): Promise<AgentStatePayload> {
  const frame = await client.waitFor(
    (candidate) =>
      candidate.kind === "event" &&
      candidate.type === "agent.state_changed" &&
      (candidate.payload as AgentStatePayload).agentSessionId === agentSessionId &&
      predicate(candidate.payload as AgentStatePayload),
    ms,
  );
  return frame.payload as AgentStatePayload;
}

async function pidOf(agent: {
  readLog(): Promise<readonly Record<string, unknown>[]>;
}): Promise<number> {
  await eventually(async () => (await agent.readLog()).some((entry) => entry.event === "start"));
  const entries = await agent.readLog();
  const start = entries.find((entry) => entry.event === "start");
  if (!start || typeof start.pid !== "number") throw new Error("假代理沒有寫下 pid");
  return start.pid;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 任務結束後暫存區必須是空的（第 13 章驗收條件）。 */
async function scratchEntries(folder: TestFolder): Promise<readonly string[]> {
  try {
    return await readdir(join(folder.path, "tmp", "agents"));
  } catch {
    return [];
  }
}

/** 等一個非同步條件成立；`waitUntil` 只收同步條件，這裡需要重讀磁碟。 */
async function eventually(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("條件等待逾時");
}

async function listAgents(client: ProtocolClient): Promise<
  readonly {
    agentSessionId: string;
    status: string;
    message?: string;
    resultUnknown?: boolean;
    progress?: { completed: number; total: number };
    pendingPermission?: { approvalId: string; toolName: string; description?: string };
  }[]
> {
  const id = client.request("agent.list", {});
  const reply = await client.waitForReply(id);
  return (reply.payload as { agents: never[] }).agents;
}

describe.skipIf(!darwin)("外部代理契約", () => {
  it(
    "啟動審批經 pendingPermission 出現在 agent.list 與 agent.state_changed，核准後才啟動",
    async () => {
      const { client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "complete",
        steps: ["整理結果"],
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "整理這個資料夾",
      });
      expect(approvalId).not.toBe("");

      // 啟動還沒核准：狀態卡的 pendingPermission 必須帶著啟動審批的 id，
      // 客戶端才有辦法畫出核准／拒絕鈕。list 與事件要是同一份投影。
      const state = await waitForState(
        client,
        agentSessionId,
        (s) => s.status === "waiting-approval",
      );
      expect(state.pendingPermission).toMatchObject({
        approvalId,
        toolName: "opencode-acp",
      });
      expect(state.pendingPermission?.description).toContain(workingDirectory);

      const listed = await listAgents(client);
      const waiting = listed.find((entry) => entry.agentSessionId === agentSessionId);
      expect(waiting?.status).toBe("waiting-approval");
      expect(waiting?.pendingPermission).toEqual(state.pendingPermission);

      // 核准前沒有 spawn、沒有改檔。
      expect(await agent.readLog()).toEqual([]);

      // 用狀態卡上的 approvalId 核准（不是 start 回應偷藏的 id）。
      await decide(client, state.pendingPermission!.approvalId, "approve");
      await waitForState(client, agentSessionId, (s) => s.status === "running");
      // 核准後真的 spawn 了：假代理寫下 start 事件（含 pid）。
      const started = await pidOf(agent);
      expect(started).toBeGreaterThan(0);

      // 核准後 pendingPermission 消失，進度回來。
      await waitForState(client, agentSessionId, (s) => s.status === "stopped");
      const done = await listAgents(client);
      const doneEntry = done.find((entry) => entry.agentSessionId === agentSessionId);
      expect(doneEntry?.pendingPermission).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "opencode：核准後啟動、回報進度，完成後暫存區清空",
    async () => {
      const { service, client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "complete",
        steps: ["檢查專案", "整理結果"],
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "整理這個資料夾",
      });
      expect(approvalId).not.toBe("");

      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      expect(await agent.readLog()).toEqual([]);

      await decide(client, approvalId, "approve");
      await waitForState(client, agentSessionId, (state) => state.status === "running");
      const progress = await waitForState(
        client,
        agentSessionId,
        (state) => state.progress !== undefined,
      );
      expect(progress.progress).toEqual({
        step: expect.any(String),
        label: "整理結果",
        completed: 1,
        total: 2,
      });

      const completed = await waitForState(
        client,
        agentSessionId,
        (state) => state.status === "stopped",
      );
      expect(completed.message).toBe("代理完成任務");
      // 真正的 ACP 代理回完 completion 也不會自己退出；完成事件處理完之前
      // 行程就該被關掉，客戶端看到終態時不能有孤兒。
      const pid = await pidOf(agent);
      await eventually(async () => !processAlive(pid));
      expect(processAlive(pid)).toBe(false);

      const listed = await listAgents(client);
      expect(listed[0]).toMatchObject({
        agentSessionId,
        status: "stopped",
        message: "代理完成任務",
      });
      // 完成時進度補滿：最後一筆紀錄的 completed 等於 total。
      expect(listed[0]?.progress).toMatchObject({ completed: 2, total: 2 });

      const log = await agent.readLog();
      expect(log.filter((entry) => entry.event === "prompt")).toHaveLength(1);

      await eventually(async () => (await scratchEntries(service.folder)).length === 0);
      expect(await scratchEntries(service.folder)).toEqual([]);

      // 工作階段資料留在快取區，內容是耐久紀錄。
      const record = JSON.parse(
        await readFile(
          join(service.folder.path, "cache", "agents", agentSessionId, "session.json"),
          "utf8",
        ),
      ) as { status: string };
      expect(record.status).toBe("completed");
    },
    TEST_TIMEOUT,
  );

  it(
    "clientRequestId 重送：等待審批時回同一個審批，決定後只回同一個工作階段",
    async () => {
      const { client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "complete",
      });
      const request = {
        agentKind: "opencode",
        workingDirectory,
        prompt: "只啟動一次",
        clientRequestId: "start-once",
      };
      const firstId = client.request("agent.start", request);
      const firstReply = await client.waitForReply(firstId);
      const first = firstReply.payload as { agentSessionId: string; approvalId: string };
      expect(first.approvalId).toBeTruthy();
      await waitForState(
        client,
        first.agentSessionId,
        (state) => state.status === "waiting-approval",
      );

      // 還在等審批時重送：同一個工作階段、同一個還可以按的審批 id。
      const waitingId = client.request("agent.start", request);
      const waitingReply = await client.waitForReply(waitingId);
      expect(waitingReply.payload).toEqual({
        agentSessionId: first.agentSessionId,
        approvalId: first.approvalId,
      });

      await decide(client, first.approvalId, "approve");
      await waitForState(client, first.agentSessionId, (state) => state.status === "stopped");

      // 決定之後再重送：只回同一個工作階段，不再回舊審批，也不重新 spawn。
      const afterId = client.request("agent.start", request);
      const afterReply = await client.waitForReply(afterId);
      expect(afterReply.payload).toEqual({ agentSessionId: first.agentSessionId });
      await eventually(
        async () => (await agent.readLog()).filter((e) => e.event === "start").length === 1,
      );
      expect((await agent.readLog()).filter((e) => e.event === "start")).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "opencode：代理不配合關門與 SIGTERM 時，完成後仍被 SIGKILL、暫存區清空",
    async () => {
      const { service, client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "complete-stubborn",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "完成後賴著不走",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");
      await waitForState(client, agentSessionId, (state) => state.status === "stopped");

      // 代理收到 stdin close、cancel 與 SIGTERM 都不離開；只能靠 SIGKILL 收尾，
      // 而終態必須等行程真的消失之後才送出來。
      const pid = await pidOf(agent);
      expect(processAlive(pid)).toBe(false);
      const log = await agent.readLog();
      expect(log.some((entry) => entry.event === "completed")).toBe(true);
      expect(log.some((entry) => entry.event === "cancel")).toBe(true);
      expect(log.some((entry) => entry.event === "sigterm-ignored")).toBe(true);
      expect(log.some((entry) => entry.event === "stdin-closed")).toBe(true);

      await eventually(async () => (await scratchEntries(service.folder)).length === 0);
      expect(await scratchEntries(service.folder)).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    "opencode：兩筆並行權限各別核准／拒絕，回覆不互換、任務續跑完成",
    async () => {
      const { service, client, workingDirectory, markerFile, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "permission-pair",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "兩個動作一個准一個不准",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");

      // agent 審批沒有 conversationId，引擎不發 approval.requested；兩筆權限的
      // 審批 id 跟著 pendingPermission 出現在不同的 state_changed 事件裡，
      // description 帶工具標題（執行 bash 指令 42／43），用來分辨誰是誰。
      const pendings = new Map<string, string>();
      await client.waitFor((frame) => {
        if (
          frame.kind !== "event" ||
          frame.type !== "agent.state_changed" ||
          (frame.payload as AgentStatePayload).agentSessionId !== agentSessionId
        ) {
          return false;
        }
        const pending = (frame.payload as AgentStatePayload).pendingPermission;
        // 啟動審批現在也走 pendingPermission，必須排除，只收代理自己提出的工具權限。
        if (pending?.approvalId && pending.approvalId !== approvalId && pending.description) {
          pendings.set(pending.description, pending.approvalId);
        }
        return pendings.size >= 2;
      });
      const first = pendings.get("執行 bash 指令 42");
      const second = pendings.get("執行 bash 指令 43");
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first).not.toBe(second);

      // 42 核准、43 拒絕；各别送到自己的請求，不得互相覆蓋。
      await decide(client, first ?? "", "approve");
      await decide(client, second ?? "", "deny");

      const resumed = await waitForState(
        client,
        agentSessionId,
        (state) =>
          state.message === "權限請求被拒絕：bash" && state.pendingPermission === undefined,
      );
      expect(resumed.status).toBe("running");
      await waitForState(client, agentSessionId, (state) => state.status === "stopped");

      const log = await agent.readLog();
      expect(log.find((entry) => entry.event === "permission-allowed")?.id).toBe(42);
      expect(log.find((entry) => entry.event === "permission-denied")?.id).toBe(43);
      expect(await readFile(`${markerFile}-42`, "utf8")).toBe("executed\n");
      await expect(readFile(`${markerFile}-43`, "utf8")).rejects.toThrow();
      await eventually(async () => (await scratchEntries(service.folder)).length === 0);
    },
    TEST_TIMEOUT,
  );

  it(
    "啟動審批被拒絕：代理不會啟動，狀態明確失敗",
    async () => {
      const { client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "complete",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "不該執行",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "deny");
      const failed = await waitForState(
        client,
        agentSessionId,
        (state) => state.status === "failed",
      );
      expect(failed.message).toBe("啟動審批被拒絕，代理沒有啟動");
      expect(await agent.readLog()).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it.each(["stop", "pause"] as const)(
    "等待啟動審批時 %s：撤回後不啟動代理",
    async (action) => {
      const { client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "complete",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
      });
      const id =
        action === "stop"
          ? client.request("agent.stop", { agentSessionId })
          : client.request("approval.pause_all", { reason: "測試緊急暫停" });
      const reply = await client.waitForReply(id);
      expect(reply.kind).not.toBe("error");
      const decision = client.request("approval.decide", { approvalId, optionId: "approve" });
      const decisionReply = await client.waitForReply(decision);
      expect(decisionReply.kind).toBe("error");
      expect(await agent.readLog()).toEqual([]);
      const session = (await listAgents(client)).find(
        (candidate) => candidate.agentSessionId === agentSessionId,
      );
      expect(session?.status).toBe("stopped");
      expect(session?.message).toContain(action === "pause" ? "緊急暫停" : "使用者停止");
    },
    TEST_TIMEOUT,
  );

  it(
    "claude-code：代理行程失敗時，回報結果未知而不是已完成",
    async () => {
      const { service, client, workingDirectory } = await bootWithAgent({
        kind: "claude-code",
        mode: "fail",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "claude-code",
        workingDirectory,
        prompt: "會失敗的任務",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");

      const failed = await waitForState(
        client,
        agentSessionId,
        (state) => state.status === "failed",
      );
      expect(failed.resultUnknown).toBe(true);
      expect(failed.message).toContain("結果未知");
      expect(failed.message).toContain("假代理故意失敗");

      const listed = await listAgents(client);
      expect(listed[0]).toMatchObject({ agentSessionId, status: "failed", resultUnknown: true });

      await eventually(async () => (await scratchEntries(service.folder)).length === 0);
    },
    TEST_TIMEOUT,
  );

  it(
    "claude-code：核准後先設定 default 模式再送 prompt，權杖只注入行程環境",
    async () => {
      const { client, workingDirectory, agent } = await bootWithAgent({
        kind: "claude-code",
        mode: "complete",
        steps: ["整理結果"],
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "claude-code",
        workingDirectory,
        prompt: "整理這個資料夾",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");
      await waitForState(client, agentSessionId, (state) => state.status === "stopped", 10_000);

      const log = await agent.readLog();
      const start = log.find((entry) => entry.event === "start");
      expect(start?.tokenPresent).toBe(true);

      const setConfigIndex = log.findIndex((entry) => entry.event === "set-config");
      const promptIndex = log.findIndex((entry) => entry.event === "prompt");
      expect(setConfigIndex).toBeGreaterThanOrEqual(0);
      expect(promptIndex).toBeGreaterThanOrEqual(0);
      expect(setConfigIndex).toBeLessThan(promptIndex);
      expect(log[setConfigIndex]).toMatchObject({ configId: "mode", value: "default" });
    },
    TEST_TIMEOUT,
  );

  it(
    "opencode：權限請求轉成審批，核准後動作才執行",
    async () => {
      const { client, workingDirectory, markerFile, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "permission",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "寫一個檔案",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");

      const pending = await waitForState(
        client,
        agentSessionId,
        (state) =>
          state.pendingPermission !== undefined &&
          state.pendingPermission.approvalId !== approvalId,
      );
      expect(pending.status).toBe("waiting-approval");
      expect(pending.pendingPermission?.toolName).toBe("bash");

      const permissionApprovalId = pending.pendingPermission?.approvalId ?? "";
      expect(permissionApprovalId).not.toBe("");
      await decide(client, permissionApprovalId, "approve");

      await waitForState(client, agentSessionId, (state) => state.status === "stopped", 10_000);
      expect(await readFile(markerFile, "utf8")).toBe("executed\n");
      const log = await agent.readLog();
      expect(log.some((entry) => entry.event === "permission-allowed")).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "claude-code：拒絕權限請求後動作不執行，任務仍可收尾",
    async () => {
      const { client, workingDirectory, markerFile, agent } = await bootWithAgent({
        kind: "claude-code",
        mode: "permission",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "claude-code",
        workingDirectory,
        prompt: "不要寫檔案",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");

      const pending = await waitForState(
        client,
        agentSessionId,
        (state) =>
          state.pendingPermission !== undefined &&
          state.pendingPermission.approvalId !== approvalId,
      );
      await decide(client, pending.pendingPermission?.approvalId ?? "", "deny");

      const resumed = await waitForState(
        client,
        agentSessionId,
        (state) => state.message === "權限請求被拒絕：Bash",
      );
      expect(resumed.pendingPermission).toBeUndefined();
      await waitForState(client, agentSessionId, (state) => state.status === "stopped", 10_000);
      const log = await agent.readLog();
      expect(log.some((entry) => entry.event === "permission-denied")).toBe(true);
      await expect(readFile(markerFile, "utf8")).rejects.toThrow();
    },
    TEST_TIMEOUT,
  );

  it(
    "claude-code：拒絕權限請求後工具不執行，也不會再問第二次",
    async () => {
      const { client, workingDirectory, markerFile, agent } = await bootWithAgent({
        kind: "claude-code",
        mode: "permission",
        steps: ["寫入檔案"],
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "claude-code",
        workingDirectory,
        prompt: "不要寫檔案",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");

      const pending = await waitForState(
        client,
        agentSessionId,
        (state) =>
          state.pendingPermission !== undefined &&
          state.pendingPermission.approvalId !== approvalId,
      );
      expect(pending.status).toBe("waiting-approval");
      expect(pending.pendingPermission?.toolName).toBe("Bash");

      const permissionApprovalId = pending.pendingPermission?.approvalId ?? "";
      expect(permissionApprovalId).not.toBe("");
      await decide(client, permissionApprovalId, "deny");

      const resumed = await waitForState(
        client,
        agentSessionId,
        (state) => state.message === "權限請求被拒絕：Bash",
      );
      expect(resumed.pendingPermission).toBeUndefined();
      await waitForState(client, agentSessionId, (state) => state.status === "stopped", 10_000);

      // 工具沒有執行：markerFile 不存在，且只有 denial 沒有 allow。
      await expect(readFile(markerFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      const log = await agent.readLog();
      expect(log.some((entry) => entry.event === "permission-denied")).toBe(true);
      expect(log.some((entry) => entry.event === "permission-allowed")).toBe(false);
      expect(log.filter((entry) => entry.event === "permission-reply")).toHaveLength(1);

      // 沒有第二次權限請求：除了啟動審批與這一次工具權限，
      // 沒有新的 pendingPermission 出現在任何狀態事件裡。
      const known = new Set([approvalId, permissionApprovalId]);
      const secondRequest = client.frames.find((frame) => {
        if (
          frame.kind !== "event" ||
          frame.type !== "agent.state_changed" ||
          (frame.payload as AgentStatePayload).agentSessionId !== agentSessionId
        ) {
          return false;
        }
        const next = (frame.payload as AgentStatePayload).pendingPermission;
        return next !== undefined && !known.has(next.approvalId);
      });
      expect(secondRequest).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "agent.stop：中止後行程結束、暫存區清空",
    async () => {
      const { service, client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "hang",
        steps: ["長工作"],
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "跑很久",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");
      await waitForState(client, agentSessionId, (state) => state.status === "running");
      const pid = await pidOf(agent);
      expect(processAlive(pid)).toBe(true);

      const stopId = client.request("agent.stop", { agentSessionId });
      await client.waitForReply(stopId);
      const stopped = await waitForState(
        client,
        agentSessionId,
        (state) => state.status === "stopped",
      );
      expect(stopped.message).toBe("使用者停止");

      await eventually(async () => !processAlive(pid));
      expect(processAlive(pid)).toBe(false);
      await eventually(async () => (await scratchEntries(service.folder)).length === 0);
      expect(await scratchEntries(service.folder)).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    "主機重啟：未完成的工作階段回報結果未知，已完成的步驟不重跑",
    async () => {
      const first = await bootWithAgent({
        kind: "opencode",
        mode: "hang",
        steps: ["第一步", "第二步"],
      });
      const folder = first.service.folder;
      const { agentSessionId, approvalId } = await startAgent(first.client, {
        kind: "opencode",
        workingDirectory: first.workingDirectory,
        prompt: "跑到一半",
      });
      await waitForState(
        first.client,
        agentSessionId,
        (state) => state.status === "waiting-approval",
      );
      await decide(first.client, approvalId, "approve");
      const progress = await waitForState(
        first.client,
        agentSessionId,
        (state) => state.progress !== undefined,
      );
      expect(progress.progress?.completed).toBe(1);
      const pid = await pidOf(first.agent);

      // 主机关机：未完成的 session 標成結果未知，行程被收掉。
      await first.client.close().catch(() => undefined);
      clients.splice(clients.indexOf(first.client), 1);
      // 用真正的 SIGKILL，不能用 service.stop()（那是優雅關機，
      // 不會留下需要 startupCleanup 处理的孤兒行程）。
      await first.service.kill();
      services.splice(services.indexOf(first.service), 1);
      // 宿主被 SIGKILL 砍掉時，detached 的代理行程自己還活著。
      expect(processAlive(pid)).toBe(true);

      const service = await spawnService({ folder });
      services.push(service);
      const client = await connectAndHello(service);
      clients.push(client);
      await client.waitForReply(client.request("system.subscribe", {}));

      await eventually(async () => (await listAgents(client)).length === 1);
      const [restarted] = await listAgents(client);
      expect(restarted).toMatchObject({
        agentSessionId,
        status: "failed",
        resultUnknown: true,
        message: "主機重啟，未完成的步驟結果未知",
      });
      expect(restarted?.progress?.completed).toBe(1);

      // 重啟不會重新啟動代理：行程只有第一次的紀錄。
      await eventually(async () => !processAlive(pid));
      const log = await first.agent.readLog();
      expect(log.filter((entry) => entry.event === "start")).toHaveLength(1);
      expect(log.filter((entry) => entry.event === "prompt")).toHaveLength(1);
      expect(await scratchEntries(folder)).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    "緊急全部暫停：代理行程被中止，工作階段標成結果未知",
    async () => {
      const { service, client, workingDirectory, agent } = await bootWithAgent({
        kind: "opencode",
        mode: "hang",
      });
      const { agentSessionId, approvalId } = await startAgent(client, {
        kind: "opencode",
        workingDirectory,
        prompt: "跑很久",
      });
      await waitForState(client, agentSessionId, (state) => state.status === "waiting-approval");
      await decide(client, approvalId, "approve");
      await waitForState(client, agentSessionId, (state) => state.status === "running");
      const pid = await pidOf(agent);
      expect(processAlive(pid)).toBe(true);

      const pauseId = client.request("approval.pause_all", { reason: "測試緊急暫停" });
      const reply = await client.waitForReply(pauseId);
      expect(reply.kind).not.toBe("error");

      const failed = await waitForState(
        client,
        agentSessionId,
        (state) => state.status === "failed",
        10_000,
      );
      expect(failed.resultUnknown).toBe(true);
      await eventually(async () => !processAlive(pid));
      expect(processAlive(pid)).toBe(false);
      await eventually(async () => (await scratchEntries(service.folder)).length === 0);
      expect(await scratchEntries(service.folder)).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
