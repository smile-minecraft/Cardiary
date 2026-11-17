/**
 * MCP 第一方模組。
 *
 * 責任邊界：
 * - 伺服器設定是 `state/mcp-servers.json` 的正本；本模組只透過
 *   `McpServerStore` 讀寫，不自己碰檔案。
 * - 新增伺服器一定先建立人工審批；核准前不寫正本、不啟動、不註冊工具。
 * - 每個已啟動的伺服器註冊一個工具組，開場只有 `list_tools` 與 `call`
 *   兩個入口；伺服器真正的工具在第一次載入後才加入。
 * - 工具呼叫的永久禁止項在 `evaluateMcpToolPolicy` 擋一次，引擎的權限
 *   閘道另外會把未知的 `mcp.*` 工具當成需要人工審批。
 */
import { randomUUID } from "node:crypto";

import type { JsonValue, ToolBundleDraft } from "@cardiary/engine-adapter";
import { McpConfigError, type McpServerInput, type McpServerRecord } from "@cardiary/domain";
import type {
  HostModule,
  ModuleActivationContext,
  ProtocolRegistrationHandle,
} from "@cardiary/module-api";
import type { McpServerInfo } from "@cardiary/protocol";
import {
  FileRegistry,
  FolderLayout,
  McpServerApprovalStore,
  McpServerStore,
} from "@cardiary/storage";

import { HOST_SERVICE_NAMES, ProtocolHandlerError, type CardEnvironment } from "../contract.js";
import type { HostEngine } from "../../engine/types.js";
import type { SpawnRegistry } from "../../spawn/wrapper.js";
import {
  createMcpClient,
  McpClientError,
  type McpClient,
  type McpClientFactory,
} from "./client.js";
import { manifest } from "./manifest.js";
import { registerMcpProtocol, toServerInfo, type McpController } from "./protocol.js";
import { McpToolCache } from "./tool-cache.js";
import { buildBundleDraft, type McpServerRuntime } from "./tools.js";

export { manifest };

/** 測試可以替換的相依；正式執行全部由模組主機提供。 */
export interface McpModuleOptions {
  readonly store?: McpServerStore;
  readonly engine?: HostEngine;
  readonly spawn?: SpawnRegistry;
  readonly clientFactory?: McpClientFactory;
  readonly folderRoot?: string;
  readonly homeDir?: string;
  readonly registry?: FileRegistry;
  /**
   * 核准綁定的儲存。沒有傳入時從 `cardStorage` 服務的狀態庫建立；沒有狀態庫
   * 就啟用不了任何伺服器（fail closed），因為無法證明任何設定通過核准。
   */
  readonly bindings?: McpServerApprovalStore;
  readonly now?: () => Date;
  /** HTTP MCP 請求的逾期毫秒數；測試可縮短，正式執行沿用 client.ts 的 30 秒。 */
  readonly requestTimeoutMs?: number;
}

/** 已啟動伺服器的執行狀態與工具組註冊。 */
interface ActiveServer {
  runtime: McpServerRuntime;
  registration: ProtocolRegistrationHandle;
}

/**
 * 一次進行中的啟動。`cancelled` 就是這次啟動的 token：停用、移除、改設定
 * 或關閉模組時會把它翻成 true，晚回來的結果一律丟棄。
 */
interface Launch {
  readonly client: McpClient;
  cancelled: boolean;
  /** 啟動工作本身；`settled()` 與 `stopServer()` 都要等它結束。 */
  task: Promise<void>;
}

/** 模組對外提供的把手；`settled` 只給測試等待背景啟動完成。 */
export interface McpModuleHandle {
  readonly controller: McpController;
  settled(): Promise<void>;
  dispose(): Promise<void>;
}

/** 測資或替身可以傳入；正式啟動時從模組主機取服務。 */
export async function activateMcpModule(
  context: ModuleActivationContext,
  options: McpModuleOptions = {},
): Promise<McpModuleHandle> {
  const paths = context.services.paths;
  const folderRoot = options.folderRoot ?? paths.root;
  const layout = new FolderLayout(folderRoot);
  const store = options.store ?? new McpServerStore(layout);
  const engine = options.engine ?? context.services.host.require<HostEngine>("engine");
  const spawn = options.spawn ?? context.services.host.require<SpawnRegistry>("spawn");
  const clientFactory = options.clientFactory ?? createMcpClient;
  const logger = context.services.logger;
  const protocol = context.services.protocol;

  // 工具快取要登記到檔案登記簿才不會被每日掃描當成孤兒。模組主機有提供
  // 卡片儲存服務時才拿得到登記簿；沒有時模組照常運作，只是每次都要問伺服器。
  const registry = resolveRegistry(context, options, layout);
  const toolCache =
    registry === null
      ? null
      : new McpToolCache(layout, registry, options.now === undefined ? {} : { now: options.now });
  // 核准綁定比正本處於更受保護的狀態庫內；只有協定核准後的寫入會異動它。
  // 正本可以被核准流程以外的路徑改寫，所以啟動前一定要拿兩邊比對。
  const bindings = resolveBindings(context, options);

  const active = new Map<string, ActiveServer>();
  const failures = new Map<string, string>();
  /**
   * 進行中的啟動。作廢的啟動留到工作自己結束才移除，`settled()` 才等得到；
   * 舊啟動不能在新的設定生效後才把工具組掛回去。
   */
  const launches = new Map<string, Launch>();
  const pendingAdds = new Map<string, Promise<void>>();
  let disposed = false;
  /** 啟動時載入設定的背景工作；`settled` 要等它跑完，測試才不會跟著競速。 */
  let startupTask: Promise<void> = Promise.resolve();

  const clientContext = {
    folderRoot,
    spawn,
    logger,
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
  };

  const registerBundle = (runtime: McpServerRuntime): ProtocolRegistrationHandle => {
    const draft: ToolBundleDraft = buildBundleDraft(runtime);
    const registration = context.registerToolBundle(draft);
    active.set(runtime.record.serverId, { runtime, registration });
    return registration;
  };

  /** 正本內容與核准綁定一致時才能啟動；沒有綁定維護能力就視為未核准。 */
  const isApprovedForLaunch = (record: McpServerRecord): boolean =>
    bindings !== null && bindings.isApproved(record);

  const unapprovedMessage = "設定內容與核准紀錄不符，可能被修改過；不會啟動，請移除後重新新增。";

  const emitChanged = (server: McpServerInfo, removed = false): void => {
    protocol.emit({
      kind: "mcp-servers-changed",
      payload: { server, removed } as unknown as JsonValue,
    });
  };

  const reportFailure = (serverId: string, message: string): void => {
    failures.set(serverId, message);
    logger.warn("MCP 伺服器啟動失敗", { serverId, message });
  };

  /** 這次啟動是否還是有效的那一次；作廢或已被後續啟動取代就回 false。 */
  const isCurrentLaunch = (serverId: string, launch: Launch): boolean =>
    !disposed && !launch.cancelled && launches.get(serverId) === launch;

  const startServer = async (record: McpServerRecord): Promise<void> => {
    if (disposed || !record.enabled || active.has(record.serverId)) {
      return;
    }
    if (!isApprovedForLaunch(record)) {
      // 正本被核准流程以外的路徑改過就算竄改：不啟動，也不註冊工具。
      failures.set(record.serverId, unapprovedMessage);
      logger.warn("MCP 伺服器的設定與核准紀錄不符，不會啟動", { serverId: record.serverId });
      emitChanged(infoOf(record));
      return;
    }
    const existing = launches.get(record.serverId);
    if (existing !== undefined && !existing.cancelled) {
      return existing.task;
    }

    let client: McpClient;
    try {
      client = clientFactory(record, clientContext);
    } catch (error) {
      reportFailure(record.serverId, describeError(error));
      emitChanged(infoOf(record));
      return;
    }

    const launch: Launch = { client, cancelled: false, task: Promise.resolve() };
    launches.set(record.serverId, launch);
    launch.task = (async () => {
      try {
        // 先做一次 tools/list：連不上、協定不合或網域被擋都在這裡失敗。
        // 失敗時不註冊工具，模型看不到一個永遠壞掉的伺服器。
        const tools = await client.listTools();
        // 連線期間設定可能被移除、停用、換網域，或整個模組關閉。回來後
        // 重新讀正本，只要不是當初核准並連線的那一筆，這次啟動就作廢。
        const current = await store.get(record.serverId);
        if (
          !isCurrentLaunch(record.serverId, launch) ||
          current === null ||
          !current.enabled ||
          !sameConnection(record, current) ||
          !isApprovedForLaunch(current)
        ) {
          await client.close().catch(() => undefined);
          return;
        }
        // 開機時抓到的清單是目前的真相，順手更新快取；重啟後 list_tools
        // 可以直接用快取，不必再連一次。快取寫不進去不影響伺服器運作。
        if (toolCache !== null) {
          try {
            toolCache.save(current.serverId, tools);
          } catch (error) {
            logger.warn("MCP 工具快取寫入失敗", {
              serverId: current.serverId,
              message: describeError(error),
            });
          }
        }
        const runtime: McpServerRuntime = {
          record: current,
          client,
          cache: toolCache?.portFor(current.serverId) ?? null,
          refresh: () => {
            if (!disposed && active.get(current.serverId)?.runtime === runtime) {
              // 同一個 bundleId+generation 重新註冊會換掉引擎裡的定義。
              // 不要先 dispose 舊手把：retire 以 bundleId+generation 為鍵，
              // 會把剛換上的新定義一起退掉。
              registerBundle(runtime);
            }
          },
          state: "ready",
          // 啟動時的 tools/list 只用來確認連線與更新快取；工具定義要等模型
          // 呼叫 list_tools 之後才註冊，讓對話開場只看到兩個入口工具。
          tools: null,
        };
        registerBundle(runtime);
        failures.delete(current.serverId);
        logger.info("MCP 伺服器已啟動", {
          serverId: current.serverId,
          tools: tools.length,
        });
        emitChanged(infoOf(current));
      } catch (error) {
        await client.close().catch(() => undefined);
        // 作廢的啟動不是失敗，不要蓋掉停用或移除的結果。
        if (isCurrentLaunch(record.serverId, launch)) {
          reportFailure(record.serverId, describeError(error));
          emitChanged(infoOf(record));
        }
      }
    })().finally(() => {
      if (launches.get(record.serverId) === launch) {
        launches.delete(record.serverId);
      }
    });
    return launch.task;
  };

  /**
   * 停掉伺服器，也讓進行中的啟動失效。先關閉 client 讓 `listTools()` 解脫，
   * 再等啟動工作結束；否則舊啟動會在新的設定生效後才完成，把工具掛回去。
   *
   * 等待有上界：`client.close()` 會中止進行中的請求，正常情況下工作立刻結束；
   * 上界只是保險，讓移除、停用或關閉模組不會被一個不聽話的連線永遠拖住。
   */
  const stopServer = async (serverId: string): Promise<void> => {
    const launch = launches.get(serverId);
    // 等待期間可能已經有新的啟動完成並註冊新的工具組（快速停用後又啟用）；
    // 只有當初要停掉的那一筆還在 `active` 時才能拆，否則會把新的 bundle
    // 一起 dispose 掉，留下一個看似啟用卻沒有工具的伺服器。
    const activeBefore = active.get(serverId);
    if (launch !== undefined) {
      launch.cancelled = true;
      await launch.client.close().catch(() => undefined);
      await settleWithin(launch.task, STOP_WAIT_MS);
    }
    const entry = active.get(serverId);
    if (entry === undefined || entry !== activeBefore) {
      return;
    }
    active.delete(serverId);
    entry.registration.dispose();
    await entry.runtime.client.close().catch(() => undefined);
  };

  const startAll = (): void => {
    startupTask = (async () => {
      let records: McpServerRecord[];
      try {
        records = await store.list();
      } catch (error) {
        // 設定檔被手改、損毀或被整份換掉時，一律不啟動任何伺服器。這個
        // 檔案只有核准流程會寫（代理的寫入一律被硬規則拒絕），讀不出來就
        // 當成不信任；要讓人看得到，不能只在日誌裡留一行。
        const message = describeError(error);
        logger.error("MCP 伺服器清單載入失敗，沒有啟動任何伺服器", { message });
        protocol.emit({
          kind: "notification",
          title: "MCP 設定無法讀取",
          body: `state/mcp-servers.json 讀不出來，這次啟動沒有啟動任何 MCP 伺服器：${message}`,
          level: "error",
        });
        return;
      }
      if (bindings === null) {
        // 沒有核准綁定的儲存時，任何紀錄都無法證明通過核准，不能啟動。
        logger.error("沒有可用的核准狀態庫，沒有啟動任何伺服器");
        protocol.emit({
          kind: "notification",
          title: "MCP 設定無法核准",
          body: "找不到受保護的核准狀態，這次啟動沒有啟動任何 MCP 伺服器。",
          level: "error",
        });
        return;
      }
      const pending: McpServerRecord[] = [];
      for (const record of records) {
        if (record.enabled) {
          if (isApprovedForLaunch(record)) {
            await startServer(record);
          } else {
            // 未核准不是「壞掉」：不建立連線，也不要留下 failed 讓人以為
            // 伺服器故障。只記入 pending，交給下面那一次通知統一說明。
            pending.push(record);
          }
        }
      }
      if (pending.length > 0) {
        logger.warn("MCP 伺服器的設定與核准紀錄不符，沒有啟動", {
          serverIds: pending.map((record) => record.serverId),
        });
        protocol.emit({
          kind: "notification",
          title: "MCP 設定待核准",
          body: `${pending.length} 個 MCP 伺服器的設定內容與核准紀錄不符，沒有啟動：${pending.map((record) => record.name).join("、")}。請到設定移除後重新新增。`,
          level: "warning",
        });
      }
    })().catch((error: unknown) => {
      logger.warn("MCP 伺服器清單載入失敗", { message: describeError(error) });
    });
  };

  const serverInfo = async (serverId: string): Promise<McpServerInfo> => {
    const record = await store.get(serverId);
    if (record === null) {
      throw new ProtocolHandlerError("not_found", `找不到 MCP 伺服器：${serverId}`);
    }
    return infoOf(record);
  };

  const infoOf = (record: McpServerRecord): McpServerInfo => {
    const entry = active.get(record.serverId);
    const failure = failures.get(record.serverId);
    return toServerInfo(
      record,
      entry === undefined
        ? failure === undefined
          ? null
          : { state: "failed", failure }
        : { state: entry.runtime.state, ...(failure === undefined ? {} : { failure }) },
    );
  };

  const decideAdd = async (approvalId: string, input: McpServerInput): Promise<void> => {
    try {
      const resolution = await engine.approvals.waitForDecision(approvalId);
      if (disposed) {
        return;
      }
      if (resolution.outcome !== "approved") {
        protocol.emit({
          kind: "notification",
          title: "MCP 伺服器未新增",
          body: `「${input.name}」的審批結果是 ${resolution.outcome}，沒有寫入任何設定。`,
          level: "info",
        });
        return;
      }
      const record = await store.add(input);
      if (bindings === null) {
        // 沒有綁定儲存就無法證明這筆設定通過核准；不能放任一個永遠不會
        // 啟動、不綁定的紀錄留在正本。
        logger.error("沒有可用的核准狀態庫，無法綁定核准紀錄", {
          serverId: record.serverId,
        });
        protocol.emit({
          kind: "notification",
          title: "MCP 核准無法登記",
          body: `「${record.name}」已寫入正本，但找不到受保護的核准狀態，不會啟動；請移除後重新新增。`,
          level: "error",
        });
        emitChanged(infoOf(record));
        return;
      }
      // 只有走過核准的寫入會把設定內容綁定進受保護的狀態庫。
      bindings.approve(record);
      protocol.emit({
        kind: "notification",
        title: "MCP 伺服器已新增",
        body: `「${record.name}」已核准；工具會在對話第一次載入時出現。`,
        level: "info",
      });
      emitChanged(infoOf(record));
      await startServer(record);
    } catch (error) {
      logger.warn("MCP 伺服器審批流程失敗", {
        approvalId,
        message: describeError(error),
      });
    } finally {
      pendingAdds.delete(approvalId);
    }
  };

  const controller: McpController = {
    async listServers(): Promise<McpServerInfo[]> {
      const records = await store.list();
      return records.map((record) => infoOf(record));
    },

    async requestAdd(input: McpServerInput): Promise<{ approvalId: string }> {
      const approval = await engine.approvals.request({
        action: {
          kind: "module-enable",
          summary: `新增 MCP 伺服器「${input.name}」`,
          details: describeTarget(input),
        },
        risk: "high",
        requestedBy: { kind: "host", component: "mcp" },
        // 不屬於任何對話或外部代理；宿主審批只綁定元件與請求識別碼。
        hostApproval: { component: "mcp", requestId: randomUUID() },
      });
      protocol.emit({
        kind: "notification",
        title: "MCP 伺服器等待審批",
        body: `要新增「${input.name}」；核准前不會啟動，也不會註冊任何工具。`,
        level: "warning",
      });
      const task = decideAdd(approval.id, input);
      pendingAdds.set(approval.id, task);
      return { approvalId: approval.id };
    },

    async removeServer(serverId: string): Promise<boolean> {
      const last = await serverInfo(serverId);
      await stopServer(serverId);
      failures.delete(serverId);
      const removed = await store.remove(serverId);
      if (!removed) {
        throw new ProtocolHandlerError("not_found", `找不到 MCP 伺服器：${serverId}`);
      }
      // 快取屬於這個伺服器；同名伺服器重新建立時不該繼承舊工具。
      try {
        toolCache?.remove(serverId);
      } catch (error) {
        logger.warn("MCP 工具快取清除失敗", {
          serverId,
          message: describeError(error),
        });
      }
      bindings?.revoke(serverId);
      emitChanged(last, true);
      return true;
    },

    async setEnabled(serverId: string, enabled: boolean): Promise<McpServerInfo> {
      const current = await store.get(serverId);
      if (current === null) {
        throw new ProtocolHandlerError("not_found", `找不到 MCP 伺服器：${serverId}`);
      }
      const approvedBefore = bindings !== null && bindings.isApproved(current);
      if (enabled && !approvedBefore) {
        // 啟動前一定要先證明設定與核准綁定一致；沒有就不能把 enabled 改成
        // true，否則手改正本的人就能零審批啟動。
        throw new ProtocolHandlerError(
          "conflict",
          "設定內容與核准紀錄不符，不能啟用；請移除後重新新增。",
        );
      }
      const record = await store.setEnabled(serverId, enabled);
      // 只有改動前就已經通過綁定比對的紀錄才重新綁定；不能用停用順手替
      // 手改過的內容背書。
      if (approvedBefore && bindings !== null) {
        bindings.approve(record);
      }
      if (enabled) {
        await startServer(record);
      } else {
        await stopServer(serverId);
        failures.delete(serverId);
      }
      const info = await serverInfo(record.serverId);
      emitChanged(info);
      return info;
    },

    async setAllowedHosts(
      serverId: string,
      allowedHosts: readonly string[],
    ): Promise<McpServerInfo> {
      const current = await store.get(serverId);
      if (current === null) {
        throw new ProtocolHandlerError("not_found", `找不到 MCP 伺服器：${serverId}`);
      }
      // 修改設定內容也是一種寫入；手改過的正本不能靠這個請求重新背書。
      if (bindings === null || !bindings.isApproved(current)) {
        throw new ProtocolHandlerError(
          "conflict",
          "設定內容與核准紀錄不符，不能修改；請移除後重新新增。",
        );
      }
      const record = await store.setAllowedHosts(serverId, allowedHosts);
      // 通過綁定比對後才是使用者這次要求的變更，重新綁定新的內容。
      bindings.approve(record);
      if (record.enabled && record.transport === "http") {
        // 網域白名單改變後重新連線；舊連線不能沿用先前的判斷。`stopServer`
        // 也會讓進行中的啟動失效，避免用舊白名單完成啟動。
        await stopServer(serverId);
        await startServer(record);
      }
      const info = await serverInfo(record.serverId);
      emitChanged(info);
      return info;
    },
  };

  const protocolRegistration = registerMcpProtocol(protocol, controller);

  startAll();

  return {
    controller,
    async settled(): Promise<void> {
      await startupTask;
      while (launches.size > 0 || pendingAdds.size > 0) {
        await Promise.allSettled([
          ...[...launches.values()].map((launch) => launch.task),
          ...pendingAdds.values(),
        ]);
      }
    },
    async dispose(): Promise<void> {
      disposed = true;
      protocolRegistration.dispose();
      // 進行中的啟動也要收掉；只停 active 會把晚回來的 client 留在行程裡。
      const serverIds = new Set([...active.keys(), ...launches.keys()]);
      await Promise.all([...serverIds].map((serverId) => stopServer(serverId)));
      pendingAdds.clear();
    },
  };
}

function resolveRegistry(
  context: ModuleActivationContext,
  options: McpModuleOptions,
  layout: FolderLayout,
): FileRegistry | null {
  if (options.registry !== undefined) {
    return options.registry;
  }
  const cabinet = context.services.host.get<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  if (cabinet === undefined) {
    return null;
  }
  return new FileRegistry(
    cabinet.state,
    layout,
    options.now === undefined ? {} : { now: options.now },
  );
}

/**
 * 核准綁定優先使用呼叫端提供的實例；沒有時從 `cardStorage` 取狀態庫建立。
 * 兩者都拿不到就回 `null`，啟動時一律不信任任何紀錄。
 */
function resolveBindings(
  context: ModuleActivationContext,
  options: McpModuleOptions,
): McpServerApprovalStore | null {
  if (options.bindings !== undefined) {
    return options.bindings;
  }
  const cabinet = context.services.host.get<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  if (cabinet === undefined) {
    return null;
  }
  return new McpServerApprovalStore(
    cabinet.state,
    options.now === undefined ? {} : { now: options.now },
  );
}

/**
 * 啟動後重新讀到的設定是否仍是當初連線的那一筆。連線參數只要有一項不同，
 * 這條連線就不能沿用；名稱之類不影響連線的欄位不列入。
 */
function sameConnection(started: McpServerRecord, current: McpServerRecord): boolean {
  return (
    started.serverId === current.serverId &&
    started.transport === current.transport &&
    started.command === current.command &&
    started.url === current.url &&
    sameList(started.args ?? [], current.args ?? []) &&
    sameList(started.allowedHosts, current.allowedHosts)
  );
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function describeTarget(input: McpServerInput): { label: string; value: string }[] {
  const target =
    input.transport === "stdio"
      ? [input.command ?? "", ...(input.args ?? [])].join(" ")
      : (input.url ?? "");
  return [
    { label: "名稱", value: input.name },
    { label: "傳輸", value: input.transport },
    { label: "目標", value: target || "（未設定）" },
    {
      label: "允許網域",
      value: input.allowedHosts.length === 0 ? "（無）" : input.allowedHosts.join(", "),
    },
  ];
}

/**
 * 等一個 promise 但有上界。 `client.close()` 正常會讓 `launch.task` 立刻結束，
 * 這個上界只是防止移除／停用／關閉被不聽話的連線永遠拖住。
 * 計時器 unref，避免它自己把測試行程留著。
 */
function settleWithin(task: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref();
  });
  return Promise.race([task, bound]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

/** 停止時等待啟動工作收斂的上界；正常路徑靠 close() 的中止即時完成。 */
const STOP_WAIT_MS = 500;

function describeError(error: unknown): string {
  if (error instanceof McpClientError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof McpConfigError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 實際載入時由模組主機建立；同一行程只會啟用一次。 */
let activeHandle: McpModuleHandle | null = null;

export const hostModule: HostModule = {
  manifest,
  async activate(context) {
    activeHandle = await activateMcpModule(context);
  },
  async deactivate() {
    const handle = activeHandle;
    activeHandle = null;
    await handle?.dispose();
  },
};
