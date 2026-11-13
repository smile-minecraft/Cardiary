import type { ConversationId, ToolBundleDraft } from "@cardiary/engine-adapter";
import type {
  ContextSectionContribution,
  HookDeclaration,
  ScheduleDeclaration,
} from "./contributions.js";
import type { ModuleManifest } from "./manifest.js";
import type { ModuleServices } from "./services.js";

/** 模組生命週期的狀態。 */
export type ModuleLifecycleState = "loaded" | "active" | "inactive" | "failed";

/** 每次啟用或重載配發的版本號；工具組與對話釘選用它分辨新舊。 */
export type ModuleGeneration = number;

/** 模組的身分。 */
export interface ModuleIdentity {
  readonly id: string;
  readonly version: string;
  readonly generation: ModuleGeneration;
}

/** 載入或啟用失敗的原因。 */
export interface ModuleFailure {
  readonly message: string;
  readonly at: string;
}

/** 模組主機對一個模組的紀錄。 */
export interface ModuleRecord {
  readonly identity: ModuleIdentity;
  readonly state: ModuleLifecycleState;
  readonly failure: ModuleFailure | null;
}

/** 註冊結果；停用或重載時由主機呼叫 `dispose` 撤銷。 */
export interface RegistrationHandle {
  readonly registrationId: string;
  dispose(): Promise<void>;
}

/**
 * 模組啟用時取得的介面。
 *
 * 註冊的貢獻都掛在這個模組的 generation 底下；重載時舊的
 * 註冊全部撤銷，新的工具組版本給新對話使用，進行中的對話
 * 由主機預告，下一次壓縮才換。
 */
export interface ModuleActivationContext {
  readonly identity: ModuleIdentity;
  readonly services: ModuleServices;
  registerToolBundle(draft: ToolBundleDraft): RegistrationHandle;
  registerContextSection(section: ContextSectionContribution): RegistrationHandle;
  registerHook(hook: HookDeclaration): RegistrationHandle;
  registerSchedule(schedule: ScheduleDeclaration): RegistrationHandle;
}

/** 停用時的原因；模組據此決定要不要等待進行中的工作。 */
export interface ModuleDeactivationContext {
  readonly reason: "user" | "dependency" | "reload" | "shutdown" | "failure";
}

/** 一個模組的進入點；第一方模組以 TypeScript 實作。 */
export interface HostModule {
  readonly manifest: ModuleManifest;
  activate(context: ModuleActivationContext): Promise<void> | void;
  deactivate?(context: ModuleDeactivationContext): Promise<void> | void;
}

/** 停用選項。 */
export interface ModuleDeactivateOptions {
  readonly reason?: "user" | "dependency" | "shutdown" | "reload";
  /** 同時停用相依於它的模組；省略時遇到使用中的相依模組就失敗。 */
  readonly cascade?: boolean;
}

/** 模組變更對對話生效的時機；由熱重載規則固定。 */
export interface ModuleApplyTiming {
  readonly newConversations: "immediate";
  readonly activeConversations: "next-compaction";
}

/** 重載結果。 */
export interface ModuleReloadResult {
  readonly identity: ModuleIdentity;
  readonly previousGeneration: ModuleGeneration;
  readonly timing: ModuleApplyTiming;
  /** 已預告變更、等待下次壓縮的對話。 */
  readonly stagedConversationIds: readonly ConversationId[];
}

/**
 * 模組生命週期管理；由主機服務實作。
 *
 * 停用或解除安裝都不刪除模組資料；重新啟用後恢復。載入只檢查描述檔
 * 與相依性，啟用才會呼叫模組的 `activate` 並註冊貢獻。
 */
export interface ModuleHost {
  load(module: HostModule): Promise<ModuleRecord>;
  /** 解除安裝程式；必須先停用，資料保留。 */
  unload(moduleId: string): Promise<void>;
  activate(moduleId: string): Promise<ModuleRecord>;
  deactivate(moduleId: string, options?: ModuleDeactivateOptions): Promise<ModuleRecord>;
  /** 以新版本重載；省略 `next` 時重新啟用目前版本。 */
  reload(moduleId: string, next?: HostModule): Promise<ModuleReloadResult>;
  list(): readonly ModuleRecord[];
}

/** 生命週期操作失敗的錯誤碼。 */
export type ModuleLifecycleErrorCode =
  | "not-found"
  | "invalid-manifest"
  | "host-api-incompatible"
  | "dependency-missing"
  | "dependency-active"
  | "already-active"
  | "not-active"
  | "activation-failed";

/** 生命週期操作失敗時拋出的錯誤形狀。 */
export interface ModuleLifecycleError extends Error {
  readonly code: ModuleLifecycleErrorCode;
  readonly moduleId: string;
}
