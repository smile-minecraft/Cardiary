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
import type { ToolBundleDraft } from "@cardiary/engine-adapter";
import { McpConfigError, type McpServerInput, type McpServerRecord } from "@cardiary/domain";
import type {
  HostModule,
  ModuleActivationContext,
  ProtocolRegistrationHandle,
} from "@cardiary/module-api";
import type { McpServerInfo } from "@cardiary/protocol";
import { FolderLayout, McpServerStore } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";
import type { HostEngine } from "../../engine/types.js";
import type { SpawnRegistry } from "../../spawn/wrapper.js";
import { createMcpClient, McpClientError, type McpClientFactory } from "./client.js";
import { manifest } from "./manifest.js";
import { registerMcpProtocol, toServerInfo, type McpController } from "./protocol.js";
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
  readonly now?: () => Date;
}

/** 已啟動伺服器的執行狀態與工具組註冊。 */
interface ActiveServer {
  runtime: McpServerRuntime;
  registration: ProtocolRegistrationHandle;
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

  const active = new Map<string, ActiveServer>();
  const failures = new Map<string, string>();
  const starting = new Map<string, Promise<void>>();
  const pendingAdds = new Map<string, Promise<void>>();
  let disposed = false;

  const clientContext = {
    folderRoot,
    spawn,
    logger,
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
  };

  const registerBundle = (runtime: McpServerRuntime): ProtocolRegistrationHandle => {
    const draft: ToolBundleDraft = buildBundleDraft(runtime);
    const registration = context.registerToolBundle(draft);
    active.set(runtime.record.serverId, { runtime, registration });
    return registration;
  };

  const reportFailure = (serverId: string, message: string): void => {
    failures.set(serverId, message);
    logger.warn("MCP 伺服器啟動失敗", { serverId, message });
  };

  const startServer = async (record: McpServerRecord): Promise<void> => {
    if (disposed || !record.enabled || active.has(record.serverId)) {
      return;
    }
    const existing = starting.get(record.serverId);
    if (existing !== undefined) {
      return existing;
    }
    const task = (async () => {
      const client = clientFactory(record, clientContext);
      try {
        // 先做一次 tools/list：連不上、協定不合或網域被擋都在這裡失敗。
        // 失敗時不註冊工具，模型看不到一個永遠壞掉的伺服器。
        const tools = await client.listTools();
        if (disposed) {
          await client.close();
          return;
        }
        const runtime: McpServerRuntime = {
          record,
          client,
          refresh: () => {
            if (!disposed && active.get(record.serverId)?.runtime === runtime) {
              // 同一個 bundleId+generation 重新註冊會換掉引擎裡的定義。
              // 不要先 dispose 舊手把：retire 以 bundleId+generation 為鍵，
              // 會把剛換上的新定義一起退掉。
              registerBundle(runtime);
            }
          },
          state: "ready",
          // 啟動時的 tools/list 只用來確認連線；工具定義要等模型呼叫
          // list_tools 之後才註冊，讓對話開場只看到兩個入口工具。
          tools: null,
        };
        registerBundle(runtime);
        failures.delete(record.serverId);
        logger.info("MCP 伺服器已啟動", {
          serverId: record.serverId,
          tools: tools.length,
        });
      } catch (error) {
        await client.close().catch(() => undefined);
        reportFailure(record.serverId, describeError(error));
      } finally {
        starting.delete(record.serverId);
      }
    })();
    starting.set(record.serverId, task);
    return task;
  };

  const stopServer = async (serverId: string): Promise<void> => {
    const entry = active.get(serverId);
    if (entry === undefined) {
      return;
    }
    active.delete(serverId);
    entry.registration.dispose();
    await entry.runtime.client.close().catch(() => undefined);
  };

  const startAll = (): void => {
    void (async () => {
      const records = await store.list();
      for (const record of records) {
        if (record.enabled) {
          await startServer(record);
        }
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
      protocol.emit({
        kind: "notification",
        title: "MCP 伺服器已新增",
        body: `「${record.name}」已核准；工具會在對話第一次載入時出現。`,
        level: "info",
      });
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
      await stopServer(serverId);
      failures.delete(serverId);
      const removed = await store.remove(serverId);
      if (!removed) {
        throw new ProtocolHandlerError("not_found", `找不到 MCP 伺服器：${serverId}`);
      }
      return true;
    },

    async setEnabled(serverId: string, enabled: boolean): Promise<McpServerInfo> {
      const record = await store.setEnabled(serverId, enabled);
      if (enabled) {
        await startServer(record);
      } else {
        await stopServer(serverId);
        failures.delete(serverId);
      }
      return serverInfo(record.serverId);
    },

    async setAllowedHosts(
      serverId: string,
      allowedHosts: readonly string[],
    ): Promise<McpServerInfo> {
      const record = await store.setAllowedHosts(serverId, allowedHosts);
      if (record.enabled && record.transport === "http") {
        // 網域白名單改變後重新連線；舊連線不能沿用先前的判斷。
        await stopServer(serverId);
        await startServer(record);
      }
      return serverInfo(record.serverId);
    },
  };

  const protocolRegistration = registerMcpProtocol(protocol, controller);

  startAll();

  return {
    controller,
    async settled(): Promise<void> {
      while (starting.size > 0 || pendingAdds.size > 0) {
        await Promise.all([...starting.values(), ...pendingAdds.values()]);
      }
    },
    async dispose(): Promise<void> {
      disposed = true;
      protocolRegistration.dispose();
      for (const [serverId] of [...active]) {
        await stopServer(serverId);
      }
      starting.clear();
      pendingAdds.clear();
    },
  };
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
