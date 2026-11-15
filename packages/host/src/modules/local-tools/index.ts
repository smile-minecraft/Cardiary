import type {
  HostModule,
  ModuleActivationContext,
  ModuleLogger,
  RegistrationHandle,
} from "@cardiary/module-api";
import type { ToolBundleDraft } from "@cardiary/engine-adapter";
import { FileRegistry } from "@cardiary/storage";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { HostEngine } from "../../engine/types.js";
import { ApprovalAllowlistStore } from "../../permissions/allowlist.js";
import { PermissionDecisionService } from "../../permissions/decisions.js";
import {
  createToolPermissionGate,
  type ToolPermissionGateOptions,
} from "../../permissions/gate.js";
import { createCommandSandbox } from "../../permissions/sandbox.js";
import { manifest } from "./manifest.js";
import {
  DEFAULT_OUTPUT_LIMITS,
  TurnOverflowTracker,
  type OverflowRegistry,
  type ToolOutputLimits,
} from "./output.js";
import {
  DEFAULT_LOCAL_TOOLS_LIMITS,
  localToolDefinitions,
  type LocalToolsEnvironment,
} from "./tools.js";

/** 工具組的識別碼；同一個模組的版本共用。 */
export const LOCAL_TOOLS_BUNDLE_ID = "local-tools";

/**
 * 這個模組讀寫的主機服務名稱。
 *
 * 權限閘道用主機契約裡的正式名稱（`HOST_SERVICE_NAMES.toolPermissionGate`），
 * 組合根在引擎的權限回呼裡才取；白名單與檔案登記簿可以另外提供，沒有時
 * 從卡片儲存（`cardStorage`）的狀態庫與資料夾建立。
 */
export const LOCAL_TOOLS_SERVICES = {
  allowlist: "permissions.allowlist",
  fileRegistry: "storage.registry",
  permissionGate: HOST_SERVICE_NAMES.toolPermissionGate,
  /** 人類按下「一律允許」的決定入口；由審批介面接上，代理碰不到。 */
  permissionDecision: "permission.decision",
} as const;

export interface LocalToolsModuleOptions {
  /** 工作目錄；模組啟用時會 realpath，權限閘道與工具用同一個值。 */
  readonly workingDir: string;
  /** Cardiary 資料夾；模組啟用時會 realpath。 */
  readonly folderRoot: string;
  /** 白名單；沒有時依序找主機服務與卡片儲存。 */
  readonly allowlist?: ApprovalAllowlistStore | null;
  /** 檔案登記簿；沒有時依序找主機服務與卡片儲存。 */
  readonly registry?: OverflowRegistry | null;
  readonly limits?: Partial<ToolOutputLimits>;
  readonly commandTimeoutMs?: number;
  readonly maxReadBytes?: number;
  readonly maxListEntries?: number;
  readonly homeDir?: string;
  readonly appBundlePath?: string;
  readonly now?: () => Date;
  readonly logger?: Pick<ModuleLogger, "warn">;
}

/** 一次啟用建立的東西；停用時用來清掉還沒結束的暫存檔。 */
export interface ActivatedLocalTools {
  readonly handles: readonly RegistrationHandle[];
  readonly tracker: TurnOverflowTracker;
  readonly registry: OverflowRegistry | null;
}

/**
 * 一個模組執行個體。
 *
 * 註冊 handle 的銷毀責任在主機（`ModuleActivationContext` 的契約）：停用與
 * 重載時由載入器呼叫每個 handle 的 `dispose` 一次。模組的 `deactivate`
 * 只清自己的暫存檔，不碰 handle。
 */
function createModuleInstance(
  optionsFor: (context: ModuleActivationContext) => LocalToolsModuleOptions,
): HostModule {
  let active: ActivatedLocalTools | null = null;
  return {
    manifest,
    async activate(context: ModuleActivationContext): Promise<void> {
      active = activateLocalTools(context, optionsFor(context));
    },
    async deactivate(): Promise<void> {
      const current = active;
      active = null;
      current?.tracker.cleanupAll(current.registry);
    },
  };
}

/** 建立一個可啟用的模組；測試與組合根各拿一份，不共用狀態。 */
export function createLocalToolsModule(options: LocalToolsModuleOptions): HostModule {
  return createModuleInstance(() => options);
}

/** 註冊工具組與回合結束的暫存清除；回傳這次啟用建立的狀態。 */
export function activateLocalTools(
  context: ModuleActivationContext,
  options: LocalToolsModuleOptions,
  tracker: TurnOverflowTracker = new TurnOverflowTracker(),
): ActivatedLocalTools {
  const limits: ToolOutputLimits = { ...DEFAULT_OUTPUT_LIMITS, ...options.limits };
  const now = options.now ?? (() => new Date());
  // 權限判斷與路徑比較都要求 realpath 的根；主機傳進來的資料夾路徑可能
  // 走過符號連結（macOS 的 /var 就是），所以在這裡統一成正規形式。
  const workingDir = canonicalPath(options.workingDir);
  const folderRoot = canonicalPath(options.folderRoot);
  const cardStorage = context.services.host.get<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const registry = resolveFileRegistry(context, options, cardStorage, now);
  const allowlist = resolveAllowlist(context, options, cardStorage);
  // 作業系統沙盒在啟用時建立一次；不可用時 run_command 一律失敗（fail closed）。
  const sandbox = createCommandSandbox({
    workingDir,
    folderRoot,
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.appBundlePath === undefined ? {} : { appBundlePath: options.appBundlePath }),
  });
  if (sandbox === null) {
    options.logger?.warn("作業系統沙盒不可用；run_command 會拒絕執行", {
      moduleId: manifest.id,
    });
  }
  const environment: LocalToolsEnvironment = {
    workingDir,
    folderRoot,
    limits,
    spill: {
      registry,
      now,
      onSpill: ({ turnId, callId, tempDir }) => tracker.track(turnId, callId, tempDir),
    },
    commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_LOCAL_TOOLS_LIMITS.commandTimeoutMs,
    maxReadBytes: options.maxReadBytes ?? DEFAULT_LOCAL_TOOLS_LIMITS.maxReadBytes,
    maxListEntries: options.maxListEntries ?? DEFAULT_LOCAL_TOOLS_LIMITS.maxListEntries,
    sandbox,
  };

  const draft: ToolBundleDraft = {
    bundleId: LOCAL_TOOLS_BUNDLE_ID,
    label: "本機檔案與終端機",
    tools: localToolDefinitions(environment),
  };
  const handles: RegistrationHandle[] = [context.registerToolBundle(draft)];
  handles.push(
    context.registerHook({
      point: "after-turn",
      handler: (input) => {
        tracker.cleanup(input.turnId, registry);
      },
    }),
  );

  if (allowlist !== null) {
    const gateOptions: ToolPermissionGateOptions = {
      workingDir,
      folderRoot,
      allowlist,
      ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
      ...(options.appBundlePath === undefined ? {} : { appBundlePath: options.appBundlePath }),
    };
    context.services.host.provide(
      LOCAL_TOOLS_SERVICES.permissionGate,
      createToolPermissionGate(gateOptions),
    );
    const engine = context.services.host.get<HostEngine>(HOST_SERVICE_NAMES.engine);
    if (engine !== undefined) {
      context.services.host.provide(
        LOCAL_TOOLS_SERVICES.permissionDecision,
        new PermissionDecisionService({ approvals: engine.approvals, allowlist, now }),
      );
    }
  } else {
    options.logger?.warn("沒有白名單服務；本機檔案與終端機不提供硬規則閘道", {
      moduleId: manifest.id,
    });
  }
  return { handles, tracker, registry };
}

/** realpath 一個既有的路徑；失敗時退回詞法上的絕對路徑。 */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function resolveAllowlist(
  context: ModuleActivationContext,
  options: LocalToolsModuleOptions,
  cardStorage: CardEnvironment | undefined,
): ApprovalAllowlistStore | null {
  if (options.allowlist !== undefined) {
    return options.allowlist;
  }
  const provided = context.services.host.get<ApprovalAllowlistStore>(
    LOCAL_TOOLS_SERVICES.allowlist,
  );
  if (provided !== undefined) {
    return provided;
  }
  return cardStorage === undefined ? null : new ApprovalAllowlistStore(cardStorage.state);
}

function resolveFileRegistry(
  context: ModuleActivationContext,
  options: LocalToolsModuleOptions,
  cardStorage: CardEnvironment | undefined,
  now: () => Date,
): OverflowRegistry | null {
  if (options.registry !== undefined) {
    return options.registry;
  }
  const provided = context.services.host.get<OverflowRegistry>(LOCAL_TOOLS_SERVICES.fileRegistry);
  if (provided !== undefined) {
    return provided;
  }
  if (cardStorage === undefined) {
    return null;
  }
  const registry = new FileRegistry(cardStorage.state, cardStorage.layout, { now });
  return registry;
}

/**
 * 模組載入器匯入的進入點。
 *
 * 工作目錄用 `paths.root`（M1 的預設工作目錄就是 Cardiary 資料夾）；白名單與
 * 檔案登記簿由主機服務提供，沒有時從卡片儲存的狀態庫建立。
 */
export const hostModule: HostModule = createModuleInstance((context) => {
  return {
    workingDir: context.services.paths.root,
    folderRoot: context.services.paths.root,
    logger: context.services.logger,
  };
});
