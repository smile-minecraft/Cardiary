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
 * 被 sandbox-exec 包住、說真的供應商協定（ACP 或 stream-json）。
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
      : { CARDIARY_AGENT_COMMAND_CLAUDE_CODE: agent.command };
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
  }[]
> {
  const id = client.request("agent.list", {});
  const reply = await client.waitForReply(id);
  return (reply.payload as { agents: never[] }).agents;
}

describe.skipIf(!darwin)("外部代理契約", () => {
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
        (state) => state.pendingPermission !== undefined,
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
        (state) => state.pendingPermission !== undefined,
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

      // 主機關閉：未完成的 session 標成結果未知，行程被收掉。
      await first.client.close().catch(() => undefined);
      clients.splice(clients.indexOf(first.client), 1);
      await first.service.stop().catch(() => undefined);
      services.splice(services.indexOf(first.service), 1);

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
