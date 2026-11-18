/**
 * 停用狀態跨重啟的契約。
 *
 * 停用模組後重啟：停用狀態保留，相依模組停在 inactive，不會被誤判成
 * failed 而鎖死；重新啟用被依賴的模組後，它們要能回到 active，原本的
 * 資料也還在。
 */

import { describe, expect, it } from "vitest";

import {
  CARDS_DEPENDENTS,
  MODULE_IDS,
  createNoteCard,
  createSession,
  expectProbe,
  mapModules,
  newUlid,
  request,
  requestFrame,
  restartHarness,
  setEnabled,
  startHarness,
  stopHarness,
  type Harness,
  type ModuleInfo,
} from "./support.js";

interface SystemContextSection {
  readonly layer: string;
  readonly title: string;
  readonly text: string;
}

async function systemContext(
  client: Harness["client"],
  sessionId: string,
): Promise<readonly SystemContextSection[]> {
  const reply = await request(client, "module.context.test.system-context", {
    data: { sessionId },
  });
  const data = (reply.payload as { data?: { sections?: SystemContextSection[] } } | undefined)
    ?.data;
  return data?.sections ?? [];
}

async function listMcpServers(
  client: Harness["client"],
): Promise<Array<{ name?: string; serverId?: string }>> {
  const reply = await request(client, "mcp.servers.list", {});
  return (
    (reply.payload as { servers?: Array<{ name?: string; serverId?: string }> } | undefined)
      ?.servers ?? []
  );
}

function expectNoLockedFailure(modules: Map<string, ModuleInfo>): void {
  // 「enabled 為真卻 failed」是重啟後最糟的狀態：使用者沒有把它關掉，
  // 也不能用「再啟用一次」恢復。這裡直接禁止。
  const locked = [...modules.values()].filter((info) => info.enabled && info.state === "failed");
  expect(
    locked.map((info) => `${info.moduleId}: ${info.failure ?? ""}`),
    "不應留下 enabled 為真卻 failed 的模組",
  ).toEqual([]);
}

describe("模組停用狀態跨重啟", () => {
  it("停用 cards 後重啟：相依模組維持 inactive、不以 failed 收場；恢復 cards 後回 active 且卡片還在", async () => {
    let harness = await startHarness();
    try {
      const title = `重啟後仍要存在的卡片 ${Date.now()}`;
      const cardId = await createNoteCard(harness.client, title);

      const disabled = await setEnabled(harness.client, "cards", false);
      expect(disabled.enabled).toBe(false);
      expect(disabled.state).toBe("inactive");

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("cards")).toMatchObject({ enabled: false, state: "inactive" });
      for (const moduleId of CARDS_DEPENDENTS) {
        const info = modules.get(moduleId);
        expect(info, `${moduleId} 應出現在 system.modules.get`).toBeDefined();
        expect(info?.enabled, `${moduleId} 的停用不是使用者設定的`).toBe(true);
        expect(info?.state, `${moduleId} 重啟後應維持 inactive`).toBe("inactive");
        expect(info?.failure ?? null, `${moduleId} 不應被誤判成失敗`).toBeNull();
      }
      expectNoLockedFailure(modules);

      const blocked = await requestFrame(harness.client, "card.list", {});
      expectProbe(blocked, { kind: "error", code: "unsupported" }, "重啟後的 card.list");

      const enabled = await setEnabled(harness.client, "cards", true);
      expect(enabled.enabled).toBe(true);
      expect(enabled.state).toBe("active");

      const restored = await mapModules(harness.client);
      for (const moduleId of MODULE_IDS) {
        const info = restored.get(moduleId);
        expect(info?.enabled, `${moduleId} 應為啟用`).toBe(true);
        expect(info?.state, `${moduleId} 恢復 cards 後應回到 active`).toBe("active");
        expect(info?.failure ?? null, `${moduleId} 恢復後不應有失敗原因`).toBeNull();
      }
      expectNoLockedFailure(restored);

      const listed = await requestFrame(harness.client, "card.list", {});
      expect(listed.kind).toBe("response");
      const cards = (listed.payload as { cards?: Array<{ cardId?: string }> } | undefined)?.cards;
      expect(Array.isArray(cards)).toBe(true);
      expect((cards ?? []).map((card) => card.cardId)).toContain(cardId);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("停用獨立模組 mcp 後重啟：只有 mcp 維持停用，其他模組照常運作", async () => {
    let harness = await startHarness();
    try {
      const disabled = await setEnabled(harness.client, "mcp", false);
      expect(disabled.enabled).toBe(false);
      expect(disabled.state).toBe("inactive");

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("mcp")).toMatchObject({ enabled: false, state: "inactive" });
      for (const moduleId of MODULE_IDS) {
        if (moduleId === "mcp") continue;
        const info = modules.get(moduleId);
        expect(info?.enabled, `${moduleId} 應為啟用`).toBe(true);
        expect(info?.state, `${moduleId} 重啟後應為 active`).toBe("active");
        expect(info?.failure ?? null, `${moduleId} 不應有失敗原因`).toBeNull();
      }
      expectNoLockedFailure(modules);

      expectProbe(
        await requestFrame(harness.client, "mcp.servers.list", {}),
        { kind: "error", code: "unsupported" },
        "重啟後的 mcp.servers.list",
      );
      expect((await requestFrame(harness.client, "card.list", {})).kind).toBe("response");

      const enabled = await setEnabled(harness.client, "mcp", true);
      expect(enabled.enabled).toBe(true);
      expect(enabled.state).toBe("active");
      expectProbe(
        await requestFrame(harness.client, "mcp.servers.list", {}),
        { kind: "response" },
        "重新啟用後的 mcp.servers.list",
      );
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("停用 boards 後重啟：白板檔案保留，重新啟用後仍可讀取", async () => {
    let harness = await startHarness();
    try {
      const boardId = newUlid();
      const title = `重啟後仍要存在的白板 ${Date.now()}`;
      await request(harness.client, "board.create", { boardId, title });

      const disabled = await setEnabled(harness.client, "boards", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("boards")).toMatchObject({ enabled: false, state: "inactive" });
      expectNoLockedFailure(modules);
      expectProbe(
        await requestFrame(harness.client, "board.list", {}),
        { kind: "error", code: "unsupported" },
        "重啟後的 board.list",
      );

      const enabled = await setEnabled(harness.client, "boards", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });

      const listed = await request(harness.client, "board.list", {});
      const boards =
        (listed.payload as { boards?: Array<{ id?: string; title?: string }> } | undefined)
          ?.boards ?? [];
      expect(boards.find((board) => board.id === boardId)?.title).toBe(title);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("停用 settings 後重啟：設定值保留，重新啟用後仍讀得到", async () => {
    let harness = await startHarness();
    try {
      await request(harness.client, "system.settings.set", {
        changes: [{ key: "distillation.time", value: "05:30" }],
        clientRequestId: `setting-${Math.random().toString(36).slice(2)}`,
      });

      const disabled = await setEnabled(harness.client, "settings", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("settings")).toMatchObject({ enabled: false, state: "inactive" });
      expectNoLockedFailure(modules);
      expectProbe(
        await requestFrame(harness.client, "system.settings.get", {}),
        { kind: "error", code: "unsupported" },
        "重啟後的 system.settings.get",
      );

      const enabled = await setEnabled(harness.client, "settings", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });

      const listed = await request(harness.client, "system.settings.get", {});
      const settings =
        (listed.payload as { settings?: Array<{ key?: string; value?: unknown }> } | undefined)
          ?.settings ?? [];
      expect(
        settings.find((setting) => setting.key === "distillation.time")?.value,
        "重啟後設定值應保留",
      ).toBe("05:30");
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("停用 mcp 後重啟：已核准的 MCP 伺服器保留，重新啟用後仍在清單", async () => {
    let harness = await startHarness();
    try {
      await request(harness.client, "system.subscribe", {});
      const name = `重啟保留的 MCP 伺服器 ${Date.now()}`;
      const added = await request(harness.client, "mcp.server.add", {
        name,
        transport: "stdio",
        command: "/usr/bin/true",
        allowedHosts: [],
      });
      const approvalId = (added.payload as { approvalId?: string } | undefined)?.approvalId;
      expect(typeof approvalId).toBe("string");
      await request(harness.client, "approval.decide", { approvalId, optionId: "approve" });

      let servers: Array<{ name?: string; serverId?: string }> = [];
      for (let attempt = 0; attempt < 50 && servers.length === 0; attempt += 1) {
        servers = await listMcpServers(harness.client);
        if (servers.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(servers.map((server) => server.name)).toContain(name);
      const serverId = servers.find((server) => server.name === name)?.serverId;

      const disabled = await setEnabled(harness.client, "mcp", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("mcp")).toMatchObject({ enabled: false, state: "inactive" });
      expectNoLockedFailure(modules);

      const enabled = await setEnabled(harness.client, "mcp", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });

      const restored = await listMcpServers(harness.client);
      expect(restored.find((server) => server.name === name)?.serverId).toBe(serverId);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("停用 memory 後重啟：核心記憶仍在，重新啟用後回到上下文第 3 層", async () => {
    let harness = await startHarness();
    try {
      const sessionId = await createSession(harness.client);
      const title = `核心記憶保留探針 ${Date.now()}`;
      const sourceCardId = await createNoteCard(harness.client, `蒸餾來源 ${Date.now()}`);
      await request(harness.client, "module.memory.test.zero-freshness", {
        data: { cardIds: [sourceCardId] },
      });
      const distilled = await request(harness.client, "module.memory.test.run-daily", {
        data: { itemText: `使用者記得${title}`, title },
      });
      const run = (distilled.payload as { data?: { run?: { status?: string } | null } } | undefined)
        ?.data?.run;
      expect(run?.status, "每日蒸餾應完成").toBe("completed");

      const before = await systemContext(harness.client, sessionId);
      expect(
        before.some((section) => section.layer === "core-memory" && section.text.includes(title)),
        "啟用時核心記憶應在第 3 層",
      ).toBe(true);

      const disabled = await setEnabled(harness.client, "memory", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("memory")).toMatchObject({ enabled: false, state: "inactive" });
      expectNoLockedFailure(modules);
      const withoutMemory = await systemContext(harness.client, sessionId);
      expect(
        withoutMemory.filter((section) => section.layer === "core-memory"),
        "停用時第 3 層不應出現",
      ).toEqual([]);

      const enabled = await setEnabled(harness.client, "memory", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });

      const restored = await systemContext(harness.client, sessionId);
      const core = restored.find((section) => section.layer === "core-memory");
      expect(core?.text, "重新啟用後核心記憶應回來").toContain(title);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);
  it("停用 scheduler 後重啟：排程保留，重新啟用後仍在清單", async () => {
    let harness = await startHarness();
    try {
      const name = `重啟保留的排程 ${Date.now()}`;
      const created = await request(harness.client, "module.scheduler.create", {
        data: {
          name,
          kind: "daily",
          spec: { time: "23:59" },
          task: { type: "agent", prompt: "契約測試：不會在測試期間到期" },
        },
      });
      const scheduleId = (
        created.payload as { data?: { schedule?: { scheduleId?: string } } } | undefined
      )?.data?.schedule?.scheduleId;
      expect(typeof scheduleId).toBe("string");

      const disabled = await setEnabled(harness.client, "scheduler", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("scheduler")).toMatchObject({ enabled: false, state: "inactive" });
      expectNoLockedFailure(modules);
      expectProbe(
        await requestFrame(harness.client, "notification.list", {}),
        { kind: "error", code: "unsupported" },
        "重啟後的 notification.list",
      );

      const enabled = await setEnabled(harness.client, "scheduler", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });

      const listed = await request(harness.client, "module.scheduler.list", { data: {} });
      const schedules =
        (
          listed.payload as
            { data?: { schedules?: Array<{ scheduleId?: string; name?: string }> } } | undefined
        )?.data?.schedules ?? [];
      expect(schedules.find((schedule) => schedule.scheduleId === scheduleId)?.name).toBe(name);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("停用 context 後重啟：只有硬相依的 dealing 連帶 inactive，memory 維持 active；恢復後全部 active", async () => {
    let harness = await startHarness();
    try {
      const disabled = await setEnabled(harness.client, "context", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expectNoLockedFailure(modules);
      expect(modules.get("context")).toMatchObject({ enabled: false, state: "inactive" });
      expect(modules.get("dealing")).toMatchObject({ enabled: true, state: "inactive" });
      expect(modules.get("memory")).toMatchObject({ enabled: true, state: "active" });

      const enabled = await setEnabled(harness.client, "context", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });
      const restored = await mapModules(harness.client);
      expect(
        [...restored.values()]
          .filter((info) => info.state !== "active")
          .map((info) => info.moduleId),
        "恢復 context 後所有模組都應回到 active",
      ).toEqual([]);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);
});
