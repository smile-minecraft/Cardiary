/**
 * 對話畫面：會話切換、逐字稿（含工具呼叫）、串流文字、中斷與送出。
 *
 * 每一則內容都用 DOM 節點建立：助理回覆經 `renderMarkdown` 轉成段落與清單，
 * 工具輸入與輸出只顯示成純文字，不轉成 HTML。
 */

import type { ToolTranscriptEntry, TranscriptEntry, UserTranscriptEntry } from "@cardiary/protocol";

import { translate, type Language } from "../i18n";
import { formatTime, h, replaceChildren } from "../lib/dom";
import { renderMarkdown } from "../lib/markdown";
import type { RemoteApp } from "../state/remote-app";
import { renderApprovalCard } from "./approvals";

interface ConversationContext {
  language: Language;
  app: RemoteApp;
  goToApprovals: () => void;
  resend: (text: string, localId: string) => void;
}

export interface ConversationView {
  readonly element: HTMLElement;
  update(): void;
}

/** 輸入框最多長到幾行高，再多就在框內捲動。 */
const COMPOSER_MAX_HEIGHT_PX = 168;

export function createConversationView(
  app: RemoteApp,
  language: Language,
  goToApprovals: () => void,
): ConversationView {
  const element = h("section", { class: "conversation" });

  const sessionBar = h("div", { class: "session-bar" });
  const transcript = h("div", { class: "transcript", "aria-live": "polite" });
  const composer = h("form", { class: "composer" });

  const input = h("textarea", {
    class: "message-input",
    rows: "1",
    enterkeyhint: "send",
    placeholder: translate(language, "conversation.inputPlaceholder"),
    "aria-label": translate(language, "conversation.inputPlaceholder"),
  });
  const sendButton = h("button", {
    class: "button button-primary send-button",
    type: "submit",
    text: translate(language, "conversation.send"),
  });
  const interruptButton = h("button", {
    class: "button button-quiet interrupt-button",
    type: "button",
    text: translate(language, "conversation.interrupt"),
  });
  interruptButton.hidden = true;
  composer.append(h("div", { class: "composer-field" }, input, sendButton), interruptButton);

  const notice = h("p", { class: "form-note composer-note", role: "status" });
  notice.hidden = true;
  element.append(sessionBar, transcript, notice, composer);

  let stickToBottom = true;
  const scrollToBottom = (): void => {
    transcript.scrollTop = transcript.scrollHeight;
  };
  transcript.addEventListener("scroll", () => {
    stickToBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
  });

  const showError = (key: "common.error" | "conversation.sendFailed", error: unknown): void => {
    notice.textContent = translate(language, key, {
      message: error instanceof Error ? error.message : String(error),
    });
    notice.hidden = false;
  };

  const submit = (text: string): void => {
    sendButton.disabled = true;
    stickToBottom = true;
    void app
      .sendMessage(text)
      .then(() => {
        notice.hidden = true;
      })
      .catch((error: unknown) => showError("conversation.sendFailed", error))
      .finally(() => {
        sendButton.disabled = false;
      });
  };

  const context: ConversationContext = {
    app,
    language,
    goToApprovals,
    resend: (text, localId) => {
      app.discardLocalEntry(localId);
      submit(text);
    },
  };

  interruptButton.addEventListener("click", () => {
    interruptButton.disabled = true;
    void app
      .interrupt()
      .catch((error: unknown) => showError("common.error", error))
      .finally(() => {
        interruptButton.disabled = false;
      });
  });

  const resizeInput = (): void => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  };

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    resizeInput();
    submit(text);
  });

  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    // 中文輸入法選字時的 Enter 不送出。
    if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey && !keyboardEvent.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  let lastSessionSignature = "";
  let lastTranscriptSignature = "";
  let streamingText: HTMLElement | null = null;

  return {
    element,
    update() {
      // 會話列和逐字稿分開判斷：建立或切換會話時逐字稿可能沒變，
      // 但會話列一定要跟著更新。
      const sessionSignature = sessionBarSignature(app);
      if (sessionSignature !== lastSessionSignature) {
        lastSessionSignature = sessionSignature;
        renderSessionBar(sessionBar, context);
      }
      const hasSession = Boolean(app.currentSessionId);
      input.disabled = !hasSession;

      const busy = app.activeTurn?.state === "running" || app.activeTurn?.state === "queued";
      interruptButton.hidden = !busy;

      const signature = transcriptSignature(app);
      if (signature === lastTranscriptSignature) {
        if (streamingText && app.streaming) {
          streamingText.textContent = app.streaming.text;
          if (stickToBottom) scrollToBottom();
        }
        return;
      }
      lastTranscriptSignature = signature;
      streamingText = renderTranscript(transcript, context);
      if (stickToBottom) scrollToBottom();
    },
  };
}

/** 會話列的內容：清單順序、標題與目前選取的會話。 */
function sessionBarSignature(app: RemoteApp): string {
  return JSON.stringify([
    app.sessions.map((session) => [session.id, session.title]),
    app.currentSessionId,
  ]);
}

/**
 * 只有逐字稿的結構變了才重建 DOM；串流中的文字長度不算結構，
 * 由呼叫端直接改文字節點。這樣每個 token 不會重建整個列表、也不會丟焦點。
 */
function transcriptSignature(app: RemoteApp): string {
  const failed = app.failedLocalIds ?? new Set<string>();
  const parts = app.entries.map((entry) => {
    if (entry.role === "tool") return `t:${entry.toolCallId}:${entry.status}`;
    const length = entry.role === "assistant" ? entry.text.length : 0;
    const flag = failed.has(entry.id) ? "!" : "";
    return `${entry.role}:${entry.id}:${entry.turnId}:${length}${flag}`;
  });
  return [
    parts.join("|"),
    app.currentSessionId ?? "",
    app.streaming?.messageId ?? "",
    app.pendingApproval?.approvalId ?? "",
    app.transcriptError ?? "",
    app.activeTurn
      ? `${app.activeTurn.turnId}:${app.activeTurn.state}:${app.activeTurn.error?.message ?? ""}`
      : "",
  ].join(";");
}

function renderSessionBar(bar: HTMLElement, context: ConversationContext): void {
  const { app, language } = context;
  const select = h("select", {
    class: "session-select",
    "aria-label": translate(language, "conversation.sessionLabel"),
  });
  select.append(h("option", { value: "", text: translate(language, "conversation.sessionLabel") }));
  for (const session of app.sessions) {
    const option = h("option", { value: session.id, text: session.title || session.id });
    option.selected = session.id === app.currentSessionId;
    select.append(option);
  }
  select.addEventListener("change", () => {
    if (select.value) void app.selectSession(select.value);
  });

  const newButton = h("button", {
    class: "button button-quiet new-session",
    type: "button",
    text: translate(language, "conversation.newSession"),
  });
  newButton.addEventListener("click", () => {
    newButton.disabled = true;
    void app.createSession().finally(() => {
      newButton.disabled = false;
    });
  });

  replaceChildren(bar, select, newButton);
}

function renderTranscript(
  container: HTMLElement,
  context: ConversationContext,
): HTMLElement | null {
  const { app, language } = context;
  const children: (Node | null)[] = [];
  let streamingText: HTMLElement | null = null;

  if (app.transcriptError) {
    children.push(h("p", { class: "form-error", text: app.transcriptError }));
  }
  if (!app.currentSessionId) {
    children.push(h("p", { class: "empty", text: translate(language, "conversation.noSession") }));
  } else if (app.entries.length === 0 && !app.streaming) {
    children.push(h("p", { class: "empty", text: translate(language, "conversation.empty") }));
  }
  const failed = app.failedLocalIds ?? new Set<string>();
  for (const entry of app.entries) {
    children.push(renderEntry(entry, context, failed.has(entry.id)));
  }
  if (app.streaming) {
    streamingText = h("p", { class: "message-text stream-text" }, app.streaming.text);
    children.push(
      h(
        "div",
        { class: "message message-assistant is-streaming" },
        h("span", { class: "message-meta", text: translate(language, "conversation.replying") }),
        streamingText,
      ),
    );
  } else if (app.activeTurn?.state === "running" || app.activeTurn?.state === "queued") {
    children.push(
      h(
        "p",
        {
          class: "typing",
          role: "status",
          "aria-label": translate(language, "conversation.replying"),
        },
        h("span", { class: "typing-dot" }),
        h("span", { class: "typing-dot" }),
        h("span", { class: "typing-dot" }),
      ),
    );
  }
  if (app.activeTurn?.state === "failed" && app.activeTurn.error) {
    children.push(
      h("p", {
        class: "form-error",
        text: translate(language, "conversation.turnFailed", {
          message: app.activeTurn.error.message,
        }),
      }),
    );
  } else if (app.activeTurn?.state === "interrupted") {
    children.push(
      h("p", { class: "turn-note", text: translate(language, "conversation.turnInterrupted") }),
    );
  }

  if (app.pendingApproval) {
    const go = h("button", {
      class: "link-button",
      type: "button",
      text: translate(language, "conversation.approvalGo"),
    });
    go.addEventListener("click", context.goToApprovals);
    children.push(
      h(
        "div",
        { class: "inline-notice" },
        h(
          "div",
          { class: "inline-notice-head" },
          h("span", { text: translate(language, "conversation.approvalPending") }),
          go,
        ),
        renderApprovalCard(app, language, app.pendingApproval, { compact: true }),
      ),
    );
  }

  replaceChildren(container, ...children);
  return streamingText;
}

function renderEntry(
  entry: TranscriptEntry,
  context: ConversationContext,
  failed: boolean,
): HTMLElement {
  const { language } = context;
  if (entry.role === "user") return renderUserEntry(entry, context, failed);
  if (entry.role === "tool") return renderToolEntry(entry, language);
  const text = h("div", { class: "message-text" });
  renderMarkdown(text, entry.text);
  return h(
    "div",
    {
      class:
        entry.status === "streaming"
          ? "message message-assistant is-streaming"
          : "message message-assistant",
    },
    h("time", {
      class: "message-meta",
      datetime: entry.createdAt,
      text: formatTime(entry.createdAt, language),
    }),
    text,
  );
}

function renderUserEntry(
  entry: UserTranscriptEntry,
  context: ConversationContext,
  failed: boolean,
): HTMLElement {
  const { language } = context;
  const message = h(
    "div",
    { class: failed ? "message message-user is-failed" : "message message-user" },
    h("p", { class: "message-text" }, entry.text),
  );
  if (failed) {
    const retry = h("button", {
      class: "link-button",
      type: "button",
      text: translate(language, "conversation.retry"),
    });
    retry.addEventListener("click", () => context.resend(entry.text, entry.id));
    const discard = h("button", {
      class: "link-button",
      type: "button",
      text: translate(language, "conversation.discard"),
    });
    discard.addEventListener("click", () => context.app.discardLocalEntry(entry.id));
    message.append(
      h(
        "div",
        { class: "message-failed" },
        h("span", { text: translate(language, "conversation.notSent") }),
        retry,
        discard,
      ),
    );
  }
  return message;
}

function renderToolEntry(entry: ToolTranscriptEntry, language: Language): HTMLElement {
  const statusKey =
    entry.status === "complete"
      ? "conversation.toolStatus.ok"
      : entry.status === "failed"
        ? "conversation.toolStatus.error"
        : "conversation.toolStatus.streaming";
  const details = h("details", { class: `message message-tool tool-${entry.status}` });
  details.append(
    h(
      "summary",
      { class: "tool-summary" },
      h("span", { class: "tool-dot", "aria-hidden": "true" }),
      h("span", { class: "tool-name" }, entry.name),
      h("span", { class: "tool-status", text: translate(language, statusKey) }),
    ),
  );
  const body = h("div", { class: "tool-body" });
  body.append(
    h("span", { class: "tool-label", text: translate(language, "conversation.toolInput") }),
    h("pre", { class: "code-block tool-input" }, safeStringify(entry.input)),
  );
  if (entry.output?.text) {
    body.append(
      h("span", { class: "tool-label", text: translate(language, "conversation.toolOutput") }),
      h("pre", { class: "code-block tool-output" }, entry.output.text),
    );
  }
  if (entry.output?.truncated) {
    body.append(
      h("p", { class: "form-hint", text: translate(language, "conversation.truncated") }),
    );
  }
  details.append(body);
  return details;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
