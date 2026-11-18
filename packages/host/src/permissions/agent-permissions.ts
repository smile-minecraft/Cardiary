/**
 * 代理權限的人類設定：委派類別、可委派網域清單與限時的全部允許。
 *
 * 這個服務只有人類的設定入口會拿到；工具與模型都碰不到。狀態存
 * `state/agent-permissions.json`（正本區，原子寫入）。檔案損毀或格式
 * 不對時，一律退回「全部關閉」並留下診斷，不會帶著半套設定繼續跑。
 *
 * 規則的來源在 `docs/design/permissions.md`；這裡只負責保存與查詢，
 * 判斷順序由 `permissions/delegation.ts` 決定。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  DELEGABLE_CATEGORIES,
  formatDomainRule,
  isWithin,
  parseDomainRule,
  type DelegatedCategory,
} from "@cardiary/domain";

/** 每場對話的自動放行上限；用完之後一律重新詢問。 */
export const MAX_DELEGATED_APPROVALS = 20;

/** 全部允許的預設與上限（分鐘）。 */
export const DEFAULT_ALLOW_ALL_MINUTES = 15;
export const MAX_ALLOW_ALL_MINUTES = 60;

export interface CategoryGrant {
  readonly category: DelegatedCategory;
  readonly paths: readonly string[];
}

export interface AllowAllGrant {
  readonly tools: readonly string[];
  /** 檔案類工具的路徑範圍；`fs.*` 與 `shell.exec` 都要落在裡面。 */
  readonly paths: readonly string[];
  /** 網路類工具的網域範圍；必須同時在人類的可委派清單內。 */
  readonly domains: readonly string[];
  readonly expiresAt: number;
}

interface StoredPermissions {
  readonly version: 1;
  readonly categories: readonly CategoryGrant[];
  readonly allowedDomains: readonly string[];
  readonly allowAll: AllowAllGrant | null;
  readonly counts: Readonly<Record<string, number>>;
}

/** 需要人類指定路徑的類別；其餘類別沒有範圍可設。 */
const PATH_CATEGORIES: readonly DelegatedCategory[] = ["read-only-files", "git-readonly"];

const empty = (): StoredPermissions => ({
  version: 1,
  categories: [],
  allowedDomains: [],
  allowAll: null,
  counts: {},
});

export class AgentPermissions {
  readonly #path: string;
  #state: StoredPermissions;

  constructor(stateDirectory: string, options: { diagnostic?: (message: string) => void } = {}) {
    this.#path = join(stateDirectory, "agent-permissions.json");
    this.#state = empty();
    if (!existsSync(this.#path)) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#path, "utf8"));
      if (!validState(parsed)) {
        throw new Error("設定格式錯誤");
      }
      this.#state = parsed;
    } catch {
      options.diagnostic?.("代理權限設定損毀，已停用所有委派權限。");
    }
  }

  status(conversationId: string, now: number) {
    const allowAll = this.allowAllFor(now);
    return {
      categories: this.#state.categories.map((entry) => ({ ...entry, paths: [...entry.paths] })),
      allowedDomains: [...this.#state.allowedDomains],
      allowAll:
        allowAll === null
          ? null
          : {
              tools: [...allowAll.tools],
              paths: [...allowAll.paths],
              domains: [...allowAll.domains],
              expiresAt: allowAll.expiresAt,
            },
      remaining: Math.max(0, MAX_DELEGATED_APPROVALS - (this.#state.counts[conversationId] ?? 0)),
    };
  }

  /** 人類的設定入口：開啟或關閉一個類別。 */
  setCategory(category: DelegatedCategory, enabled: boolean, paths: readonly string[]): void {
    if (!DELEGABLE_CATEGORIES.includes(category)) {
      throw new Error("不支援的委派類別");
    }
    if (!PATH_CATEGORIES.includes(category) && paths.length > 0) {
      throw new Error("這個委派類別沒有路徑範圍");
    }
    const next = this.#state.categories.filter((entry) => entry.category !== category);
    if (enabled) {
      next.push({ category, paths: validPaths(paths) });
    }
    this.#save({ ...this.#state, categories: next });
  }

  /** 人類的設定入口：整份可委派網域清單（只有人會呼叫）。 */
  setAllowedDomains(domains: readonly string[]): void {
    const canonical = domains.map((domain) => formatDomainRule(parseDomainRule(domain)));
    this.#save({ ...this.#state, allowedDomains: [...new Set(canonical)] });
  }

  /**
   * 人類按下「全部允許」：限時、限定工具與路徑或網域。
   *
   * 期限預設 15 分鐘、上限 60 分鐘；時間到就自動失效，不需要任何人記得關。
   */
  grantAllowAll(
    scope: { tools: readonly string[]; paths: readonly string[]; domains?: readonly string[] },
    now: number,
    minutes = DEFAULT_ALLOW_ALL_MINUTES,
  ): void {
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      minutes > MAX_ALLOW_ALL_MINUTES ||
      scope.tools.length === 0 ||
      scope.tools.some((tool) => typeof tool !== "string" || tool.length === 0)
    ) {
      throw new Error("全部允許的範圍或期限無效");
    }
    const domains = (scope.domains ?? []).map((domain) =>
      formatDomainRule(parseDomainRule(domain)),
    );
    this.#save({
      ...this.#state,
      allowAll: {
        tools: [...new Set(scope.tools)],
        paths: validPaths(scope.paths),
        domains: [...new Set(domains)],
        expiresAt: now + minutes * 60_000,
      },
    });
  }

  revokeAllowAll(): void {
    this.#save({ ...this.#state, allowAll: null });
  }

  /** 有效的限時授權；過期就回 `null`，不刪紀錄（讓人看得到它失效了）。 */
  allowAllFor(now: number): AllowAllGrant | null {
    const grant = this.#state.allowAll;
    return grant !== null && grant.expiresAt > now ? grant : null;
  }

  /**
   * 人的類別授權是否涵蓋這個動作。
   *
   * 有路徑條件的類別，必須有至少一條授權路徑包含它；沒有路徑條件的類別
   * （建立卡片、自己的通知）只看類別有沒有開。
   */
  allowsCategory(category: DelegatedCategory, path: string | undefined): boolean {
    const grant = this.#state.categories.find((entry) => entry.category === category);
    if (grant === undefined) {
      return false;
    }
    if (!PATH_CATEGORIES.includes(category)) {
      return path === undefined;
    }
    if (path === undefined || grant.paths.length === 0) {
      return false;
    }
    return grant.paths.some((root) => isWithin(root, path));
  }

  /** 這個人設定的可委派網域清單。 */
  allowedDomains(): readonly string[] {
    return this.#state.allowedDomains;
  }

  /** 這場對話還剩幾次自動放行。 */
  remaining(conversationId: string): number {
    return Math.max(0, MAX_DELEGATED_APPROVALS - (this.#state.counts[conversationId] ?? 0));
  }

  /** 記一次自動放行；用完之後回 `false`，呼叫端要改回人工。 */
  reserve(conversationId: string): boolean {
    const used = this.#state.counts[conversationId] ?? 0;
    if (used >= MAX_DELEGATED_APPROVALS) {
      return false;
    }
    this.#save({ ...this.#state, counts: { ...this.#state.counts, [conversationId]: used + 1 } });
    return true;
  }

  /** 對話刪除後清掉它的計數，避免檔案隨刪除的對話長大。 */
  forget(conversationId: string): void {
    if (!(conversationId in this.#state.counts)) {
      return;
    }
    const counts = { ...this.#state.counts };
    delete counts[conversationId];
    this.#save({ ...this.#state, counts });
  }

  #save(next: StoredPermissions): void {
    const temp = `${this.#path}.${randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    renameSync(temp, this.#path);
    this.#state = next;
  }
}

function validPaths(paths: readonly string[]): string[] {
  if (
    !Array.isArray(paths) ||
    paths.some((path) => typeof path !== "string" || !isAbsolute(path))
  ) {
    throw new Error("委派路徑必須是絕對路徑");
  }
  return [...new Set(paths.map((path) => canonicalPath(resolve(path))))];
}

/**
 * 授權路徑存成真實路徑。權限閘道比對的是工具路徑解析後的真實路徑；
 * 如果授權存的是經過符號連結的路徑（例如 macOS 的 `/var` → `/private/var`），
 * 範圍永遠比對不到，授權等於沒開。路徑還不存在時，用最近一個存在的上層
 * 的真實路徑接回剩下的部分。
 */
function canonicalPath(path: string): string {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      missing.push(basename(current));
      current = parent;
    }
  }
}

function validState(value: unknown): value is StoredPermissions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Array.isArray(record.categories) ||
    !isDomainList(record.allowedDomains) ||
    typeof record.counts !== "object" ||
    record.counts === null ||
    Array.isArray(record.counts)
  ) {
    return false;
  }
  if (
    !Object.values(record.counts).every(
      (count) =>
        typeof count === "number" &&
        Number.isInteger(count) &&
        count >= 0 &&
        count <= MAX_DELEGATED_APPROVALS,
    )
  ) {
    return false;
  }
  const categories = record.categories;
  if (
    !categories.every((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return false;
      }
      const item = entry as Record<string, unknown>;
      if (
        typeof item.category !== "string" ||
        !DELEGABLE_CATEGORIES.includes(item.category as DelegatedCategory) ||
        !isPaths(item.paths)
      ) {
        return false;
      }
      return (
        PATH_CATEGORIES.includes(item.category as DelegatedCategory) || item.paths.length === 0
      );
    })
  ) {
    return false;
  }
  if (
    new Set(categories.map((entry: CategoryGrant) => entry.category)).size !== categories.length
  ) {
    return false;
  }
  if (record.allowAll === null) {
    return true;
  }
  if (
    typeof record.allowAll !== "object" ||
    record.allowAll === null ||
    Array.isArray(record.allowAll)
  ) {
    return false;
  }
  const grant = record.allowAll as Record<string, unknown>;
  return (
    Array.isArray(grant.tools) &&
    grant.tools.length > 0 &&
    grant.tools.every((tool: unknown) => typeof tool === "string" && tool.length > 0) &&
    isPaths(grant.paths) &&
    isDomainList(grant.domains) &&
    typeof grant.expiresAt === "number" &&
    Number.isFinite(grant.expiresAt)
  );
}

function isPaths(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (path: unknown) => typeof path === "string" && isAbsolute(path) && resolve(path) === path,
    )
  );
}

function isDomainList(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  try {
    for (const domain of value) {
      if (typeof domain !== "string") {
        return false;
      }
      parseDomainRule(domain);
    }
  } catch {
    return false;
  }
  return true;
}
