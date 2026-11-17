/**
 * 外部代理橋接的領域類型。
 *
 * 這裡不認識供應商工具的參數；供應商協定的正規化放在 `normalize.ts`，
 * 狀態機放在 `state.ts`。欄位對齊協定 `AgentStart*`、`AgentSessionInfo`、
 * `AgentProgress` 與 `agent.state_changed`。
 */

export const EXTERNAL_AGENT_KINDS = ["opencode", "claude-code"] as const;
export type ExternalAgentKind = (typeof EXTERNAL_AGENT_KINDS)[number];

export const EXTERNAL_AGENT_STATUSES = [
  "starting",
  "running",
  "waiting-approval",
  "completed",
  "stopped",
  "failed",
] as const;
export type ExternalAgentStatus = (typeof EXTERNAL_AGENT_STATUSES)[number];

export const EXTERNAL_AGENT_TERMINAL_STATUSES: readonly ExternalAgentStatus[] = [
  "completed",
  "stopped",
  "failed",
];

export type ExternalAgentJson = Record<string, unknown>;

export interface ExternalAgentProgress {
  readonly step: number;
  readonly label: string;
  readonly completed: number;
  readonly total: number;
}

/** 供應商協定正規化後的事件；橋接層只認這一種。 */
export type NormalizedAgentEvent =
  | { readonly kind: "output"; readonly text: string }
  | {
      readonly kind: "progress";
      readonly completed: number;
      readonly total: number;
      readonly label: string;
    }
  | {
      readonly kind: "permission";
      readonly toolName: string;
      readonly input: ExternalAgentJson;
      readonly description?: string;
      /** 供應商協定裡這一次請求的識別；同一個 key 只會問一次。 */
      readonly requestKey: string;
      /** 回應權限請求時要帶回去的值。 */
      readonly replyToken: string;
    }
  | { readonly kind: "completed"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** 待核准的權限請求，記事件序號與審批 id。 */
export interface PendingPermissionRequest {
  readonly requestKey: string;
  readonly approvalId: string;
  readonly toolName: string;
  readonly description?: string | undefined;
  readonly input: ExternalAgentJson;
  readonly replyToken: string;
}

/**
 * 寫在 `cache/agents/<session>/session.json` 的耐久紀錄。
 *
 * `lastEventSeq` 是橋接層自己維護的單調遞增序號，用來分辨「重啟前已經處理過」
 * 和「重啟後才收到的」事件，避免同一事件被套用兩次。
 */
/**
 * 外部代理子行程的身分，用來在主機服務重啟後認出同一個行程。
 *
 * `startedAt` 是作業系統回報的啟動時間（`ps -o lstart=`），用來排除 PID 重用後
 * 指到別的行程的情況；`processGroupId` 是啟動時的行程群組，用來確認不會殺到
 * 由別的管理主機建立、共用同一個 PID 的行程。
 */
export interface ExternalAgentChildProcess {
  readonly pid: number;
  readonly processGroupId: number;
  readonly startedAt: string;
}

export interface ExternalAgentSessionRecord {
  readonly agentSessionId: string;
  readonly agentKind: ExternalAgentKind;
  readonly workingDirectory: string;
  readonly prompt?: string | undefined;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly status: ExternalAgentStatus;
  readonly message?: string | undefined;
  readonly progress?: ExternalAgentProgress | undefined;
  readonly completedSteps: number;
  readonly lastEventSeq: number;
  readonly pendingPermission: PendingPermissionRequest | null;
  /** 主機服務上次重啟時標記為結果未知的 session。 */
  readonly resultUnknown: boolean;
  /**
   * 啟動審批的 id；代理真的啟動之後以及終態之後清空。
   * 用來在主機重啟時撤回卡在 pending 的啟動審批，避免留下幽靈審批。
   */
  readonly startApprovalId?: string | undefined;
  /** 客戶端給的冪等鍵；重送同一個 id 只會啟動一次。 */
  readonly clientRequestId?: string | undefined;
  /**
   * 代理子行程的身分；確認行程結束後清空。
   * 主機服務在啟動時讀這個欄位，找出上一次強制結束時留下的行程。
   */
  readonly child?: ExternalAgentChildProcess | undefined;
}

export interface ExternalAgentUsage {
  /** `cache/agents` 佔用的位元組。 */
  readonly cacheBytes: number;
  /** `tmp/agents` 佔用的位元組；正常為 0。 */
  readonly tempBytes: number;
  /** 代理在資料夾外可能寫入的已知位置；只讀取大小，不讀內容。 */
  readonly outsideEntries: readonly ExternalAgentUsageEntry[];
}

export interface ExternalAgentUsageEntry {
  readonly path: string;
  readonly bytes: number;
  readonly exists: boolean;
}
