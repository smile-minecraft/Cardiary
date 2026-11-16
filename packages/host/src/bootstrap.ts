import type {
  Clock,
  EngineLogger,
  EngineModelSource,
  ModelSettings,
  ProviderCredentialSource,
  ProviderCredential,
  CredentialRef,
  ToolBundlePin,
} from "@cardiary/engine-adapter";
import { createEngineAdapter } from "@cardiary/engine-adapter";
import type { JSONObject, JSONValue } from "@cardiary/protocol";
import type {
  BackgroundTaskRunner,
  CardiaryPaths,
  ModelInvoker,
  ModuleLogger,
  ModuleSettingsReader,
  ProtocolEventIntent,
  SecretAccess,
} from "@cardiary/module-api";
import type { ToolPermissionGate } from "@cardiary/engine-adapter";
import { FolderLayout } from "@cardiary/storage";
import { join } from "node:path";

import { BrokerCredentialSource, type BrokerClient } from "./control/broker.js";
import { m0PermissionGate } from "./engine/permission.js";
import type { HostEngine } from "./engine/types.js";
import { FakeEngine, type FakeModelStep } from "@cardiary/engine-fake";
import type { GatewayLimits } from "./gateway/limits.js";
import { Gateway } from "./gateway/server.js";
import { StoredConversationTitles } from "./gateway/titles.js";
import { systemClock } from "./ids.js";
import { SilentLogger } from "./logging.js";
import { HostService } from "./service.js";
import {
  HOST_SERVICE_NAMES,
  type CardEnvironment,
  type ModuleRuntimeServices,
} from "./modules/contract.js";
import {
  SettingsModuleEnablementSettings,
  loadFirstPartyModules,
  type LoadedModules,
  type ModuleEnablementSettings,
} from "./modules/loader.js";
import { HostServiceRegistryImpl } from "./modules/registry.js";
import {
  EphemeralCardEnvironment,
  persistentCardEnvironment,
} from "./modules/cards/environment.js";
import { SpawnRegistry } from "./spawn/wrapper.js";
import { SettingsService } from "./settings/service.js";
import { TransactionalSettingsStore } from "./settings/store.js";
import { settingLevel } from "./settings/catalog.js";
import { readFolderIdentity } from "./storage/folder.js";
import type { StorageBundle } from "./storage/interfaces.js";
import {
  MemoryApprovalLedger,
  MemoryDeletionIntents,
  MemoryEventLog,
  MemoryRequestDedupe,
  MemoryRuntimeState,
  MemoryTurnIndex,
  StorageFailure,
} from "./storage/memory.js";
import { PersistentPurger, PersistentStorage } from "./storage/persistent.js";
import { generateToken } from "./tokens.js";
import { SERVER_VERSION } from "./version.js";

/** 沒有私有通道時的金鑰來源：一律回不可用。 */
export class UnavailableCredentials implements ProviderCredentialSource {
  async resolve(ref: CredentialRef): Promise<ProviderCredential> {
    throw Object.assign(new Error(`沒有可用的憑證來源：${ref}`), {
      code: "model-unavailable",
    });
  }
}

export interface StartHostOptions {
  readonly folderPath: string;
  readonly clientToken: string;
  readonly logger?: EngineLogger;
  readonly clock?: Clock;
  readonly port?: number;
  readonly limits?: Partial<GatewayLimits>;
  /**
   * 引擎與儲存的組裝方式。
   *
   * `pi` 是產品組裝：`@cardiary/storage` 的持久化儲存加上 Pi Durable 轉接層。
   * `fake` 是契約測試與主機單元測試用的替身組裝：記憶體儲存加假引擎。
   * 明確注入 `storage` 或 `engineFactory` 時，這一項只決定引擎的預設值。
   */
  readonly assembly?: "pi" | "fake";
  /** 開發與契約測試用：註冊示範工具並釘選第一代。 */
  readonly demo?: boolean;
  /** 開發與契約測試用：每個回合依序取用的腳本。 */
  readonly scripts?: readonly (readonly FakeModelStep[])[];
  readonly engineFactory?: (input: {
    readonly storage: StorageBundle;
    readonly logger: EngineLogger;
    readonly clock: Clock;
    readonly credentials: ProviderCredentialSource;
    readonly spawn: SpawnRegistry;
  }) => HostEngine;
  /** 殼提供的金鑰來源；省略時一律回報不可用。 */
  readonly credentials?: ProviderCredentialSource;
  /** Pi Durable 的模型來源；正式產品由殼提供，測試用腳本化模型。 */
  readonly models?: EngineModelSource;
  /** 引擎開啟後立刻套用的模型設定；省略時不呼叫 `configureModels`。 */
  readonly modelSettings?: ModelSettings;
  readonly version?: string;
  readonly maintenanceNotifier?: (
    lifecycle: "deleting" | "vacuuming" | "idle",
    operationId: string,
  ) => Promise<void>;
  readonly fatalNotifier?: (reason: "storage_io" | "internal", detail: string) => Promise<void>;
  /** 整合與恢復測試用：預置未完成的刪除意圖。 */
  readonly deletionIntents?: readonly string[];
  /** 診斷與測試用：儲存操作的時間軸。 */
  readonly trace?: (entry: string) => void;
  /** 整合與測試用：直接注入儲存 bundle，略過預設組裝。 */
  readonly storage?: StorageBundle;
  /** 空資料夾時允許初始化（`state/folder.json` 與三個資料庫）。 */
  readonly initializeFolder?: boolean;
  /** 測試故障注入：啟動 N 毫秒後關閉事件日誌，模擬儲存失效。 */
  readonly faultCloseEventLogAfterMs?: number;
  /** 測試故障注入：第一個 request_dedupe complete 不寫入。 */
  readonly faultSkipDedupeComplete?: boolean;
  /** 測試故障注入：啟動 N 毫秒後關閉執行期狀態庫，模擬 shutdown 寫入失敗。 */
  readonly faultCloseRuntimeAfterMs?: number;
  /** 控制面的系統能力代理；省略時不提供 `broker` 服務。 */
  readonly broker?: BrokerClient;
  /** 測試與工具用：模組掃描目錄；省略時是 `dist/modules/`（或原始碼的 `modules/`）。 */
  readonly modulesDirectory?: string;
  /** 測試用：換掉 `modules.disabled` 的來源；省略時接上狀態庫的設定。 */
  readonly moduleEnablement?: ModuleEnablementSettings;
}

export interface RunningHost {
  readonly service: HostService;
  readonly gateway: Gateway;
  readonly engine: HostEngine;
  readonly storage: StorageBundle;
  readonly port: number;
  readonly epoch: string;
  /** 共用子行程註冊表；測試與整合驗證「pause 後沒有工具存活」用。 */
  readonly spawn: SpawnRegistry;
  /** 已載入的第一方模組；`--engine fake` 的原始碼測試通常沒有模組。 */
  readonly modules: LoadedModules;
  /** 模組之間共用的服務註冊表。 */
  readonly hostServices: HostServiceRegistryImpl;
}

const DEMO_BUNDLE_ID = "demo";
const DEMO_GENERATION = 1;

/**
 * 組裝並啟動主機服務。
 *
 * 產品組裝（`assembly: "pi"`）用 `@cardiary/storage` 的持久化儲存與
 * `@cardiary/engine-adapter` 的 Pi Durable 轉接層；契約測試與主機單元測試
 * 用 `assembly: "fake"` 的記憶體儲存與假引擎。兩者共用同一個閘道與生命週期。
 */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  const logger = options.logger ?? new SilentLogger();
  const clock = options.clock ?? systemClock;
  const spawn = new SpawnRegistry();
  const assembly = options.assembly ?? "pi";
  const persistent =
    options.storage === undefined && assembly === "pi"
      ? PersistentStorage.open({
          path: options.folderPath,
          ...(options.initializeFolder === undefined
            ? {}
            : { initialize: options.initializeFolder }),
          now: () => clock.now(),
          ...(options.trace === undefined ? {} : { trace: options.trace }),
        })
      : null;
  const folder =
    options.storage?.folder ?? persistent?.folder ?? (await readFolderIdentity(options.folderPath));
  const trace = options.trace;
  const hostServices = new HostServiceRegistryImpl();
  const paths: CardiaryPaths = {
    root: folder.path,
    cards: join(folder.path, "cards"),
    assets: join(folder.path, "assets"),
    boards: join(folder.path, "boards"),
    skills: join(folder.path, "skills"),
    state: join(folder.path, "state"),
    modules: join(folder.path, "modules"),
    cache: join(folder.path, "cache"),
    tmp: join(folder.path, "tmp"),
    logs: join(folder.path, "logs"),
  };
  // 卡片模組的儲存：產品組裝共用主機已開的連線；記憶體組裝另外開一份。
  const cardEnvironment: CardEnvironment =
    persistent !== null
      ? persistentCardEnvironment(persistent)
      : new EphemeralCardEnvironment(new FolderLayout(folder.path), {
          now: () => clock.now(),
          ...(trace === undefined ? {} : { trace }),
        });
  hostServices.provide(HOST_SERVICE_NAMES.cardStorage, cardEnvironment);
  hostServices.provide(HOST_SERVICE_NAMES.spawn, spawn);
  // 權限閘道在呼叫當下才取：本機工具提供服務之後就生效，不必重啟主機。
  const permissionGate: ToolPermissionGate = {
    evaluate(request) {
      const gate = hostServices.get(HOST_SERVICE_NAMES.toolPermissionGate);
      return gate === undefined ? m0PermissionGate.evaluate(request) : gate.evaluate(request);
    },
  };
  const runtime =
    options.storage?.runtime ??
    persistent?.runtime ??
    new MemoryRuntimeState({
      now: () => clock.now(),
      ...(trace === undefined ? {} : { trace }),
    });
  const snapshot = await runtime.open();
  const events =
    options.storage?.events ??
    persistent?.events ??
    new MemoryEventLog(trace === undefined ? {} : { trace });
  const dedupe = options.storage?.dedupe ?? persistent?.dedupe ?? new MemoryRequestDedupe();
  const approvals =
    options.storage?.approvals ?? persistent?.approvals ?? new MemoryApprovalLedger();
  const turnIndex = options.storage?.turnIndex ?? persistent?.turnIndex ?? new MemoryTurnIndex();
  const deletions =
    options.storage?.deletions ??
    persistent?.deletions ??
    new MemoryDeletionIntents(options.deletionIntents ?? []);
  const storage: StorageBundle = options.storage ?? {
    events,
    runtime,
    dedupe,
    approvals,
    turnIndex,
    deletions,
    folder,
    ...(persistent === null
      ? {}
      : {
          dispose: () => persistent.close(),
          pauseDatabases: () => persistent.pauseDatabases(),
          resumeDatabases: () => persistent.resumeDatabases(),
        }),
  };
  const credentials = options.credentials ?? new UnavailableCredentials();
  const environment = {
    stateDir: join(folder.path, "state"),
    tempDir: join(folder.path, "tmp"),
    defaultWorkingDir: folder.path,
  };
  const engine =
    options.engineFactory?.({ storage, logger, clock, credentials, spawn }) ??
    (assembly === "fake"
      ? new FakeEngine({
          environment,
          approvals,
          permissionGate,
          credentials,
          logger,
          clock,
        })
      : createEngineAdapter({
          environment,
          approvals,
          permissionGate,
          credentials,
          logger,
          clock,
          // 多模態模組啟用後才提供 blobs；模型請求當下才取，避免模組載入順序耦合。
          media: {
            read(assetId) {
              const blobs = hostServices.get<{
                info(blobId: string): { readonly mediaType: string } | undefined;
                read(blobId: string): Uint8Array | undefined;
              }>(HOST_SERVICE_NAMES.blobs);
              if (blobs === undefined) {
                return null;
              }
              const info = blobs.info(assetId);
              const bytes = blobs.read(assetId);
              return info === undefined || bytes === undefined
                ? null
                : { bytes, mediaType: info.mediaType };
            },
          },
          ...(options.models === undefined ? {} : { models: options.models }),
          ...(persistent === null ? {} : { purger: new PersistentPurger(persistent.storage) }),
        }));
  if (options.modelSettings !== undefined) {
    await engine.configureModels(options.modelSettings);
  }
  hostServices.provide(HOST_SERVICE_NAMES.engine, engine);
  hostServices.provide(HOST_SERVICE_NAMES.storage, storage);
  hostServices.provide(HOST_SERVICE_NAMES.paths, paths);
  if (options.broker !== undefined) {
    hostServices.provide(HOST_SERVICE_NAMES.broker, options.broker);
  }
  let serviceRef: HostService | null = null;
  const gateway = new Gateway({
    engine,
    storage,
    ...(persistent === null
      ? {}
      : { titles: new StoredConversationTitles(() => persistent.storage.state) }),
    epoch: snapshot.epoch,
    clientToken: options.clientToken,
    logger,
    clock,
    status: () => {
      if (!serviceRef) {
        return {
          folderState: "verifying",
          displayName: folder.displayName,
          writable: folder.writable,
          serviceState: "degraded",
          version: options.version ?? SERVER_VERSION,
          uptimeSeconds: 0,
          activeTasks: 0,
        };
      }
      return serviceRef.statusInput();
    },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    cancelToolProcesses: (deadlineMs) => spawn.cancelAll(deadlineMs),
    // 「一律允許」由權限模組提供；模組可能在閘道建立後才啟用，所以用取值函式。
    permissionDecision: () => hostServices.get(HOST_SERVICE_NAMES.permissionDecision),
    ...(options.faultSkipDedupeComplete === true ? { faultSkipDedupeComplete: true } : {}),
    ...(options.demo === true
      ? { toolBundles: () => [{ bundleId: DEMO_BUNDLE_ID, generation: DEMO_GENERATION }] }
      : {}),
    systemContext: () => "你是 Cardiary 的助理。回答使用繁體中文。",
  });
  if (options.demo === true) {
    await registerDemoTools(engine, approvals, spawn);
    // 模組事件外殼的示範：module.demo.emit 經模組 API 觸發一個 module.* 事件。
    gateway.registerModuleNamespace("demo", async (payload) => {
      if (payload.action === "emit") {
        const data: JSONObject =
          typeof payload.data === "object" && payload.data !== null && !Array.isArray(payload.data)
            ? (payload.data as JSONObject)
            : { value: payload.value ?? null };
        await gateway.emitModuleEvent({
          type: "module.demo.changed",
          stream: "system",
          data,
        });
        return { emitted: true };
      }
      return { pong: true };
    });
  }
  for (const script of options.scripts ?? []) {
    if (engine instanceof FakeEngine) engine.enqueueScript(script);
  }
  // 背景任務建立對話時需要釘選的工具組；模組載入完成後才有值。
  const loadedModules: { current: { activeToolBundles(): readonly ToolBundlePin[] } | null } = {
    current: null,
  };
  const modules = await loadFirstPartyModules({
    tools: engine.tools,
    services: moduleRuntimeServices({
      hostServices,
      paths,
      folderPath: folder.path,
      cardEnvironment,
      logger,
      clock,
      pinnedToolBundles: () => loadedModules.current?.activeToolBundles() ?? [],
    }),
    events: {
      emit: (intent: ProtocolEventIntent): void => {
        gateway.emitIntent(intent);
      },
    },
    hostServices,
    settings:
      options.moduleEnablement ??
      new SettingsModuleEnablementSettings(() => cardEnvironment.settings),
    ...(options.modulesDirectory === undefined ? {} : { directory: options.modulesDirectory }),
    now: () => clock.now(),
    warn: (message, fields) => {
      logger.warn(message, fields);
    },
  });
  gateway.setModuleHost(modules);
  loadedModules.current = modules;
  const port = await gateway.listen(options.port ?? 0);
  const service = new HostService({
    storage,
    engine,
    gateway,
    clientPort: port,
    spawn,
    clock,
    logger,
    version: options.version ?? SERVER_VERSION,
    startedAt: snapshot.startedAt,
    ...(options.maintenanceNotifier === undefined
      ? {}
      : { onMaintenance: options.maintenanceNotifier }),
    ...(options.fatalNotifier === undefined ? {} : { onFatal: options.fatalNotifier }),
    onShutdown: async () => {
      await modules.deactivateAll("shutdown");
      if (cardEnvironment.ownsConnections) cardEnvironment.close();
    },
  });
  serviceRef = service;
  gateway.setStorageFailureHandler((detail) => {
    void service.failStorage(detail);
  });
  if (options.faultCloseEventLogAfterMs !== undefined) {
    setTimeout(() => {
      void events.close();
    }, options.faultCloseEventLogAfterMs).unref?.();
  }
  if (options.faultCloseRuntimeAfterMs !== undefined) {
    setTimeout(() => {
      void runtime.checkpointAndClose();
    }, options.faultCloseRuntimeAfterMs).unref?.();
  }
  await service.start();
  return {
    service,
    gateway,
    engine,
    storage,
    port,
    epoch: snapshot.epoch,
    spawn,
    modules,
    hostServices,
  };
}

/**
 * 模組共用的執行期服務。
 *
 * `models` 是一個轉呼：呼叫當下才向服務註冊表取真正的 `models`，模型接入
 * 模組提供之後就生效；沒有提供時丟出明確錯誤，不讓模組以為呼叫成功。
 * 背景任務、憑證與模組設定在 M1 只有形狀，實際使用時回明確的錯誤或空值。
 */
function moduleRuntimeServices(input: {
  readonly hostServices: HostServiceRegistryImpl;
  readonly paths: CardiaryPaths;
  readonly folderPath: string;
  readonly cardEnvironment: CardEnvironment;
  readonly logger: EngineLogger;
  readonly clock: Clock;
  /** 模組載入完成的工具組；背景任務建立對話時釘選。 */
  readonly pinnedToolBundles: () => readonly ToolBundlePin[];
}): ModuleRuntimeServices {
  const models: ModelInvoker = {
    async invoke(request, options) {
      const invoker = input.hostServices.get<ModelInvoker>(HOST_SERVICE_NAMES.models);
      if (invoker === undefined) {
        throw new Error("沒有模組提供 models 服務；模型接入尚未啟用。");
      }
      return invoker.invoke(request, options);
    },
  };
  const backgroundTasks: BackgroundTaskRunner = {
    async run(request, runOptions) {
      const engine = input.hostServices.get<HostEngine>(HOST_SERVICE_NAMES.engine);
      if (engine === undefined) {
        throw new Error("背景任務需要 engine 服務；主機還沒啟動引擎。");
      }
      const settings = await engine.getModelSettings();
      const conversation = await engine.createConversation({
        title: request.title,
        purpose: "background-task",
        model: settings.roles.main,
        systemContext: request.systemContext,
        toolBundles: request.toolBundles ?? input.pinnedToolBundles(),
        permissionMode: "hard-rules",
      });
      const conversationId = conversation.id;
      try {
        input.cardEnvironment.state.run(
          "UPDATE conversations SET origin = 'schedule' WHERE conversation_id = ?",
          conversationId,
        );
      } catch {
        // 對話本身已建立；標記來源失敗只影響側欄是否列出，不擋執行。
        input.logger.warn("背景對話標記 origin 失敗", { conversationId });
      }
      const subscription = engine.subscribe({ conversationId });
      const outcome = (async () => {
        let turnId: string | null = null;
        const onAbort = (): void => {
          if (turnId !== null) {
            void engine
              .cancelTurn({ conversationId, turnId, reason: "背景任務被取消" })
              .catch(() => undefined);
          }
        };
        runOptions?.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          for await (const event of subscription.events) {
            if (event.kind === "turn.started" && turnId === null) {
              turnId = event.turnId;
              continue;
            }
            if (event.kind === "turn.completed") {
              subscription.close();
              const summary = await readAssistantSummary(engine, conversationId);
              return {
                conversationId,
                status:
                  event.status === "completed"
                    ? ("completed" as const)
                    : event.status === "failed"
                      ? ("failed" as const)
                      : ("cancelled" as const),
                summary,
              };
            }
          }
          return { conversationId, status: "cancelled" as const, summary: null };
        } finally {
          runOptions?.signal?.removeEventListener("abort", onAbort);
        }
      })();
      try {
        if (engine.sendMessageWithClientId !== undefined) {
          await engine.sendMessageWithClientId({
            conversationId,
            content: [{ type: "text", text: request.prompt }],
            delivery: "queue",
            sender: { kind: "system", component: "background-task" },
            clientMessageId: `background-${conversationId}`,
          });
        } else {
          await engine.sendMessage({
            conversationId,
            content: [{ type: "text", text: request.prompt }],
            delivery: "queue",
            sender: { kind: "system", component: "background-task" },
          });
        }
      } catch (error) {
        subscription.close();
        throw error;
      }
      return outcome;
    },
  };
  let settingsService: SettingsService | undefined;
  const service = (): SettingsService => {
    settingsService ??= new SettingsService(
      new TransactionalSettingsStore(input.cardEnvironment.state, input.cardEnvironment.settings),
    );
    return settingsService;
  };
  const settings: ModuleSettingsReader = {
    get: (key) => service().get(key),
    getLevel: (key) => settingLevel(key, service().record(key)?.level ?? "human-only"),
    onChange: (listener) =>
      service().onChange((change) => {
        const actor = change.changedBy;
        listener({
          key: change.item.key,
          previousValue: change.previous,
          nextValue: change.item.value,
          level: change.item.level,
          changedBy: actor.startsWith("user:")
            ? { kind: "human", clientId: actor.slice(5) }
            : actor.startsWith("agent:")
              ? { kind: "agent", agentId: actor.slice(6) }
              : { kind: "system", component: actor },
          changedAt: change.changedAt,
        });
      }),
  };
  const secrets: SecretAccess = {
    async withSecret() {
      throw new Error("M1 沒有提供憑證服務。");
    },
  };
  const logger: ModuleLogger = input.logger;
  return {
    models,
    backgroundTasks,
    storage: {
      dataDir: join(input.folderPath, "modules"),
      cacheDir: join(input.folderPath, "cache"),
      tempDir: join(input.folderPath, "tmp"),
    },
    paths: input.paths,
    settings,
    secrets,
    logger,
    clock: input.clock,
  };
}

/** 讀回助理最後一則文字訊息的純文字部分；沒有就回 `null`。 */
async function readAssistantSummary(
  engine: HostEngine,
  conversationId: string,
): Promise<string | null> {
  try {
    const page = await engine.readConversationHistory({ conversationId, limit: 10 });
    for (let index = page.messages.length - 1; index >= 0; index -= 1) {
      const message = page.messages[index];
      if (message?.role !== "assistant") continue;
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { readonly text: string }).text)
        .join("\n")
        .trim();
      return text.length === 0 ? null : text;
    }
    return null;
  } catch {
    return null;
  }
}

/** 示範工具：讓契約測試能走完審批、串流與介面資料，不需要真模型。 */
export async function registerDemoTools(
  engine: HostEngine,
  approvals: import("@cardiary/engine-adapter").ApprovalLedger,
  spawn: SpawnRegistry,
): Promise<void> {
  void approvals;
  await engine.tools.register({
    bundleId: DEMO_BUNDLE_ID,
    label: "示範工具",
    generation: DEMO_GENERATION,
    tools: [
      {
        name: "demo.echo",
        description: "回傳輸入的文字；用來測試審批與工具結果。",
        parameters: { type: "object" },
        replay: "safe",
        async execute(input) {
          const text =
            typeof input === "object" && input !== null && "text" in input
              ? String((input as { text?: unknown }).text ?? "")
              : JSON.stringify(input);
          return {
            ok: true,
            content: [{ type: "text", text }],
            metadata: { renderer: "demo.echo", data: { echoed: true } },
          };
        },
      },
      {
        name: "demo.sleep",
        description: "等待指定毫秒；用來測試暫停時工具被取消。",
        parameters: { type: "object" },
        replay: "unsafe",
        async execute(input, context) {
          const ms =
            typeof input === "object" && input !== null && "ms" in input
              ? Number((input as { ms?: unknown }).ms)
              : 1000;
          const aborted = await waitFor(ms, context.signal);
          if (aborted) {
            return {
              ok: false,
              message: "工具被取消",
              diagnostics: [{ code: "paused" }],
            };
          }
          return { ok: true, content: [{ type: "text", text: `睡了 ${ms} 毫秒` }] };
        },
      },
      {
        name: "demo.card",
        description: "回傳一張工具結果卡。",
        parameters: { type: "object" },
        replay: "safe",
        async execute(input) {
          return {
            ok: true,
            content: [
              {
                type: "card",
                card: {
                  cardKind: "demo",
                  cardId: null,
                  title: "示範卡片",
                  payload: { input } as unknown as JSONValue,
                },
              },
            ],
          };
        },
      },
      {
        name: "demo.exec",
        description: "執行一個短指令；子行程經共用 spawn wrapper，用來測試 process group。",
        parameters: { type: "object" },
        replay: "unsafe",
        async execute(input, context) {
          const seconds =
            typeof input === "object" && input !== null && "seconds" in input
              ? Number((input as { seconds?: unknown }).seconds)
              : 2;
          const child = spawn.spawn({
            command: "/bin/sh",
            args: ["-c", `sleep ${seconds}`],
            stdio: ["ignore", "pipe", "pipe"],
            ...(context.tempDir ? { cwd: context.tempDir } : {}),
          });
          const aborted = await Promise.race([
            child.exited.then(() => false),
            waitFor(seconds * 1000 + 500, context.signal),
          ]);
          if (aborted) {
            child.signal("SIGTERM");
            return {
              ok: false,
              message: "工具被取消",
              diagnostics: [{ code: "interrupted" }],
            };
          }
          return { ok: true, content: [{ type: "text", text: "指令完成" }] };
        },
      },
    ],
  });
}

function waitFor(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export { BrokerCredentialSource, StorageFailure, generateToken };
