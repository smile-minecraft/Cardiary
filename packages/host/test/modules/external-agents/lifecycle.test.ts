import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CardiaryPaths } from "@cardiary/module-api";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AgentApprovalRequestInput,
  AgentApprovalsService,
} from "../../../src/modules/contract.js";
import { ExternalAgentsService } from "../../../src/modules/external-agents/service.js";
import { agentStoragePaths, readRecord } from "../../../src/modules/external-agents/store.js";
import { SpawnRegistry, type ManagedChild } from "../../../src/spawn/wrapper.js";

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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function eventually(check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("條件等待逾時");
}

type Outcome = "approved" | "denied" | "withdrawn";

class FakeApprovals implements AgentApprovalsService {
  readonly requests: AgentApprovalRequestInput[] = [];
  #count = 0;
  #pending = new Map<string, (outcome: { outcome: Outcome }) => void>();

  async request(input: AgentApprovalRequestInput): Promise<{ approvalId: string }> {
    this.#count += 1;
    const approvalId = `appr_${this.#count}`;
    this.requests.push(input);
    this.#pending.set(approvalId, () => undefined);
    return { approvalId };
  }

  waitForDecision(approvalId: string): Promise<{ outcome: Outcome }> {
    return new Promise((resolve) => {
      this.#pending.set(approvalId, resolve);
    });
  }

  async withdraw(approvalId: string): Promise<void> {
    this.#pending.get(approvalId)?.({ outcome: "withdrawn" });
    this.#pending.delete(approvalId);
  }

  async withdrawPendingForAgent(): Promise<void> {
    for (const [id, resolve] of [...this.#pending]) {
      resolve({ outcome: "withdrawn" });
      this.#pending.delete(id);
    }
  }

  approve(approvalId: string): void {
    this.#pending.get(approvalId)?.({ outcome: "approved" });
    this.#pending.delete(approvalId);
  }
}

const neverSpawns = {
  spawn(): never {
    throw new Error("這個測試不該啟動代理行程");
  },
  async cancelAll(): Promise<void> {},
} as unknown as SpawnRegistry;

async function makeService(options?: {
  readonly spawn?: SpawnRegistry;
  readonly logger?: { warn(message: string): void };
}): Promise<{
  service: ExternalAgentsService;
  paths: CardiaryPaths;
  approvals: FakeApprovals;
  workingDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-agent-lifecycle-"));
  roots.push(root);
  const workingDirectory = await mkdtemp(join(tmpdir(), "cardiary-agent-work-"));
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
  const approvals = new FakeApprovals();
  const service = new ExternalAgentsService({
    paths,
    spawn: options?.spawn ?? neverSpawns,
    approvals,
    emitState: () => undefined,
    now: () => NOW,
    homeDir: join(root, "home"),
    // 把等待上限壓短，讓不可終止行程的測試不必等真的 5 秒。
    timeouts: {
      cancelGraceMs: 20,
      termGraceMs: 20,
      killGraceMs: 20,
      exitTaskTimeoutMs: 50,
      startupCleanupBudgetMs: 200,
    },
    ...(options?.logger ? { logger: options.logger } : {}),
  });
  return { service, paths, approvals, workingDirectory };
}

/** 永不結束的行程替身，模擬忽略 SIGKILL、真的殺不掉的行程。 */
function unkillableChild(signals?: NodeJS.Signals[]): ManagedChild {
  return {
    pid: 999_999_999,
    running: true,
    exited: new Promise<never>(() => undefined),
    write: () => undefined,
    writeThenCloseInput: async () => undefined,
    closeInput: () => undefined,
    signal: (sig: NodeJS.Signals) => signals?.push(sig),
    stdout: null,
    stderr: null,
  } as unknown as ManagedChild;
}

function spawnReturning(child: ManagedChild): SpawnRegistry {
  return { spawn: () => child } as unknown as SpawnRegistry;
}

/**
 * 可以從測試主動結束的行程替身。
 * 用來模擬「終態已寫入但行程還活著，之後行程才自己結束」的路徑：
 * 這時 #onExit 必須把追蹤表清掉，否則該筆永久留在 #live。
 */
function controlledChild(): ManagedChild & {
  finish(): void;
  readonly signals: NodeJS.Signals[];
} {
  let running = true;
  let resolveExited!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExited = resolve;
  });
  const signals: NodeJS.Signals[] = [];
  const child = {
    pid: 888_888,
    get running() {
      return running;
    },
    exited,
    write: () => undefined,
    writeThenCloseInput: async () => undefined,
    closeInput: () => undefined,
    signal: (sig: NodeJS.Signals) => signals.push(sig),
    stdout: null,
    stderr: null,
    finish() {
      running = false;
      resolveExited({ code: 0, signal: null });
    },
    signals,
  };
  return child as unknown as ManagedChild & {
    finish(): void;
    readonly signals: NodeJS.Signals[];
  };
}

describe("外部代理行程生命週期", () => {
  it("子行程關閉 stdin 後仍存活，writeThenCloseInput 不會拋未捕捉例外也不會卡住", async () => {
    const registry = new SpawnRegistry();
    // 真的關閉 fd 0 但留著行程：這是 EPIPE 的觸發條件。
    const script =
      'import { closeSync } from "node:fs"; closeSync(0); setInterval(() => undefined, 1000);';
    const child = registry.spawn({
      command: process.execPath,
      args: ["--input-type=module", "-e", script],
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // wrapper 必須在 stdin 上掛 error listener；沒有它，write 的 EPIPE
    // 會變成 uncaught exception 讓整個 host 崩潰。
    expect(child.child.stdin?.listenerCount("error")).toBeGreaterThan(0);

    // 對已關閉的管線寫入：callback 帶錯誤、error event 被吞掉，兩件事都不能卡住或拋出。
    await withTimeout(
      child.writeThenCloseInput('{"method":"session/cancel"}\n'),
      1_000,
      "writeThenCloseInput 在 EPIPE 後卡住",
    );
    expect(child.running).toBe(true);

    // 收尾仍能完成：送出 SIGKILL 後 child.exited 會 resolve。
    child.signal("SIGKILL");
    await withTimeout(child.exited, 3_000, "EPIPE 後行程無法終止");
  });

  it.skipIf(process.platform !== "darwin")(
    "行程忽略 SIGKILL 時 stop 仍在期限內返回並留下診斷",
    async () => {
      const child = unkillableChild();
      const warnings: string[] = [];
      const { service, paths, approvals, workingDirectory } = await makeService({
        spawn: spawnReturning(child),
        logger: { warn: (message) => warnings.push(message) },
      });

      const started = await service.start({ agentKind: "opencode", workingDirectory });
      approvals.approve(started.approvalId);
      // 等 #spawnAgent 把紀錄寫成 running，代表行程已經進到 #live。
      const storage = agentStoragePaths(paths);
      await eventually(
        async () => (await readRecord(storage, started.agentSessionId))?.status === "running",
      );

      const stopped = await withTimeout(
        service.stop(started.agentSessionId),
        2_000,
        "stop 在不可終止行程上卡住",
      );
      expect(stopped).toEqual({ agentSessionId: started.agentSessionId, stopped: true });
      expect(warnings.some((w) => w.includes("SIGKILL"))).toBe(true);
      expect(warnings.some((w) => w.includes("超過"))).toBe(true);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "行程殺不掉時保留 live，後續 stop 仍能再次嘗試終止",
    async () => {
      const signals: NodeJS.Signals[] = [];
      const child = unkillableChild(signals);
      const { service, approvals, workingDirectory } = await makeService({
        spawn: spawnReturning(child),
      });

      const started = await service.start({ agentKind: "opencode", workingDirectory });
      approvals.approve(started.approvalId);
      await eventually(async () => {
        const listed = await service.list();
        return listed[0]?.status === "running";
      });

      await withTimeout(service.stop(started.agentSessionId), 2_000, "第一次 stop 卡住");
      const afterFirst = signals.filter((s) => s === "SIGKILL").length;
      expect(afterFirst).toBeGreaterThan(0);

      // 行程還活著，#live 必須保留；再 stop 一次會重新走到終止流程、再送一次 SIGKILL。
      await withTimeout(service.stop(started.agentSessionId), 2_000, "第二次 stop 卡住");
      expect(signals.filter((s) => s === "SIGKILL").length).toBeGreaterThan(afterFirst);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "session 進入終態後，list 與重複 stop 仍從耐久紀錄正確呈現",
    async () => {
      const { service, paths, workingDirectory } = await makeService();
      const storage = agentStoragePaths(paths);

      const started = await service.start({ agentKind: "opencode", workingDirectory });
      // 還沒核准就 stop：走 waiting-approval → stopped 的終態路徑，行程不曾啟動。
      await service.stop(started.agentSessionId);

      // list() 與 stop() 都以磁碟上的耐久紀錄為準，不能有時序或狀態差異。
      const listed = await service.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        agentSessionId: started.agentSessionId,
        status: "stopped",
      });
      const stored = await readRecord(storage, started.agentSessionId);
      expect(stored?.status).toBe("stopped");

      // 對已經是終態的 session 再 stop 一次：不重複計入、不拋錯，回 stopped:false。
      const again = await service.stop(started.agentSessionId);
      expect(again).toEqual({ agentSessionId: started.agentSessionId, stopped: false });
      expect((await service.list())[0]?.status).toBe("stopped");
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "終態保留的行程在自行結束後從追蹤表移除，不長期累積",
    async () => {
      const controlled = controlledChild();
      const { service, approvals, workingDirectory } = await makeService({
        spawn: spawnReturning(controlled),
      });

      const started = await service.start({ agentKind: "opencode", workingDirectory });
      approvals.approve(started.approvalId);
      await eventually(async () => (await service.list())[0]?.status === "running");

      // SIGKILL 也殺不掉：stop 回傳後行程仍活著，刻意保留在 #live 供補殺。
      await withTimeout(service.stop(started.agentSessionId), 2_000, "第一次 stop 卡住");
      expect(service.trackedLiveSessionIds()).toContain(started.agentSessionId);

      // 行程之後自己結束，#onExit 必須把這筆從 #live 移除。
      controlled.finish();
      await eventually(
        async () => !service.trackedLiveSessionIds().includes(started.agentSessionId),
        1_000,
      );
      expect(service.trackedLiveSessionIds()).not.toContain(started.agentSessionId);
    },
  );

  it.skipIf(process.platform !== "darwin")("pauseAll 對終態但仍活著的行程會補殺", async () => {
    const signals: NodeJS.Signals[] = [];
    const child = unkillableChild(signals);
    const { service, approvals, workingDirectory } = await makeService({
      spawn: spawnReturning(child),
    });

    const started = await service.start({ agentKind: "opencode", workingDirectory });
    approvals.approve(started.approvalId);
    await eventually(async () => (await service.list())[0]?.status === "running");

    // 先把紀錄推到終態但行程還活著（保留在 #live）。
    await withTimeout(service.stop(started.agentSessionId), 2_000, "stop 卡住");
    const before = signals.filter((s) => s === "SIGKILL").length;
    expect(before).toBeGreaterThan(0);
    expect(service.trackedLiveSessionIds()).toContain(started.agentSessionId);

    // pauseAll 走終態分支，也必須對還活著的 child 再補殺一次。
    await withTimeout(service.pauseAll("測試暫停"), 2_000, "pauseAll 卡住");
    expect(signals.filter((s) => s === "SIGKILL").length).toBeGreaterThan(before);
  });
});
