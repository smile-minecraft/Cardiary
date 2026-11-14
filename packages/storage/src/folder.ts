import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import type { FolderState as ProtocolFolderState, ServiceState } from "@cardiary/protocol";

import { StorageError } from "./errors.js";
import {
  FOLDER_FORMAT_VERSION,
  folderIdentityPath,
  readFolderIdentity,
  writeFolderIdentity,
  type FolderIdentity,
} from "./identity.js";
import { newUlid } from "./ids.js";
import { readFileNoFollow } from "./paths.js";
import {
  RECREATABLE_SUBFOLDERS,
  SUBFOLDERS,
  ensureSubfolders,
  isEffectivelyEmpty,
  type FolderLayout,
} from "./paths.js";
import { nowIso } from "./util.js";

/** 服務內部的八個資料夾狀態；不對外直接呈現。 */
export type FolderState =
  | "unselected"
  | "verifying"
  | "ready"
  | "paused"
  | "unavailable"
  | "mismatch"
  | "migrating"
  | "migration-failed";

export type FolderReason =
  | "missing"
  | "not_writable"
  | "not_initialized"
  | "not_empty"
  | "invalid_identity"
  | "mismatch"
  | "folder_mismatch"
  | "format_newer"
  | "structure_missing"
  | "state_missing"
  | "already_running"
  | "io_error"
  | "paused"
  | "unmounting"
  | "verifying"
  | "migrating"
  | "migration_failed";

export interface StorageWarning {
  readonly code: "non-apfs-filesystem";
  readonly message: string;
}

/** 5.2 的狀態轉換；不在表上的轉換直接拒絕。 */
const ALLOWED_TRANSITIONS: Readonly<Record<FolderState, readonly FolderState[]>> = {
  unselected: ["verifying"],
  verifying: ["ready", "unavailable", "mismatch", "migration-failed"],
  ready: ["paused", "unavailable", "migrating", "migration-failed"],
  paused: ["verifying", "ready", "mismatch", "unavailable"],
  unavailable: ["verifying"],
  mismatch: ["verifying", "unselected"],
  migrating: ["ready", "migration-failed", "mismatch"],
  "migration-failed": ["verifying", "mismatch"],
};

/** 資料夾狀態機；八態與轉換照 `storage` 第 5.2 節。 */
export class FolderStateMachine {
  #state: FolderState = "unselected";

  get state(): FolderState {
    return this.#state;
  }

  transition(next: FolderState): FolderState {
    if (next === this.#state) {
      return this.#state;
    }
    if (!ALLOWED_TRANSITIONS[this.#state].includes(next)) {
      throw new StorageError(
        "invalid-state-transition",
        `不允許的資料夾狀態轉換：${this.#state} → ${next}`,
        {
          from: this.#state,
          to: next,
        },
      );
    }
    this.#state = next;
    return this.#state;
  }
}

export interface FolderOpenOptions {
  /** 空資料夾且沒有 `folder.json` 時允許初始化。 */
  readonly initialize?: boolean;
  /** 殼記住的 `folderId`；不符就是 mismatch。 */
  readonly expectedFolderId?: string;
  /** 預設 true；同一個資料夾只允許一個服務行程。 */
  readonly lock?: boolean;
  /** 初始化時建立兩個資料庫；由儲存層提供。 */
  readonly createDatabases?: (paths: { readonly state: string; readonly engine: string }) => void;
  readonly now?: () => Date;
  readonly createdBy?: string;
}

export interface FolderOpenResult {
  readonly state: FolderState;
  readonly reason: FolderReason | null;
  readonly folderId: string | null;
  readonly initialized: boolean;
  readonly warnings: readonly StorageWarning[];
}

export type FolderNotification =
  { readonly type: "pause"; readonly reason: "missing" | "io_error" } | { readonly type: "resume" };

interface ServiceLock {
  release(): void;
}

interface LockFileContent {
  readonly pid: number;
  readonly startedAt: string;
  readonly host: string;
}

/**
 * 資料夾的驗證、初始化、鎖檔與執行中的可用性監控。
 *
 * **絕不建立根資料夾**：根路徑不存在時只回 `unavailable`。
 */
export class FolderManager {
  readonly #layout: FolderLayout;
  readonly #machine = new FolderStateMachine();
  #folderId: string | null = null;
  #lock: ServiceLock | null = null;
  #reason: FolderReason | null = null;
  #now: () => Date = () => new Date();
  #options: FolderOpenOptions = {};

  constructor(layout: FolderLayout) {
    this.#layout = layout;
  }

  get state(): FolderState {
    return this.#machine.state;
  }

  get reason(): FolderReason | null {
    return this.#reason;
  }

  get folderId(): string | null {
    return this.#folderId;
  }

  get layout(): FolderLayout {
    return this.#layout;
  }

  get displayName(): string {
    return this.#layout.displayName;
  }

  /** 驗證或初始化資料夾；回傳結果不丟錯，讓呼叫端顯示對應畫面。 */
  open(options: FolderOpenOptions = {}): FolderOpenResult {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
    this.#machine.transition("verifying");
    this.#reason = null;

    if (!this.#layout.exists) {
      return this.fail("unavailable", "missing");
    }
    try {
      accessSync(this.#layout.root, constants.W_OK);
    } catch {
      return this.fail("unavailable", "not_writable");
    }

    const identityRead = readFolderIdentity(this.#layout);
    if (identityRead.kind === "invalid") {
      return this.fail("mismatch", "invalid_identity");
    }

    let initialized = false;
    if (identityRead.kind === "missing") {
      if (options.initialize !== true) {
        return this.fail("mismatch", "not_initialized");
      }
      if (!isEffectivelyEmpty(this.#layout.root)) {
        return this.fail("mismatch", "not_empty");
      }
      try {
        ensureSubfolders(this.#layout, SUBFOLDERS);
      } catch {
        return this.fail("mismatch", "structure_missing");
      }
      const lock = this.acquireLock();
      if (lock.kind === "failed") {
        return this.fail("unavailable", lock.reason);
      }
      const identity: FolderIdentity = {
        format: FOLDER_FORMAT_VERSION,
        folderId: newUlid(this.#now().getTime()),
        createdAt: nowIso(this.#now),
        createdBy: options.createdBy ?? "Cardiary 0.1.0",
      };
      try {
        options.createDatabases?.({
          state: this.#layout.absolute("state/cardiary.sqlite"),
          engine: this.#layout.absolute("state/engine.sqlite"),
        });
        // `folder.json` 最後寫：中途失敗時下次可以整個重來。
        writeFolderIdentity(this.#layout, identity);
      } catch (error) {
        this.cleanupFailedInitialization();
        this.releaseLock();
        throw error;
      }
      this.#folderId = identity.folderId;
      initialized = true;
    } else {
      const identity = identityRead.identity;
      if (identity.format > FOLDER_FORMAT_VERSION) {
        return this.fail("mismatch", "format_newer");
      }
      if (
        options.expectedFolderId !== undefined &&
        options.expectedFolderId !== identity.folderId
      ) {
        return this.fail("mismatch", "folder_mismatch");
      }
      if (!this.structureIsValid()) {
        return this.fail("mismatch", this.#reason ?? "structure_missing");
      }
      const lock = this.acquireLock();
      if (lock.kind === "failed") {
        return this.fail("unavailable", lock.reason);
      }
      this.#folderId = identity.folderId;
    }

    try {
      ensureSubfolders(this.#layout, RECREATABLE_SUBFOLDERS);
    } catch (error) {
      this.releaseLock();
      throw error;
    }

    this.#machine.transition("ready");
    return {
      state: "ready",
      reason: null,
      folderId: this.#folderId,
      initialized,
      warnings: this.warnings(),
    };
  }

  /** 非 APFS 只警告，不阻擋。 */
  warnings(): StorageWarning[] {
    if (!this.#layout.exists) {
      return [];
    }
    if (this.#layout.isApfs()) {
      return [];
    }
    return [
      {
        code: "non-apfs-filesystem",
        message: "資料夾不在 APFS 上，資料庫比較容易損毀；建議搬到 APFS 磁碟。",
      },
    ];
  }

  /** 服務停止時釋放鎖檔；正常關閉會刪除鎖檔。 */
  close(): void {
    this.releaseLock();
  }

  /**
   * 執行中檢查資料夾是否還在。
   *
   * 消失時回 `pause`，恢復且身分相符時回 `resume`；呼叫端負責排程。
   */
  poll(): FolderNotification | null {
    if (this.#machine.state === "ready" || this.#machine.state === "paused") {
      if (!this.#layout.exists) {
        this.#reason = "missing";
        this.#machine.transition("unavailable");
        return { type: "pause", reason: "missing" };
      }
      return null;
    }
    if (this.#machine.state === "unavailable" && this.#reason === "missing") {
      if (!this.#layout.exists) {
        return null;
      }
      const identity = readFolderIdentity(this.#layout);
      if (identity.kind !== "ok" || identity.identity.folderId !== this.#folderId) {
        this.#reason = "folder_mismatch";
        this.#machine.transition("mismatch");
        return null;
      }
      this.#machine.transition("verifying");
      this.#machine.transition("ready");
      this.#reason = null;
      return { type: "resume" };
    }
    return null;
  }

  /** 資料庫讀寫失效時標成 `unavailable`；之後不再寫入。 */
  markStorageFailed(): void {
    if (this.#machine.state === "ready" || this.#machine.state === "paused") {
      this.#reason = "io_error";
      this.#machine.transition("unavailable");
    }
  }

  /** 使用者確認後，把 mismatch 轉回 verifying 重新檢查。 */
  retry(): void {
    this.#machine.transition("verifying");
  }

  private fail(state: "unavailable" | "mismatch", reason: FolderReason): FolderOpenResult {
    this.#reason = reason;
    this.#machine.transition(state);
    return {
      state,
      reason,
      folderId: this.#folderId,
      initialized: false,
      warnings: [],
    };
  }

  private structureIsValid(): boolean {
    // 九個子資料夾都必須是真目錄；state 是符號連結時不能開 DB 或寫鎖檔。
    for (const name of SUBFOLDERS) {
      const target = this.#layout.subfolderPath(name);
      if (!existsSync(target)) {
        if (name === "cache" || name === "tmp" || name === "logs") {
          continue;
        }
        this.#reason = name === "state" ? "state_missing" : "structure_missing";
        return false;
      }
      const stats = lstatSync(target);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        this.#reason = "structure_missing";
        return false;
      }
    }
    for (const file of ["cardiary.sqlite", "engine.sqlite"]) {
      const target = this.#layout.absolute(`state/${file}`);
      if (!existsSync(target)) {
        this.#reason = "state_missing";
        return false;
      }
      const stats = lstatSync(target);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        this.#reason = "state_missing";
        return false;
      }
    }
    return true;
  }

  private acquireLock(): { kind: "ok" } | { kind: "failed"; reason: FolderReason } {
    if (this.#options.lock === false) {
      return { kind: "ok" };
    }
    const lockPath = this.#layout.absolute("state/service.lock");
    const content: LockFileContent = {
      pid: process.pid,
      startedAt: nowIso(this.#now),
      host: process.env.HOSTNAME ?? "unknown",
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(lockPath, "wx", 0o600);
        try {
          writeFileSync(fd, `${JSON.stringify(content)}\n`, "utf8");
        } finally {
          closeSync(fd);
        }
        this.#lock = {
          release: () => {
            // 只刪這台服務自己建立的鎖檔；固定路徑，不是使用者資料。
            rmSync(lockPath, { force: true });
          },
        };
        return { kind: "ok" };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          return { kind: "failed", reason: "io_error" };
        }
        const existing = this.readLock();
        if (existing !== null && processIsAlive(existing.pid)) {
          return { kind: "failed", reason: "already_running" };
        }
        // 上次被 SIGKILL 留下的鎖檔：只刪固定路徑的鎖檔，不是正本。
        try {
          rmSync(lockPath, { force: true });
        } catch {
          return { kind: "failed", reason: "io_error" };
        }
      }
    }
    return { kind: "failed", reason: "already_running" };
  }

  private readLock(): LockFileContent | null {
    try {
      const raw = readFileNoFollow(
        this.#layout,
        this.#layout.absolute("state/service.lock"),
      ).toString("utf8");
      const parsed = JSON.parse(raw) as Partial<LockFileContent>;
      if (typeof parsed.pid !== "number") {
        return null;
      }
      return {
        pid: parsed.pid,
        startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
        host: typeof parsed.host === "string" ? parsed.host : "",
      };
    } catch {
      return null;
    }
  }

  private releaseLock(): void {
    this.#lock?.release();
    this.#lock = null;
  }

  private cleanupFailedInitialization(): void {
    // 只刪這次初始化剛建立的兩個 DB、它們的側車檔與身分檔；
    // 這些路徑都在 `state/`，不能用一般回收的 `assertDeletable`（正本區），
    // 所以逐一列出固定檔名，不掃描目錄，也不碰其他正本。
    for (const file of ["cardiary.sqlite", "engine.sqlite"]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(this.#layout.absolute(`state/${file}${suffix}`), { force: true });
      }
    }
    rmSync(folderIdentityPath(this.#layout), { force: true });
    for (const name of [...SUBFOLDERS].reverse()) {
      try {
        // 只移除空目錄；若有任何檔案（包含使用者的）就保留。
        rmdirSync(this.#layout.subfolderPath(name));
      } catch {
        // 非空目錄保留；下一次啟動會看到非空且有 `folder.json` 的資料夾。
      }
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 對協定的粗粒度狀態；`service` 為 null 代表服務沒有啟動。 */
export interface MappedSystemStatus {
  readonly folder: {
    readonly state: ProtocolFolderState;
    readonly displayName: string;
    readonly writable: boolean;
    readonly reason?: string;
  };
  readonly service: { readonly state: ServiceState } | null;
}

/**
 * 內部八態對 `SystemStatus` 的對照（`protocol` 第 8 節）。
 *
 * `serviceActive` 為 false 時模擬「服務沒有啟動」，不產生 service 狀態。
 */
export function toSystemStatus(
  state: FolderState,
  options: {
    readonly displayName: string;
    readonly reason?: FolderReason | null;
    readonly serviceActive?: boolean;
    readonly previousFolderState?: ProtocolFolderState;
  },
): MappedSystemStatus {
  const serviceActive = options.serviceActive ?? true;
  const defaultReason: Partial<Record<FolderState, FolderReason>> = {
    verifying: "verifying",
    paused: "paused",
    mismatch: "mismatch",
    migrating: "migrating",
    "migration-failed": "migration_failed",
  };
  const reason = options.reason ?? defaultReason[state] ?? undefined;
  const folder = (
    folderState: ProtocolFolderState,
    writable: boolean,
  ): MappedSystemStatus["folder"] => ({
    state: folderState,
    displayName: options.displayName,
    writable,
    ...(reason === undefined ? {} : { reason }),
  });
  const withService = (
    folderState: ProtocolFolderState,
    writable: boolean,
    service: ServiceState,
  ): MappedSystemStatus => ({
    folder: folder(folderState, writable),
    service: serviceActive ? { state: service } : null,
  });

  switch (state) {
    case "unselected":
      return { folder: folder("not_selected", false), service: null };
    case "verifying":
      return withService(options.previousFolderState ?? "ready", false, "degraded");
    case "ready":
      return withService("ready", true, "running");
    case "paused":
      return withService("ready", true, "paused");
    case "unavailable":
      return withService("unavailable", false, "paused");
    case "mismatch":
      return withService("unavailable", false, "degraded");
    case "migrating":
      return withService("unavailable", false, "paused");
    case "migration-failed":
      return withService("unavailable", false, "degraded");
  }
}

/** 確保 `state/` 目錄存在；只在初始化或已確認結構後呼叫。 */
export function ensureStateDirectory(layout: FolderLayout): void {
  const stateDirectory = layout.subfolderPath("state");
  if (!existsSync(stateDirectory)) {
    mkdirSync(stateDirectory);
  }
  if (!statSync(stateDirectory).isDirectory()) {
    throw new StorageError("folder-mismatch", "state 不是目錄", { path: stateDirectory });
  }
}
