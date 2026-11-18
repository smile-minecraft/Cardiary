/**
 * 遠端應用的中央狀態：連線、會話、逐字稿、通知、待審批。
 *
 * 畫面只透過 `subscribe(listener)` 訂閱變更並從這裡讀狀態；動作也回到這裡。
 * 所有請求走同一條 WebSocket；重連由本類別負責，hello 失敗就清掉 Token、
 * 回到配對畫面，其他關閉都以退避重連。
 */

import type {
  ApprovalDecideResponsePayload,
  ApprovalPauseAllResponsePayload,
  ApprovalRequest,
  AssistantTranscriptEntry,
  CardiaryNotification,
  NotificationListResponsePayload,
  NotificationMarkReadResponsePayload,
  SessionListResponsePayload,
  SessionSubscribeResponsePayload,
  SessionSummary,
  ToolOutput,
  ToolTranscriptEntry,
  TranscriptEntry,
  TurnState,
} from "@cardiary/protocol";

import { defaultDeviceTokenStore, DeviceTokenStore } from "../net/device-token";
import {
  ProtocolClient,
  ProtocolRequestError,
  reconnectDelay,
  type ServerEvent,
} from "../net/protocol-client";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type PairingNotice = "authFailed" | "revoked" | null;

const SESSION_PAGE_LIMIT = 100;
const SESSION_PAGE_MAX = 10;
const NOTIFICATION_LIMIT = 50;
const TRANSCRIPT_HISTORY_LIMIT = 50;

export class RemoteApp {
  readonly tokenStore: DeviceTokenStore;
  readonly clientVersion: string;

  connectionStatus: ConnectionStatus = "connecting";
  /** Token 驗證失敗或被撤銷：需要重新配對，並在配對頁顯示原因。 */
  pairingNotice: PairingNotice = null;
  /** 沒有 Token（或剛清掉）：畫面進入配對模式。 */
  needsPairing = false;

  sessions: SessionSummary[] = [];
  currentSessionId: string | null = null;
  entries: TranscriptEntry[] = [];
  streaming: { messageId: string; turnId: string; text: string } | null = null;
  activeTurn: TurnState | null = null;
  pendingApproval: ApprovalRequest | null = null;
  transcriptLoading = false;
  transcriptError: string | null = null;

  notifications: CardiaryNotification[] = [];
  totalUnread = 0;

  approvals: ApprovalRequest[] = [];

  /** 事件裡收到、但畫面還沒消化掉的診斷訊息（例如補送缺口）。 */
  diagnostics: string[] = [];

  #client: ProtocolClient | null = null;
  #instanceId = "";
  #reconnectAttempt = 0;
  #stopped = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #listeners = new Set<() => void>();

  constructor(options: {
    tokenStore?: DeviceTokenStore;
    clientVersion: string;
    instanceId?: string;
  }) {
    this.tokenStore = options.tokenStore ?? defaultDeviceTokenStore();
    this.clientVersion = options.clientVersion;
    this.#instanceId = options.instanceId ?? this.tokenStore.instanceId(() => randomInstanceId());
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  get instanceId(): string {
    return this.#instanceId;
  }

  /** 啟動：有 Token 就連線，沒有就進入配對模式。 */
  start(): void {
    this.#stopped = false;
    if (!this.tokenStore.load()) {
      this.needsPairing = true;
      this.connectionStatus = "disconnected";
      this.#emit();
      return;
    }
    this.#connect();
  }

  /** 配對頁成功拿到 Token：存起來，切到認證連線。 */
  adoptDeviceToken(token: string, remember: boolean): void {
    this.tokenStore.save(token, remember);
    this.needsPairing = false;
    this.pairingNotice = null;
    this.#stopped = false;
    this.#reconnectAttempt = 0;
    this.#connect();
  }

  /** 登出這個裝置：清掉 Token，關閉連線；撤銷要在 Mac 上做。 */
  logout(): void {
    this.tokenStore.clear();
    this.pairingNotice = null;
    this.needsPairing = true;
    this.connectionStatus = "disconnected";
    this.#stopped = true;
    this.#clearReconnectTimer();
    this.#client?.close();
    this.#client = null;
    this.#resetSessionScopedState();
    this.#emit();
  }

  async selectSession(sessionId: string): Promise<void> {
    const client = this.#client;
    if (!client || this.connectionStatus !== "connected") return;
    this.currentSessionId = sessionId;
    this.transcriptLoading = true;
    this.transcriptError = null;
    this.#emit();
    try {
      const payload = await client.request<SessionSubscribeResponsePayload>("session.subscribe", {
        sessionId,
        historyLimit: TRANSCRIPT_HISTORY_LIMIT,
      });
      if (payload.snapshot) this.#adoptSnapshot(payload.snapshot, { transcript: true });
    } catch (error) {
      this.transcriptError = errorMessage(error);
    } finally {
      this.transcriptLoading = false;
      this.#emit();
    }
  }

  async createSession(): Promise<void> {
    const client = this.#client;
    if (!client) return;
    const payload = await client.request<{ session: SessionSummary }>("session.create", {});
    this.#upsertSession(payload.session);
    await this.selectSession(payload.session.id);
  }

  async sendMessage(text: string): Promise<void> {
    const client = this.#client;
    const sessionId = this.currentSessionId;
    if (!client || !sessionId) return;
    await client.request("session.send_message", {
      sessionId,
      text,
      delivery: "queue",
    });
    // 送出後重新整理列表拿到最新標題與狀態；失敗不影響送出本身。
    await this.#refreshSessions().catch((error: unknown) => {
      this.#recordDiagnostic(errorMessage(error));
    });
  }

  async interrupt(): Promise<void> {
    const client = this.#client;
    const sessionId = this.currentSessionId;
    if (!client || !sessionId) return;
    await client.request("session.interrupt", { sessionId, reason: "user" });
  }

  async decideApproval(
    approval: ApprovalRequest,
    effect: "approve" | "reject" | "approve_always",
  ): Promise<ApprovalDecideResponsePayload> {
    const client = this.#client;
    if (!client) throw new ProtocolRequestError("connection_closed", "連線尚未就緒。");
    const option = approval.options.find((candidate) => candidate.effect === effect);
    if (!option) {
      throw new ProtocolRequestError("unsupported", "這個審批沒有對應的選項。");
    }
    const payload = await client.request<ApprovalDecideResponsePayload>("approval.decide", {
      approvalId: approval.approvalId,
      optionId: option.id,
    });
    this.#removeApproval(approval.approvalId);
    return payload;
  }

  async pauseAll(reason = "user"): Promise<ApprovalPauseAllResponsePayload> {
    const client = this.#client;
    if (!client) throw new ProtocolRequestError("connection_closed", "連線尚未就緒。");
    return client.request<ApprovalPauseAllResponsePayload>("approval.pause_all", { reason });
  }

  async refreshNotifications(): Promise<void> {
    const client = this.#client;
    if (!client) return;
    const payload = await client.request<NotificationListResponsePayload>("notification.list", {
      limit: NOTIFICATION_LIMIT,
    });
    this.notifications = payload.notifications;
    this.totalUnread = payload.totalUnread;
    this.#emit();
  }

  async markNotificationsRead(ids: string[] | "all"): Promise<void> {
    const client = this.#client;
    if (!client) return;
    const payload = await client.request<NotificationMarkReadResponsePayload>(
      "notification.mark_read",
      ids === "all" ? { all: true } : { ids },
    );
    if (ids === "all") {
      this.notifications = this.notifications.map((notification) =>
        notification.readAt ? notification : { ...notification, readAt: new Date().toISOString() },
      );
    } else {
      const read = new Set(ids);
      this.notifications = this.notifications.map((notification) =>
        read.has(notification.notificationId) && !notification.readAt
          ? { ...notification, readAt: new Date().toISOString() }
          : notification,
      );
    }
    this.totalUnread = payload.totalUnread;
    this.#emit();
  }

  // ---- 連線 ---------------------------------------------------------------

  #connect(): void {
    const token = this.tokenStore.load();
    if (!token) {
      this.needsPairing = true;
      this.connectionStatus = "disconnected";
      this.#emit();
      return;
    }
    this.connectionStatus = "connecting";
    this.#emit();
    const client = new ProtocolClient({
      token,
      instanceId: this.#instanceId,
      clientVersion: this.clientVersion,
      handlers: {
        onAuthenticated: () => this.#onAuthenticated(),
        onHelloFailed: () => this.#onHelloFailed(),
        onEvent: (event) => this.#onEvent(event),
        onClose: (info) => this.#onClose(info),
        onDiagnostic: (message) => this.#recordDiagnostic(message),
      },
    });
    this.#client = client;
    client.start();
  }

  #onAuthenticated(): void {
    this.connectionStatus = "connected";
    this.pairingNotice = null;
    this.#reconnectAttempt = 0;
    this.#emit();
    void this.#bootstrap();
  }

  async #bootstrap(): Promise<void> {
    try {
      await this.#client?.request("system.subscribe", {});
      await this.#refreshSessions();
      await this.refreshNotifications();
      await this.#subscribeActiveSessions();
      if (this.currentSessionId) {
        const stillExists = this.sessions.some((session) => session.id === this.currentSessionId);
        const target = stillExists ? this.currentSessionId : (this.sessions[0]?.id ?? null);
        if (target) await this.selectSession(target);
      } else if (this.sessions[0]) {
        this.currentSessionId = this.sessions[0].id;
        await this.selectSession(this.currentSessionId);
      }
    } catch (error) {
      this.#recordDiagnostic(errorMessage(error));
    }
  }

  #onHelloFailed(): void {
    // Token 被拒：清掉重來配對。撤銷的裝置也會走到這裡。
    this.tokenStore.clear();
    this.#client = null;
    this.needsPairing = true;
    this.pairingNotice = "authFailed";
    this.connectionStatus = "disconnected";
    this.#resetSessionScopedState();
    this.#emit();
  }

  #onClose(info: { code: number; reason: string; intentional: boolean }): void {
    this.#client = null;
    if (info.intentional || this.#stopped) return;
    if (info.reason === "device_revoked") {
      this.tokenStore.clear();
      this.needsPairing = true;
      this.pairingNotice = "revoked";
      this.connectionStatus = "disconnected";
      this.#resetSessionScopedState();
      this.#emit();
      return;
    }
    this.connectionStatus = "disconnected";
    this.#emit();
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer) return;
    const delay = reconnectDelay(this.#reconnectAttempt);
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  // ---- 會話與事件 -----------------------------------------------------------

  async #refreshSessions(): Promise<void> {
    const client = this.#client;
    if (!client) return;
    const collected: SessionSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < SESSION_PAGE_MAX; page += 1) {
      const payload: SessionListResponsePayload = await client.request<SessionListResponsePayload>(
        "session.list",
        cursor === undefined
          ? { limit: SESSION_PAGE_LIMIT }
          : { limit: SESSION_PAGE_LIMIT, cursor },
      );
      collected.push(...payload.sessions);
      if (!payload.nextCursor) break;
      cursor = payload.nextCursor;
    }
    this.sessions = collected.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.#emit();
  }

  /** 訂閱進行中的會話以取得待審批；不動逐字稿狀態。 */
  async #subscribeActiveSessions(): Promise<void> {
    const client = this.#client;
    if (!client) return;
    for (const session of this.sessions) {
      if (session.status !== "running" && session.status !== "waiting_approval") continue;
      try {
        const payload = await client.request<SessionSubscribeResponsePayload>("session.subscribe", {
          sessionId: session.id,
          historyLimit: 0,
        });
        if (payload.snapshot) {
          this.#adoptSnapshot(payload.snapshot, { transcript: false });
        }
      } catch {
        // 單一會話訂閱失敗不影響其他會話與待審批清單。
      }
    }
  }

  #adoptSnapshot(
    snapshot: NonNullable<SessionSubscribeResponsePayload["snapshot"]>,
    options: { transcript: boolean },
  ): void {
    if (options.transcript) {
      this.entries = [...snapshot.entries];
      this.streaming = snapshot.streaming
        ? {
            messageId: snapshot.streaming.messageId,
            turnId: snapshot.streaming.turnId,
            text: snapshot.streaming.text,
          }
        : null;
      this.activeTurn = snapshot.activeTurn ?? null;
    }
    this.#adoptApproval(snapshot.pendingApproval ?? null, snapshot.session.id);
    this.#emit();
  }

  #adoptApproval(approval: ApprovalRequest | null, sessionId: string): void {
    this.approvals = this.approvals.filter((existing) => existing.sessionId !== sessionId);
    if (approval) {
      this.approvals = [...this.approvals, approval].sort(compareApprovals);
    }
    if (sessionId === this.currentSessionId) {
      this.pendingApproval = approval;
    }
    this.#emit();
  }

  #upsertApproval(approval: ApprovalRequest): void {
    const next = this.approvals.filter((existing) => existing.approvalId !== approval.approvalId);
    this.approvals = [...next, approval].sort(compareApprovals);
    if (approval.sessionId === this.currentSessionId) {
      this.pendingApproval = approval;
    }
    this.#emit();
  }

  #removeApproval(approvalId: string): void {
    this.approvals = this.approvals.filter((existing) => existing.approvalId !== approvalId);
    if (this.pendingApproval?.approvalId === approvalId) {
      this.pendingApproval = null;
    }
    this.#emit();
  }

  #upsertSession(session: SessionSummary): void {
    const next = this.sessions.filter((existing) => existing.id !== session.id);
    this.sessions = [session, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.#emit();
  }

  #upsertNotification(notification: CardiaryNotification): void {
    const existing = this.notifications.find(
      (candidate) => candidate.notificationId === notification.notificationId,
    );
    if (existing) {
      const wasUnread = !existing.readAt;
      const nowUnread = !notification.readAt;
      if (wasUnread && !nowUnread) this.totalUnread = Math.max(0, this.totalUnread - 1);
      else if (!wasUnread && nowUnread) this.totalUnread += 1;
      this.notifications = this.notifications.map((candidate) =>
        candidate.notificationId === notification.notificationId ? notification : candidate,
      );
    } else {
      if (!notification.readAt) this.totalUnread += 1;
      this.notifications = [notification, ...this.notifications];
    }
    this.#emit();
  }

  #onEvent(event: ServerEvent): void {
    const sessionId = payloadSessionId(event);
    if (sessionId !== null && sessionId !== this.currentSessionId) {
      // 只關心待審批；其他會話的逐字稿不在畫面上。
      if (event.type === "approval.requested") {
        this.#upsertApproval(event.payload as ApprovalRequest);
      } else if (event.type === "approval.decided") {
        this.#removeApproval((event.payload as { approvalId: string }).approvalId);
      }
      return;
    }
    switch (event.type) {
      case "approval.requested":
        this.#upsertApproval(event.payload as ApprovalRequest);
        return;
      case "approval.decided":
        this.#removeApproval((event.payload as { approvalId: string }).approvalId);
        return;
      case "notification.changed": {
        const payload = event.payload as { notification: CardiaryNotification };
        this.#upsertNotification(payload.notification);
        return;
      }
      case "stream.turn_started": {
        const payload = event.payload as { turnId: string; startedAt: string };
        this.activeTurn = {
          turnId: payload.turnId,
          state: "running",
          startedAt: payload.startedAt,
        };
        this.#emit();
        return;
      }
      case "stream.text_delta": {
        const payload = event.payload as {
          turnId: string;
          messageId: string;
          delta: string;
        };
        const current = this.streaming;
        this.streaming = {
          messageId: payload.messageId,
          turnId: payload.turnId,
          text:
            current?.messageId === payload.messageId ? current.text + payload.delta : payload.delta,
        };
        this.#emit();
        return;
      }
      case "stream.message_completed": {
        const payload = event.payload as {
          entry: AssistantTranscriptEntry;
        };
        this.entries = [...this.entries, payload.entry];
        if (this.streaming?.messageId === payload.entry.id) this.streaming = null;
        this.#emit();
        return;
      }
      case "stream.tool_call": {
        const payload = event.payload as {
          turnId: string;
          toolCallId: string;
          name: string;
          input: ToolTranscriptEntry["input"];
        };
        const entries = [...this.entries];
        const index = entries.findIndex(
          (entry) => entry.role === "tool" && entry.toolCallId === payload.toolCallId,
        );
        const toolEntry: ToolTranscriptEntry = {
          id: payload.toolCallId,
          role: "tool",
          turnId: payload.turnId,
          createdAt: new Date().toISOString(),
          toolCallId: payload.toolCallId,
          name: payload.name,
          input: payload.input,
          status: "streaming",
          diagnostics: [],
        };
        if (index >= 0) entries[index] = { ...toolEntry, createdAt: entries[index]!.createdAt };
        else entries.push(toolEntry);
        this.entries = entries;
        this.#emit();
        return;
      }
      case "stream.tool_result": {
        const payload = event.payload as {
          toolCallId: string;
          status: "ok" | "error";
          output: ToolOutput;
          diagnostics: ToolTranscriptEntry["diagnostics"];
        };
        this.entries = this.entries.map((entry) =>
          entry.role === "tool" && entry.toolCallId === payload.toolCallId
            ? {
                ...entry,
                status: payload.status === "ok" ? "complete" : "failed",
                output: payload.output,
                diagnostics: payload.diagnostics,
              }
            : entry,
        );
        this.#emit();
        return;
      }
      case "stream.turn_state": {
        this.activeTurn = event.payload as unknown as TurnState;
        this.#emit();
        return;
      }
      default:
        return;
    }
  }

  #recordDiagnostic(message: string): void {
    this.diagnostics = [...this.diagnostics.slice(-4), message];
    this.#emit();
  }

  #resetSessionScopedState(): void {
    this.sessions = [];
    this.currentSessionId = null;
    this.entries = [];
    this.streaming = null;
    this.activeTurn = null;
    this.pendingApproval = null;
    this.notifications = [];
    this.totalUnread = 0;
    this.approvals = [];
    this.transcriptError = null;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

function compareApprovals(a: ApprovalRequest, b: ApprovalRequest): number {
  return a.requestedAt.localeCompare(b.requestedAt) || a.approvalId.localeCompare(b.approvalId);
}

/** 事件 payload 裡的 sessionId（沒有就 null）。 */
function payloadSessionId(event: ServerEvent): string | null {
  const payload = event.payload as { sessionId?: unknown } | undefined;
  return payload && typeof payload.sessionId === "string" ? payload.sessionId : null;
}

function randomInstanceId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `web_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
