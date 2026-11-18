/**
 * 介面字串：繁體中文與英文。
 *
 * 預設跟隨瀏覽器語言（`zh*` → 繁體中文，其餘 → 英文），使用者可以用頁首的按鈕
 * 手動切換，選擇記在 localStorage。兩份字典的鍵必須一致，型別系統會擋下缺的鍵。
 */

export type Language = "zh-TW" | "en";

const zh = {
  "app.title": "Cardiary",
  "nav.conversation": "對話",
  "nav.notifications": "通知",
  "nav.approvals": "審批",
  "nav.pauseAll": "緊急暫停",
  "lang.toggle": "EN",
  "lang.toggleLabel": "Switch to English",

  "connection.connecting": "連線中…",
  "connection.connected": "已連線",
  "connection.notPaired": "尚未配對",
  "connection.disconnected": "連線中斷，重新連線中…",
  "connection.authFailed": "這台裝置無法通過驗證，請重新配對。",
  "connection.revoked": "這台裝置已在 Mac 上撤銷，請重新配對。",

  "pairing.title": "配對這個瀏覽器",
  "pairing.description": "輸入這個裝置要在 Mac 上顯示的名稱，然後送出配對請求。",
  "pairing.deviceNameLabel": "裝置名稱",
  "pairing.deviceNamePlaceholder": "例如：我的手機",
  "pairing.submit": "開始配對",
  "pairing.submitting": "正在送出配對請求…",
  "pairing.codeLabel": "核對短碼",
  "pairing.approveOnMac": "請在 Mac 上核准",
  "pairing.codeHint": "短碼只用來讓你核對是同一個請求，不能用來配對。",
  "pairing.expiresAt": "短碼期限：{time}",
  "pairing.waiting": "等待 Mac 核准…",
  "pairing.cancel": "取消",
  "pairing.remember": "記住這個裝置（關閉瀏覽器後仍然保留配對）",
  "pairing.deviceNameRequired": "請先輸入裝置名稱。",
  "pairing.beginFailed": "無法開始配對：{message}",
  "pairing.expired": "配對請求已過期，請重新開始。",
  "pairing.denied": "Mac 拒絕了這個配對請求。",
  "pairing.unknown": "配對請求已結束，請重新開始。",
  "pairing.reconnect": "重新配對",
  "pairing.done": "配對成功，正在連線…",

  "conversation.newSession": "新對話",
  "conversation.sessionLabel": "選擇對話",
  "conversation.empty": "還沒有訊息。送出第一則訊息開始。",
  "conversation.send": "送出",
  "conversation.inputPlaceholder": "輸入訊息，Enter 送出，Shift + Enter 換行",
  "conversation.interrupt": "中斷生成",
  "conversation.interrupting": "正在中斷…",
  "conversation.toolCall": "工具呼叫",
  "conversation.toolResult": "工具結果",
  "conversation.toolStatus.ok": "成功",
  "conversation.toolStatus.error": "失敗",
  "conversation.toolStatus.streaming": "執行中",
  "conversation.truncated": "輸出已截斷",
  "conversation.turnFailed": "這一回合失敗：{message}",
  "conversation.turnInterrupted": "這一回合已中斷",
  "conversation.approvalPending": "有一則審批等你決定。",
  "conversation.approvalGo": "前往審批",
  "conversation.sendFailed": "訊息送出失敗：{message}",
  "conversation.loadFailed": "無法載入對話：{message}",

  "notifications.title": "通知",
  "notifications.empty": "沒有通知。",
  "notifications.unread": "未讀 {count} 則",
  "notifications.markRead": "標為已讀",
  "notifications.markAllRead": "全部標為已讀",
  "notifications.createCard": "轉成卡片",
  "notifications.cardCreated": "已轉成卡片：{title}",
  "notifications.cardDeduped": "這則通知已經轉過，回同一張卡：{title}",
  "notifications.actionFailed": "操作失敗：{message}",
  "notifications.kind.schedule": "排程",
  "notifications.kind.heartbeat": "心跳",
  "notifications.kind.distillation": "蒸餾",

  "approvals.title": "待審批",
  "approvals.empty": "目前沒有等你決定的審批。",
  "approvals.approve": "核准",
  "approvals.reject": "拒絕",
  "approvals.approveAlways": "一律允許",
  "approvals.deciding": "送出中…",
  "approvals.decideFailed": "決定送出失敗：{message}",
  "approvals.requestedAt": "請求於 {time}",
  "approvals.scope.tool_call": "工具",
  "approvals.scope.settings_change": "設定變更",
  "approvals.scope.schedule": "排程",

  "pause.title": "緊急全部暫停",
  "pause.description": "立即中止所有進行中的回合，並暫停所有待審批的工作。配對與撤銷不受影響。",
  "pause.warning": "這個動作會影響 Mac 上所有進行中的工作。",
  "pause.button": "緊急全部暫停",
  "pause.confirm": "再按一次確認暫停",
  "pause.cancelConfirm": "取消",
  "pause.sending": "正在送出…",
  "pause.done": "已全部暫停，共中止 {count} 個回合。",
  "pause.failed": "暫停失敗：{message}",

  "logout.button": "登出這個裝置",
  "logout.confirm": "登出只會清除這個瀏覽器上的憑證；要完全撤銷這個裝置，請在 Mac 上操作。",
  "common.loading": "載入中…",
  "common.error": "發生錯誤：{message}",
} as const;

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  "app.title": "Cardiary",
  "nav.conversation": "Chat",
  "nav.notifications": "Notifications",
  "nav.approvals": "Approvals",
  "nav.pauseAll": "Pause all",
  "lang.toggle": "繁中",
  "lang.toggleLabel": "切換成繁體中文",

  "connection.connecting": "Connecting…",
  "connection.connected": "Connected",
  "connection.notPaired": "Not paired",
  "connection.disconnected": "Disconnected, reconnecting…",
  "connection.authFailed": "This device could not be verified. Please pair again.",
  "connection.revoked": "This device was revoked on the Mac. Please pair again.",

  "pairing.title": "Pair this browser",
  "pairing.description":
    "Enter the name this device should show on your Mac, then send the pairing request.",
  "pairing.deviceNameLabel": "Device name",
  "pairing.deviceNamePlaceholder": "e.g. My phone",
  "pairing.submit": "Start pairing",
  "pairing.submitting": "Sending pairing request…",
  "pairing.codeLabel": "Verification code",
  "pairing.approveOnMac": "Approve it on your Mac",
  "pairing.codeHint":
    "The code only lets you confirm this is the same request. It cannot be used to pair.",
  "pairing.expiresAt": "Code expires at: {time}",
  "pairing.waiting": "Waiting for approval on the Mac…",
  "pairing.cancel": "Cancel",
  "pairing.remember": "Remember this device (keep pairing after the browser closes)",
  "pairing.deviceNameRequired": "Enter a device name first.",
  "pairing.beginFailed": "Could not start pairing: {message}",
  "pairing.expired": "The pairing request expired. Please try again.",
  "pairing.denied": "The Mac denied this pairing request.",
  "pairing.unknown": "The pairing request is over. Please start again.",
  "pairing.reconnect": "Pair again",
  "pairing.done": "Paired. Connecting…",

  "conversation.newSession": "New chat",
  "conversation.sessionLabel": "Choose a chat",
  "conversation.empty": "No messages yet. Send the first one to get started.",
  "conversation.send": "Send",
  "conversation.inputPlaceholder": "Type a message. Enter to send, Shift + Enter for a new line",
  "conversation.interrupt": "Interrupt",
  "conversation.interrupting": "Interrupting…",
  "conversation.toolCall": "Tool call",
  "conversation.toolResult": "Tool result",
  "conversation.toolStatus.ok": "ok",
  "conversation.toolStatus.error": "failed",
  "conversation.toolStatus.streaming": "running",
  "conversation.truncated": "Output truncated",
  "conversation.turnFailed": "This turn failed: {message}",
  "conversation.turnInterrupted": "This turn was interrupted",
  "conversation.approvalPending": "An approval is waiting for your decision.",
  "conversation.approvalGo": "Go to approvals",
  "conversation.sendFailed": "Message failed to send: {message}",
  "conversation.loadFailed": "Could not load the conversation: {message}",

  "notifications.title": "Notifications",
  "notifications.empty": "No notifications.",
  "notifications.unread": "{count} unread",
  "notifications.markRead": "Mark as read",
  "notifications.markAllRead": "Mark all as read",
  "notifications.createCard": "Turn into card",
  "notifications.cardCreated": "Created card: {title}",
  "notifications.cardDeduped": "Already turned into a card: {title}",
  "notifications.actionFailed": "Action failed: {message}",
  "notifications.kind.schedule": "Schedule",
  "notifications.kind.heartbeat": "Heartbeat",
  "notifications.kind.distillation": "Distillation",

  "approvals.title": "Approvals",
  "approvals.empty": "Nothing is waiting for your decision.",
  "approvals.approve": "Approve",
  "approvals.reject": "Reject",
  "approvals.approveAlways": "Always allow",
  "approvals.deciding": "Sending…",
  "approvals.decideFailed": "Could not send the decision: {message}",
  "approvals.requestedAt": "Requested at {time}",
  "approvals.scope.tool_call": "Tool",
  "approvals.scope.settings_change": "Settings change",
  "approvals.scope.schedule": "Schedule",

  "pause.title": "Emergency pause",
  "pause.description":
    "Immediately interrupt every in-flight turn and pause all pending work. Pairing and revocation are not affected.",
  "pause.warning": "This affects all work in progress on your Mac.",
  "pause.button": "Emergency pause all",
  "pause.confirm": "Press again to confirm",
  "pause.cancelConfirm": "Cancel",
  "pause.sending": "Sending…",
  "pause.done": "Everything paused. {count} turns interrupted.",
  "pause.failed": "Pause failed: {message}",

  "logout.button": "Sign out this device",
  "logout.confirm":
    "Signing out only clears the credentials stored in this browser. To fully revoke this device, do it on the Mac.",
  "common.loading": "Loading…",
  "common.error": "Something went wrong: {message}",
};

export const dictionaries: Record<Language, Record<MessageKey, string>> = {
  "zh-TW": zh,
  en,
};

const LANGUAGE_STORAGE_KEY = "cardiary.lang";

export function detectLanguage(
  navigatorLanguage: string | undefined,
  stored: string | null,
): Language {
  if (stored === "zh-TW" || stored === "en") return stored;
  return navigatorLanguage?.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

export function loadLanguage(): Language {
  let stored: string | null;
  try {
    stored = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  const navigatorLanguage = typeof navigator === "undefined" ? undefined : navigator.language;
  return detectLanguage(navigatorLanguage, stored);
}

export function saveLanguage(language: Language): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // 私密模式寫不進去就不記，功能不受影響。
  }
}

/** 翻譯一個鍵；`vars` 裡的 `{name}` 會被代換。找不到的值原樣顯示。 */
export function translate(
  language: Language,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = dictionaries[language][key];
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
