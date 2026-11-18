/**
 * 審批：每一則等你決定的請求是一張「發到桌上」的卡。
 *
 * 同一張卡也嵌在對話畫面裡（`compact`），人在對話中就能直接決定，
 * 不必切到審批頁。
 */

import type { ApprovalRequest } from "@cardiary/protocol";

import { translate, type Language, type MessageKey } from "../i18n";
import { formatTime, h, replaceChildren } from "../lib/dom";
import type { RemoteApp } from "../state/remote-app";

type Effect = "approve" | "reject" | "approve_always";

/** 按鈕的視覺順序：拒絕在左、核准在右（拇指最順手的位置）。 */
const EFFECT_ORDER: Record<Effect, number> = { reject: 0, approve_always: 1, approve: 2 };

export function renderApprovals(app: RemoteApp, language: Language): HTMLElement {
  const pending = [...app.approvals].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const section = h("section", { class: "panel" });
  const header = h(
    "header",
    { class: "panel-header" },
    h("h1", { text: translate(language, "approvals.title") }),
  );
  if (pending.length > 0) {
    header.append(
      h("span", {
        class: "count-pill",
        text: translate(language, "approvals.waiting", { count: pending.length }),
      }),
    );
  }
  section.append(header);

  if (pending.length === 0) {
    section.append(h("p", { class: "empty", text: translate(language, "approvals.empty") }));
    return section;
  }

  const list = h("div", { class: "deck" });
  for (const request of pending) {
    list.append(renderApprovalCard(app, language, request));
  }
  section.append(list);
  return section;
}

export function renderApprovalCard(
  app: RemoteApp,
  language: Language,
  request: ApprovalRequest,
  options: { readonly compact?: boolean } = {},
): HTMLElement {
  const card = h("article", {
    class: options.compact ? "approval-card is-compact" : "approval-card",
  });
  card.append(
    h(
      "div",
      { class: "approval-meta" },
      h("span", {
        class: "scope-tag",
        text: translate(language, `approvals.scope.${request.scope.kind}` as MessageKey),
      }),
      h("time", {
        datetime: request.requestedAt,
        text: translate(language, "approvals.requestedAt", {
          time: formatTime(request.requestedAt, language),
        }),
      }),
    ),
    h("h2", { class: "approval-title" }, request.title),
  );

  if (request.summary) {
    card.append(h("p", { class: "approval-summary" }, request.summary));
  }
  if (request.scope.detail !== undefined) {
    card.append(
      h(
        "details",
        { class: "approval-detail" },
        h("summary", { text: translate(language, "approvals.detail") }),
        h("pre", { class: "code-block" }, safeStringify(request.scope.detail)),
      ),
    );
  }

  const buttons = h("div", { class: "approval-actions" });
  const error = h("p", { class: "form-error", role: "alert" });
  error.hidden = true;
  const setDisabled = (disabled: boolean): void => {
    for (const button of buttons.querySelectorAll("button")) button.disabled = disabled;
  };
  const decide = async (effect: Effect): Promise<void> => {
    setDisabled(true);
    error.hidden = true;
    try {
      await app.decideApproval(request, effect);
    } catch (failure) {
      error.textContent = translate(language, "approvals.decideFailed", {
        message: failure instanceof Error ? failure.message : String(failure),
      });
      error.hidden = false;
      setDisabled(false);
    }
  };

  const ordered = [...request.options].sort(
    (a, b) => EFFECT_ORDER[a.effect as Effect] - EFFECT_ORDER[b.effect as Effect],
  );
  for (const option of ordered) {
    const effect = option.effect as Effect;
    const labelKey: MessageKey =
      effect === "approve"
        ? "approvals.approve"
        : effect === "reject"
          ? "approvals.reject"
          : "approvals.approveAlways";
    const variant =
      effect === "approve"
        ? "button button-primary"
        : effect === "reject"
          ? "button button-reject"
          : "button button-quiet";
    buttons.append(
      h("button", {
        class: variant,
        type: "button",
        text: option.label || translate(language, labelKey),
        on: { click: () => void decide(effect) },
      }),
    );
  }
  card.append(buttons, error);
  return card;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 建立畫面容器；每次 update 都重建內容以反映最新狀態。 */
export function createApprovalsScreen(
  app: RemoteApp,
  getLanguage: () => Language,
): { readonly element: HTMLElement; update(): void } {
  const element = h("div", { class: "screen" });
  let lastSignature = "";
  return {
    element,
    update() {
      // 串流期間每個 token 都會通知一次；審批沒變就不重建，按鈕狀態與
      // 發牌動畫才不會被打斷。
      const language = getLanguage();
      const signature = [language, ...app.approvals.map((approval) => approval.approvalId)].join(
        "|",
      );
      if (signature === lastSignature && element.childElementCount > 0) return;
      lastSignature = signature;
      updateApprovalsScreen(element, app, language);
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
