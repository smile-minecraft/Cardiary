/**
 * 硬規則的代號。
 *
 * `deny.*` 永遠有效，白名單與任何權限模式都不能推翻；`fs.*`／`shell.*`／
 * `cards.*`／`plan.*` 是自動放行；`ask.*` 是「一律詢問」的分類。
 * 代號會出現在審批紀錄與測試裡，改名等於改行為。
 */
export const PERMISSION_RULES = {
  invalidPath: "deny.invalid-path",
  credentials: "deny.credentials",
  keychainCli: "deny.keychain-cli",
  humanSettings: "deny.human-settings",
  escalation: "deny.escalation",
  systemWrite: "deny.system-write",
  diskDestroy: "deny.disk-destroy",
  zoneBulkDelete: "deny.zone-bulk-delete",
  selfModify: "deny.self-modify",
  symlinkWrite: "deny.symlink-write",

  readWorkspace: "fs.read-workspace",
  readState: "fs.read-state",
  tmpWrite: "fs.tmp-write",
  hardLinkWrite: "fs.write-hardlink",

  cardsRead: "cards.read",
  cardsCreate: "cards.create",
  cardsRefresh: "cards.refresh",
  cardsFlip: "cards.flip",

  vcsRead: "shell.vcs-read",
  shellReadWorkspace: "shell.read-workspace",
  planRead: "plan.read",
  settingsFree: "settings.free",

  askShell: "ask.shell",
  askFsWrite: "ask.fs-write",
  askFsDelete: "ask.fs-delete",
  askFsRead: "ask.fs-read",
  askCardsWrite: "ask.cards-write",
  askNetwork: "ask.network",
  askMcp: "ask.mcp",
  askExternalAgent: "ask.external-agent",
  askSettings: "ask.settings",
  askUnclassified: "ask.unclassified",
} as const;

export type PermissionRule = (typeof PERMISSION_RULES)[keyof typeof PERMISSION_RULES];

/** 永遠禁止的代號；白名單只在這幾種之外生效。 */
export const DENY_RULES: ReadonlySet<string> = new Set([
  PERMISSION_RULES.invalidPath,
  PERMISSION_RULES.credentials,
  PERMISSION_RULES.keychainCli,
  PERMISSION_RULES.humanSettings,
  PERMISSION_RULES.escalation,
  PERMISSION_RULES.systemWrite,
  PERMISSION_RULES.diskDestroy,
  PERMISSION_RULES.zoneBulkDelete,
  PERMISSION_RULES.selfModify,
  PERMISSION_RULES.symlinkWrite,
]);

export function isDenyRule(rule: string): boolean {
  return rule.startsWith("deny.");
}
