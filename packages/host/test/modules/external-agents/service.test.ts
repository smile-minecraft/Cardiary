import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CardiaryPaths } from "@cardiary/module-api";
import type { ExternalAgentSessionRecord } from "@cardiary/domain";
import { afterEach, describe, expect, it } from "vitest";

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
  writeRecord,
} from "../../../src/modules/external-agents/store.js";
import type { SpawnRegistry } from "../../../src/spawn/wrapper.js";

const NOW = new Date("2026-05-01T00:00:00.000Z");
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

class FakeApprovals implements AgentApprovalsService {
  readonly requests: AgentApprovalRequestInput[] = [];
  readonly withdrawn: string[] = [];
  #count = 0;
  #pending = new Map<string, (outcome: { outcome: "withdrawn" }) => void>();

  async request(input: AgentApprovalRequestInput): Promise<{ approvalId: string }> {
    this.#count += 1;
    this.requests.push(input);
    const approvalId = `appr_${this.#count}`;
    this.#pending.set(approvalId, () => undefined);
    return { approvalId };
  }

  waitForDecision(approvalId: string): Promise<unknown> {
    return new Promise((resolve) => {
      this.#pending.set(approvalId, resolve);
    });
  }

  async withdraw(approvalId: string): Promise<void> {
    this.withdrawn.push(approvalId);
    this.#pending.get(approvalId)?.({ outcome: "withdrawn" });
    this.#pending.delete(approvalId);
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

async function makeHarness(): Promise<Harness> {
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
      kind: "tool-execution",
      risk: "medium",
      toolName: "claude-code-stream-json",
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
