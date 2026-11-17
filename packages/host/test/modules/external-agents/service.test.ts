import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CardiaryPaths } from "@cardiary/module-api";
import type { ExternalAgentSessionRecord } from "@cardiary/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentApprovalRequestInput,
  AgentApprovalsService,
} from "../../../src/modules/contract.js";
import {
  AgentStartError,
  ExternalAgentsService,
  type ExternalAgentStateData,
} from "../../../src/modules/external-agents/service.js";
import {
  agentStoragePaths,
  readRecord,
  scratchDir,
  writeRecord,
} from "../../../src/modules/external-agents/store.js";
import { describeProcess, SpawnRegistry, type ManagedChild } from "../../../src/spawn/wrapper.js";

const NOW = new Date("2026-05-01T00:00:00.000Z");
const roots: string[] = [];
const children: ManagedChild[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.signal("SIGKILL");
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function eventually(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("條件等待逾時");
}

type DecisionOutcome = "approved" | "denied" | "withdrawn";

interface PendingEntry {
  readonly agentSessionId: string;
  readonly resolve: (outcome: { outcome: DecisionOutcome }) => void;
}

class FakeApprovals implements AgentApprovalsService {
  readonly requests: AgentApprovalRequestInput[] = [];
  readonly withdrawn: string[] = [];
  readonly agentWithdrawals: Array<{ agentSessionId: string; reason: string }> = [];
  #count = 0;
  #pending = new Map<string, PendingEntry>();

  async request(input: AgentApprovalRequestInput): Promise<{ approvalId: string }> {
    this.#count += 1;
    this.requests.push(input);
    const approvalId = `appr_${this.#count}`;
    this.#pending.set(approvalId, {
      agentSessionId: input.agentSessionId,
      resolve: () => undefined,
    });
    return { approvalId };
  }

  waitForDecision(approvalId: string): Promise<unknown> {
    return new Promise((resolve) => {
      const entry = this.#pending.get(approvalId);
      this.#pending.set(approvalId, {
        agentSessionId: entry?.agentSessionId ?? "",
        resolve: (outcome) => resolve(outcome),
      });
    });
  }

  /** 核准 pending 審批；必須等服務已進入 waitForDecision 才能呼叫。 */
  approve(approvalId: string): void {
    const entry = this.#pending.get(approvalId);
    if (!entry) return;
    entry.resolve({ outcome: "approved" });
    this.#pending.delete(approvalId);
  }

  async withdraw(approvalId: string): Promise<void> {
    this.withdrawn.push(approvalId);
    this.#pending.get(approvalId)?.resolve({ outcome: "withdrawn" });
    this.#pending.delete(approvalId);
  }

  async withdrawPendingForAgent(agentSessionId: string, reason: string): Promise<void> {
    this.agentWithdrawals.push({ agentSessionId, reason });
    for (const [approvalId, entry] of [...this.#pending]) {
      if (entry.agentSessionId !== agentSessionId) continue;
      this.withdrawn.push(approvalId);
      entry.resolve({ outcome: "withdrawn" });
      this.#pending.delete(approvalId);
    }
  }

  /** 模擬重啟前留下的 pending 審批，用來驗證 startupCleanup 會撤回它。 */
  seedPending(approvalId: string, agentSessionId: string): void {
    this.#pending.set(approvalId, { agentSessionId, resolve: () => undefined });
  }

  /** 目前還卡在 pending 的審批 id。 */
  pendingIds(): readonly string[] {
    return [...this.#pending.keys()];
  }
}

const neverSpawns = {
  spawn(): never {
    throw new Error("這個測試不該啟動代理行程");
  },
  async cancelAll(): Promise<void> {
    return undefined;
  },
} as unknown as SpawnRegistry;

interface Harness {
  readonly service: ExternalAgentsService;
  readonly paths: CardiaryPaths;
  readonly approvals: FakeApprovals;
  readonly events: ExternalAgentStateData[];
  readonly workingDirectory: string;
}

async function makeHarness(readClaudeToken?: () => Promise<string | null>): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-agent-service-"));
  roots.push(root);
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
  const workingDirectory = await mkdtemp(join(tmpdir(), "cardiary-agent-work-"));
  roots.push(workingDirectory);
  const approvals = new FakeApprovals();
  const events: ExternalAgentStateData[] = [];
  const service = new ExternalAgentsService({
    paths,
    spawn: neverSpawns,
    approvals,
    emitState: (data) => events.push(data),
    now: () => NOW,
    homeDir: join(root, "home"),
    readClaudeToken,
  });
  return { service, paths, approvals, events, workingDirectory };
}

async function expectStartError(
  action: () => Promise<unknown>,
  code: AgentStartError["code"],
): Promise<void> {
  const error = await action().then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AgentStartError);
  expect((error as AgentStartError).code).toBe(code);
}

describe.skipIf(process.platform !== "darwin")("外部代理啟動驗證", () => {
  it("不支援的代理種類直接拒絕", async () => {
    const { service, workingDirectory } = await makeHarness();

    await expectStartError(
      () =>
        service.start({
          agentKind: "unknown" as never,
          workingDirectory,
        }),
      "unsupported-kind",
    );
  });

  it("工作目錄必須是存在的絕對路徑", async () => {
    const { service, workingDirectory } = await makeHarness();

    await expectStartError(
      () => service.start({ agentKind: "opencode", workingDirectory: "relative/path" }),
      "invalid-workspace",
    );
    await expectStartError(
      () =>
        service.start({
          agentKind: "opencode",
          workingDirectory: join(workingDirectory, "missing"),
        }),
      "invalid-workspace",
    );
    await mkdir(join(workingDirectory, "file"), { recursive: true });
    await writeFile(join(workingDirectory, "file", "a.txt"), "x", "utf8");
    await expectStartError(
      () =>
        service.start({
          agentKind: "opencode",
          workingDirectory: join(workingDirectory, "file", "a.txt"),
        }),
      "invalid-workspace",
    );
  });

  it("不能拿 Cardiary 資料夾當工作目錄，但 tmp 例外", async () => {
    const { service, paths } = await makeHarness();
    await mkdir(paths.root, { recursive: true });
    await mkdir(join(paths.root, "state"), { recursive: true });

    await expectStartError(
      () => service.start({ agentKind: "opencode", workingDirectory: paths.root }),
      "invalid-workspace",
    );
    await expectStartError(
      () =>
        service.start({
          agentKind: "opencode",
          workingDirectory: join(paths.root, "state"),
        }),
      "invalid-workspace",
    );

    const tmpWorkspace = join(paths.root, "tmp", "agent-work");
    await mkdir(tmpWorkspace, { recursive: true });
    const allowed = await service.start({
      agentKind: "opencode",
      workingDirectory: tmpWorkspace,
    });
    expect(allowed.agentSessionId).toMatch(/^agent_/);
    expect(allowed.approvalId).toBe("appr_1");
  });

  it("啟動先建審批並停在等待核准，不會先啟動行程", async () => {
    const { service, approvals, events, paths, workingDirectory } = await makeHarness();

    const started = await service.start({ agentKind: "claude-code", workingDirectory });

    expect(approvals.requests).toHaveLength(1);
    expect(approvals.requests[0]).toMatchObject({
      agentSessionId: started.agentSessionId,
      requestId: "start",
      kind: "tool-execution",
      risk: "medium",
      toolName: "claude-code-acp",
    });
    expect(approvals.requests[0]?.summary).toContain(workingDirectory);
    expect(events[0]).toMatchObject({
      agentSessionId: started.agentSessionId,
      agentKind: "claude-code",
      status: "waiting-approval",
    });
    const stored = await readRecord(agentStoragePaths(paths), started.agentSessionId);
    expect(stored?.status).toBe("waiting-approval");
    expect(stored?.startApprovalId).toBe(started.approvalId);
  });

  it("Claude 沒有任何權杖來源時，核准啟動後直接失敗且不啟動行程", async () => {
    vi.stubEnv("CARDIARY_CLAUDE_OAUTH_TOKEN", "");
    try {
      const { service, approvals, events, paths, workingDirectory } = await makeHarness();
      const spawnSpy = vi.spyOn(neverSpawns, "spawn");

      const started = await service.start({ agentKind: "claude-code", workingDirectory });

      // 等到服務真的開始等審批（waitForDecision 會覆寫 pending entry），再核准。
      await eventually(async () =>
        events.some(
          (event) =>
            event.agentSessionId === started.agentSessionId && event.status === "waiting-approval",
        ),
      );
      if (!started.approvalId) throw new Error("啟動應回傳審批 id");
      approvals.approve(started.approvalId);

      await eventually(async () => {
        const record = await readRecord(agentStoragePaths(paths), started.agentSessionId);
        return record?.status === "failed";
      });
      const failed = await readRecord(agentStoragePaths(paths), started.agentSessionId);
      expect(failed?.message).toContain("權杖");
      expect(spawnSpy).not.toHaveBeenCalled();
      spawnSpy.mockRestore();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Claude 沒有任何權杖來源時，核准啟動會向殼讀一次權杖且不啟動行程", async () => {
    vi.stubEnv("CARDIARY_CLAUDE_OAUTH_TOKEN", "");
    try {
      let reads = 0;
      const readClaudeToken = async (): Promise<string | null> => {
        reads += 1;
        return null;
      };
      const { service, approvals, events, paths, workingDirectory } =
        await makeHarness(readClaudeToken);
      const spawnSpy = vi.spyOn(neverSpawns, "spawn");

      const started = await service.start({ agentKind: "claude-code", workingDirectory });

      await eventually(async () =>
        events.some(
          (event) =>
            event.agentSessionId === started.agentSessionId && event.status === "waiting-approval",
        ),
      );
      if (!started.approvalId) throw new Error("啟動應回傳審批 id");
      approvals.approve(started.approvalId);

      await eventually(async () => {
        const record = await readRecord(agentStoragePaths(paths), started.agentSessionId);
        return record?.status === "failed";
      });
      const failed = await readRecord(agentStoragePaths(paths), started.agentSessionId);
      expect(failed?.message).toBe("Claude Code 需要授權權杖，請在設定中提供。");
      expect(spawnSpy).not.toHaveBeenCalled();
      expect(reads).toBe(1);
      spawnSpy.mockRestore();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("同一個 clientRequestId 重送只建立一筆工作階段", async () => {
    const { service, approvals, workingDirectory } = await makeHarness();

    const first = await service.start({
      agentKind: "opencode",
      workingDirectory,
      clientRequestId: "request-1",
    });
    const second = await service.start({
      agentKind: "opencode",
      workingDirectory,
      clientRequestId: "request-1",
    });

    expect(second.agentSessionId).toBe(first.agentSessionId);
    expect(second.approvalId).toBe(first.approvalId);
    expect(approvals.requests).toHaveLength(1);
    expect(await service.list()).toHaveLength(1);
  });

  it("停止還沒核准的啟動會撤回審批並標成已停止", async () => {
    const { service, approvals, paths, workingDirectory } = await makeHarness();
    const started = await service.start({ agentKind: "opencode", workingDirectory });

    const stopped = await service.stop(started.agentSessionId);

    expect(stopped).toEqual({ agentSessionId: started.agentSessionId, stopped: true });
    expect(approvals.withdrawn).toContain(started.approvalId);
    const stored = await readRecord(agentStoragePaths(paths), started.agentSessionId);
    expect(stored?.status).toBe("stopped");
  });
});

describe("外部代理列表", () => {
  it("完成的領域狀態在協定裡以 stopped 呈現，結果留在訊息", async () => {
    const { service, paths } = await makeHarness();
    const storage = agentStoragePaths(paths);
    const record: ExternalAgentSessionRecord = {
      agentSessionId: "agent_done",
      agentKind: "opencode",
      workingDirectory: "/tmp/work",
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      status: "completed",
      message: "代理完成任務",
      completedSteps: 2,
      lastEventSeq: 4,
      pendingPermission: null,
      resultUnknown: false,
    };
    await writeRecord(storage, record);

    const listed = await service.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      agentSessionId: "agent_done",
      status: "stopped",
      message: "代理完成任務",
    });
  });

  it("停止不存在的工作階段回報錯誤", async () => {
    const { service } = await makeHarness();

    await expect(service.stop("agent_missing")).rejects.toThrow("沒有這個代理工作階段");
  });
});

describe.skipIf(process.platform !== "darwin")("外部代理主動重啟清理（真子行程）", () => {
  it("startupCleanup 殺掉舊行程、標結果未知、撤回該代理所有 pending 審批並清暫存", async () => {
    const { paths, approvals, events } = await makeHarness();
    const storage = agentStoragePaths(paths);
    const spawn = new SpawnRegistry();
    const service = new ExternalAgentsService({
      paths,
      spawn,
      approvals,
      emitState: (data) => events.push(data),
      now: () => NOW,
      homeDir: join(paths.root, "home"),
    });

    // 真的 spawn 一個 detached 子行程，模擬被 SIGKILL 的主機留下的孤兒。
    const child = spawn.spawn({
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1000)"],
      stdio: ["ignore", "ignore", "ignore"],
    });
    children.push(child);
    const identity = await describeProcess(child.pid);
    expect(identity).not.toBeNull();
    expect(processAlive(child.pid)).toBe(true);

    const agentSessionId = "agent_orphan";
    await mkdir(scratchDir(storage, agentSessionId), { recursive: true });
    await writeFile(join(scratchDir(storage, agentSessionId), "scratch.txt"), "x", "utf8");
    await writeRecord(storage, {
      agentSessionId,
      agentKind: "opencode",
      workingDirectory: paths.root,
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      status: "running",
      completedSteps: 1,
      lastEventSeq: 3,
      pendingPermission: null,
      resultUnknown: false,
      child: identity ?? undefined,
    });
    // 重啟前卡著兩筆這個代理的審批，還有一筆別人的不能被撤回。
    approvals.seedPending("appr_agent_1", agentSessionId);
    approvals.seedPending("appr_agent_2", agentSessionId);
    approvals.seedPending("appr_other", "agent_someone_else");

    const result = await service.startupCleanup();

    expect(result.orphaned).toBe(1);
    // 真的子行程被殺掉，不是只清紀錄。
    await eventually(async () => !processAlive(child.pid));
    expect(processAlive(child.pid)).toBe(false);
    const record = await readRecord(storage, agentSessionId);
    expect(record).toMatchObject({
      status: "failed",
      resultUnknown: true,
      completedSteps: 1,
      message: "主機重啟，未完成的步驟結果未知",
    });
    expect(record?.child).toBeUndefined();
    // 這個代理的所有 pending 審批都被撤回，別人的留下。
    expect(approvals.agentWithdrawals).toContainEqual({
      agentSessionId,
      reason: "主機重新啟動",
    });
    expect(approvals.withdrawn).toContain("appr_agent_1");
    expect(approvals.withdrawn).toContain("appr_agent_2");
    expect(approvals.withdrawn).not.toContain("appr_other");
    expect(approvals.pendingIds()).toEqual(["appr_other"]);
    // 暫存區清空。
    expect(await readdir(join(paths.tmp, "agents"))).toEqual([]);
  }, 30_000);

  it("忽略 SIGTERM 的孤兒在第一次啟動無法確認結束時保留身分，第二次啟動能補殺收斂", async () => {
    const { paths, approvals } = await makeHarness();
    const storage = agentStoragePaths(paths);
    const spawn = new SpawnRegistry();
    // 真的行程且忽略 SIGTERM，第二次清理時必須靠 SIGKILL 結束。
    const child = spawn.spawn({
      command: process.execPath,
      args: [
        "-e",
        "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => undefined, 1000);",
      ],
      stdio: ["ignore", "pipe", "ignore"],
    });
    children.push(child);
    await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
    const identity = await describeProcess(child.pid);
    expect(identity).not.toBeNull();

    const agentSessionId = "agent_orphan_retry";
    await writeRecord(storage, {
      agentSessionId,
      agentKind: "opencode",
      workingDirectory: paths.root,
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      status: "running",
      completedSteps: 1,
      lastEventSeq: 3,
      pendingPermission: null,
      resultUnknown: false,
      child: identity ?? undefined,
    });

    // 第一次啟動：預算已用盡，無法確認行程結束。
    const first = new ExternalAgentsService({
      paths,
      spawn,
      approvals,
      emitState: () => undefined,
      now: () => NOW,
      homeDir: join(paths.root, "home"),
      timeouts: {
        termGraceMs: 20,
        killGraceMs: 20,
        exitTaskTimeoutMs: 50,
        startupCleanupBudgetMs: 0,
      },
    });
    expect((await first.startupCleanup()).orphaned).toBe(1);
    expect(processAlive(child.pid)).toBe(true);
    const afterFirst = await readRecord(storage, agentSessionId);
    expect(afterFirst).toMatchObject({ status: "failed", resultUnknown: true });
    // 關鍵：終止沒確認，child 身分必須留著，否則下次認不出來、補殺不了。
    expect(afterFirst?.child).toEqual(identity);

    // 第二次啟動使用新的服務實例，從磁碟重讀並補殺同一個孤兒。
    const second = new ExternalAgentsService({
      paths,
      spawn,
      approvals,
      emitState: () => undefined,
      now: () => NOW,
      homeDir: join(paths.root, "home"),
      timeouts: {
        termGraceMs: 100,
        killGraceMs: 100,
        exitTaskTimeoutMs: 100,
        startupCleanupBudgetMs: 3000,
      },
    });
    await second.startupCleanup();
    await eventually(async () => !processAlive(child.pid));
    expect((await child.exited).signal).toBe("SIGKILL");
    const afterSecond = await readRecord(storage, agentSessionId);
    expect(afterSecond?.child).toBeUndefined();
  }, 30_000);

  it("PID 重用時不殺到現在佔著該 PID 的行程，只清掉過期身分", async () => {
    const { paths, approvals } = await makeHarness();
    const storage = agentStoragePaths(paths);
    const spawn = new SpawnRegistry();
    const child = spawn.spawn({
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1000)"],
      stdio: ["ignore", "ignore", "ignore"],
    });
    children.push(child);
    const identity = await describeProcess(child.pid);
    expect(identity).not.toBeNull();
    expect(processAlive(child.pid)).toBe(true);

    const agentSessionId = "agent_pid_reuse";
    await writeRecord(storage, {
      agentSessionId,
      agentKind: "opencode",
      workingDirectory: paths.root,
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      status: "running",
      completedSteps: 1,
      lastEventSeq: 3,
      pendingPermission: null,
      resultUnknown: false,
      // 同一個 PID，但啟動時間對不上：這是 PID 重用，不能殺現在的行程。
      child: {
        pid: child.pid,
        processGroupId: identity?.processGroupId ?? child.pid,
        startedAt: "WRONG-START-TIME",
      },
    });

    const service = new ExternalAgentsService({
      paths,
      spawn,
      approvals,
      emitState: () => undefined,
      now: () => NOW,
      homeDir: join(paths.root, "home"),
      timeouts: {
        termGraceMs: 20,
        killGraceMs: 20,
        exitTaskTimeoutMs: 50,
        startupCleanupBudgetMs: 500,
      },
    });
    await service.startupCleanup();

    // 真正佔著這個 PID 的行程不能被殺；只是把過期身分清掉並標結果未知。
    expect(processAlive(child.pid)).toBe(true);
    const record = await readRecord(storage, agentSessionId);
    expect(record).toMatchObject({ status: "failed", resultUnknown: true });
    expect(record?.child).toBeUndefined();
  }, 30_000);
});
