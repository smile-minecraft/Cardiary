import type { ApprovalRequest } from "@cardiary/protocol";

import { translate, type Language, type MessageKey } from "../i18n";
import { formatTime, h, replaceChildren } from "../lib/dom";
import type { RemoteApp } from "../state/remote-app";

export function renderApprovals(app: RemoteApp, language: Language): HTMLElement {
  const pending = [...app.approvals].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const section = h("section", { class: "panel" });
  section.append(
    h(
      "header",
      { class: "panel-header" },
      h("h1", { text: translate(language, "approvals.title") }),
    ),
  );

  if (pending.length === 0) {
    section.append(h("p", { class: "empty", text: translate(language, "approvals.empty") }));
    return section;
  }

  const list = h("div", { class: "list" });
  for (const request of pending) {
    list.append(renderApprovalCard(app, language, request));
  }
  section.append(list);
  return section;
}

function renderApprovalCard(
  app: RemoteApp,
  language: Language,
  request: ApprovalRequest,
): HTMLElement {
  const card = h("article", { class: "card approval-card" });
  const title = h("h2", { class: "card-title" }, request.title);
  card.append(title);

  card.append(
    h(
      "div",
      { class: "meta-row" },
      h("span", {
        class: "badge",
        text: translate(language, `approvals.scope.${request.scope.kind}` as MessageKey),
      }),
      h("span", {
        class: "muted",
        text: translate(language, "approvals.requestedAt", {
          time: formatTime(request.requestedAt, language),
        }),
      }),
    ),
  );

  if (request.summary) {
    card.append(h("pre", { class: "code-block" }, request.summary));
  }
  if (request.scope.detail !== undefined) {
    card.append(h("pre", { class: "code-block" }, safeStringify(request.scope.detail)));
  }

  const buttons = h("div", { class: "button-row" });
  const decide = async (effect: "approve" | "reject" | "approve_always") => {
    for (const button of buttons.querySelectorAll("button")) {
      button.disabled = true;
    }
    try {
      await app.decideApproval(request, effect);
    } catch (error) {
      const note = h("p", {
        class: "form-error",
        text: translate(language, "approvals.decideFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      });
      card.append(note);
      for (const button of buttons.querySelectorAll("button")) {
        button.disabled = false;
      }
    }
  };

  for (const option of request.options) {
    const labelKey: MessageKey =
      option.effect === "approve"
        ? "approvals.approve"
        : option.effect === "reject"
          ? "approvals.reject"
          : "approvals.approveAlways";
    buttons.append(
      h("button", {
        class: option.effect === "reject" ? "button button-danger" : "button button-primary",
        type: "button",
        text: option.label || translate(language, labelKey),
        on: { click: () => void decide(option.effect) },
      }),
    );
  }
  card.append(buttons);
  return card;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 更新整個畫面（由 app.subscribe 觸發）。 */
/** 建立畫面容器；每次 update 都重建內容以反映最新狀態。 */
export function createApprovalsScreen(
  app: RemoteApp,
  getLanguage: () => Language,
): { readonly element: HTMLElement; update(): void } {
  const element = h("div", { class: "screen" });
  return {
    element,
    update() {
      updateApprovalsScreen(element, app, getLanguage());
    },
  };
}

export function updateApprovalsScreen(
  container: HTMLElement,
  app: RemoteApp,
  language: Language,
): void {
  replaceChildren(container, renderApprovals(app, language));
}
