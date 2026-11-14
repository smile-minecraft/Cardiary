import type {
  Clock,
  EngineLogger,
  ProviderCredentialSource,
  ProviderCredential,
  CredentialRef,
} from "@cardiary/engine-adapter";
import type { JSONValue } from "@cardiary/protocol";
import { join } from "node:path";

import { BrokerCredentialSource } from "./control/broker.js";
import { m0PermissionGate } from "./engine/permission.js";
import type { HostEngine } from "./engine/types.js";
import { FakeEngine, type FakeModelStep } from "@cardiary/engine-fake";
import type { GatewayLimits } from "./gateway/limits.js";
import { Gateway } from "./gateway/server.js";
import { systemClock } from "./ids.js";
import { SilentLogger } from "./logging.js";
import { HostService } from "./service.js";
import { SpawnRegistry } from "./spawn/wrapper.js";
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
import { generateToken } from "./tokens.js";
import { SERVER_VERSION } from "./version.js";

/** 沒有私有通道時的金鑰來源：一律回不可用。 */
class UnavailableCredentials implements ProviderCredentialSource {
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
}

const DEMO_BUNDLE_ID = "demo";
const DEMO_GENERATION = 1;

/**
 * 組裝並啟動主機服務：資料夾身分（只讀）、記憶體儲存替身、假引擎、
 * 協定閘道與生命週期。
 *
 * 正式版本會由 `@cardiary/storage` 提供持久化實作、由引擎轉接層工作提供
 * `HostEngine`；這個函式是兩者的接縫。
 */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  const logger = options.logger ?? new SilentLogger();
  const clock = options.clock ?? systemClock;
  const spawn = new SpawnRegistry();
  const folder = await readFolderIdentity(options.folderPath);
  const trace = options.trace;
  const runtime = new MemoryRuntimeState({
    now: () => clock.now(),
    ...(trace === undefined ? {} : { trace }),
  });
  const snapshot = await runtime.open();
  const events = new MemoryEventLog(trace === undefined ? {} : { trace });
  const dedupe = new MemoryRequestDedupe();
  const approvals = new MemoryApprovalLedger();
  const turnIndex = new MemoryTurnIndex();
  const deletions = new MemoryDeletionIntents(options.deletionIntents ?? []);
  const storage: StorageBundle = {
    events,
    runtime,
    dedupe,
    approvals,
    turnIndex,
    deletions,
    folder,
  };
  const credentials = new UnavailableCredentials();
  const environment = {
    stateDir: join(folder.path, "state"),
    tempDir: join(folder.path, "tmp"),
    defaultWorkingDir: folder.path,
  };
  const engine =
    options.engineFactory?.({ storage, logger, clock, credentials, spawn }) ??
    new FakeEngine({
      environment,
      approvals,
      permissionGate: m0PermissionGate,
      credentials,
      logger,
      clock,
    });
  let serviceRef: HostService | null = null;
  const gateway = new Gateway({
    engine,
    storage,
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
    ...(options.demo === true
      ? { toolBundles: () => [{ bundleId: DEMO_BUNDLE_ID, generation: DEMO_GENERATION }] }
      : {}),
    systemContext: () => "你是 Cardiary 的助理。回答使用繁體中文。",
  });
  if (options.demo === true) {
    await registerDemoTools(engine, approvals, spawn);
  }
  for (const script of options.scripts ?? []) {
    if (engine instanceof FakeEngine) engine.enqueueScript(script);
  }
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
  });
  serviceRef = service;
  await service.start();
  return { service, gateway, engine, storage, port, epoch: snapshot.epoch, spawn };
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
