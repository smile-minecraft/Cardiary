/**
 * 對話畫面：會話切換、逐字稿（含工具呼叫）、串流文字、中斷與送出。
 *
 * 每一則內容都用 textContent 建立，工具輸入與輸出只顯示成純文字，不轉成 HTML。
 */

import type { ToolTranscriptEntry, TranscriptEntry } from "@cardiary/protocol";

import { translate, type Language } from "../i18n";
import { formatTime, h, replaceChildren } from "../lib/dom";
import type { RemoteApp } from "../state/remote-app";

interface ConversationContext {
  language: Language;
  app: RemoteApp;
  goToApprovals: () => void;
}

export interface ConversationView {
  readonly element: HTMLElement;
  update(): void;
}

export function createConversationView(
  app: RemoteApp,
  language: Language,
  goToApprovals: () => void,
): ConversationView {
  const context: ConversationContext = { app, language, goToApprovals };
  const element = h("section", { class: "panel conversation-panel" });

  const sessionBar = h("div", { class: "session-bar" });
  const transcript = h("div", { class: "transcript" });
  const composer = h("form", { class: "composer" });

  const input = h("textarea", {
    class: "input message-input",
    rows: "2",
    placeholder: translate(language, "conversation.inputPlaceholder"),
    "aria-label": translate(language, "conversation.send"),
  });
  const sendButton = h("button", {
    class: "button button-primary",
    type: "submit",
    text: translate(language, "conversation.send"),
  });
  const interruptButton = h("button", {
    class: "button button-danger",
    type: "button",
    text: translate(language, "conversation.interrupt"),
  });
  const composerButtons = h("div", { class: "button-row" }, interruptButton, sendButton);
  composer.append(input, composerButtons);

  const notice = h("p", { class: "form-note" });
  notice.hidden = true;
  element.append(sessionBar, transcript, notice, composer);

  interruptButton.addEventListener("click", () => {
    interruptButton.disabled = true;
    void app
      .interrupt()
      .catch((error: unknown) => {
        notice.textContent = translate(language, "common.error", {
          message: error instanceof Error ? error.message : String(error),
        });
        notice.hidden = false;
      })
      .finally(() => {
        interruptButton.disabled = false;
      });
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendButton.disabled = true;
    void app
      .sendMessage(text)
      .then(() => {
        input.value = "";
        notice.hidden = true;
      })
      .catch((error: unknown) => {
        notice.textContent = translate(language, "conversation.sendFailed", {
          message: error instanceof Error ? error.message : String(error),
        });
        notice.hidden = false;
      })
      .finally(() => {
        sendButton.disabled = false;
      });
  });

  input.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  let lastSignature = "";
  let streamingText: HTMLElement | null = null;

  return {
    element,
    update() {
      const signature = transcriptSignature(app);
      if (signature === lastSignature) {
        if (streamingText && app.streaming) streamingText.textContent = app.streaming.text;
        return;
      }
      lastSignature = signature;
      const wasAtBottom =
        transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
      renderSessionBar(sessionBar, context);
      streamingText = renderTranscript(transcript, context);
      const busy = app.activeTurn?.state === "running" || app.activeTurn?.state === "queued";
      interruptButton.disabled = !busy;
      if (wasAtBottom) transcript.scrollTop = transcript.scrollHeight;
    },
  };
}

/**
 * 只有逐字稿的結構變了才重建 DOM；串流中的文字長度不算結構，
 * 由呼叫端直接改文字節點。這樣每個 token 不會重建整個列表、也不會丟焦點。
 */
function transcriptSignature(app: RemoteApp): string {
  const parts = app.entries.map((entry) => {
    if (entry.role === "tool") return `t:${entry.toolCallId}:${entry.status}`;
    const length = entry.role === "assistant" ? entry.text.length : 0;
    return `${entry.role}:${entry.id}:${entry.turnId}:${length}`;
  });
  return [
    parts.join("|"),
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
    class: "input session-select",
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
    class: "button button-quiet",
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

  if (app.pendingApproval) {
    const go = h("button", {
      class: "button button-quiet",
      type: "button",
      text: translate(language, "conversation.approvalGo"),
    });
    go.addEventListener("click", context.goToApprovals);
    children.push(
      h(
        "div",
        { class: "inline-notice" },
        h("span", { text: translate(language, "conversation.approvalPending") }),
        go,
      ),
    );
  }
  if (app.transcriptError) {
    children.push(h("p", { class: "form-error", text: app.transcriptError }));
  }
  if (app.entries.length === 0 && !app.streaming) {
    children.push(h("p", { class: "empty", text: translate(language, "conversation.empty") }));
  }
  for (const entry of app.entries) {
    children.push(renderEntry(entry, language));
  }
  if (app.streaming) {
    const stream = h("div", { class: "message message-assistant is-streaming" });
    stream.append(h("span", { class: "role" }, "Cardiary"));
    streamingText = h("p", { class: "message-text" }, app.streaming.text);
    stream.append(streamingText);
    children.push(stream);
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
      h("p", { class: "muted", text: translate(language, "conversation.turnInterrupted") }),
    );
  }

  replaceChildren(container, ...children);
  return streamingText;
}

function renderEntry(entry: TranscriptEntry, language: Language): HTMLElement {
  if (entry.role === "user") {
    return h(
      "div",
      { class: "message message-user" },
      h("span", { class: "role" }, formatTime(entry.createdAt, language)),
      h("p", { class: "message-text" }, entry.text),
    );
  }
  if (entry.role === "tool") {
    return renderToolEntry(entry, language);
  }
  return h(
    "div",
    {
      class:
        entry.status === "streaming"
          ? "message message-assistant is-streaming"
          : "message message-assistant",
    },
    h("span", { class: "role" }, formatTime(entry.createdAt, language)),
    h("p", { class: "message-text" }, entry.text),
  );
}

function renderToolEntry(entry: ToolTranscriptEntry, language: Language): HTMLElement {
  const card = h("div", { class: "message message-tool" });
  const status =
    entry.status === "complete"
      ? translate(language, "conversation.toolStatus.ok")
      : entry.status === "failed"
        ? translate(language, "conversation.toolStatus.error")
        : translate(language, "conversation.toolStatus.streaming");
  card.append(
    h(
      "div",
      { class: "meta-row" },
      h(
        "span",
        { class: "badge" },
        `${translate(language, "conversation.toolCall")}: ${entry.name}`,
      ),
      h("span", { class: "muted", text: status }),
    ),
  );
  card.append(h("pre", { class: "code-block" }, safeStringify(entry.input)));
  if (entry.output?.text) {
    card.append(h("pre", { class: "code-block" }, entry.output.text));
  }
  if (entry.output?.truncated) {
    card.append(
      h("p", { class: "form-hint", text: translate(language, "conversation.truncated") }),
    );
  }
  return card;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
