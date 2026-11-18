import { translate, type Language } from "../i18n";
import { h } from "../lib/dom";
import type { RemoteApp } from "../state/remote-app";

/**
 * 緊急全部暫停。
 *
 * 畫面只建一次：按第一下進入確認後，串流中的狀態通知不能把確認狀態重設掉。
 * 「目前在跑什麼」那一行在每次 update 時更新。
 */
export function createPauseAllScreen(
  app: RemoteApp,
  getLanguage: () => Language,
): { readonly element: HTMLElement; update(): void } {
  const language = getLanguage();
  const element = h("div", { class: "screen" });
  const section = h("section", { class: "panel" });
  section.append(
    h("header", { class: "panel-header" }, h("h1", { text: translate(language, "pause.title") })),
    h("p", { class: "lead", text: translate(language, "pause.description") }),
  );

  const activity = h("p", { class: "pause-activity", role: "status" });
  const danger = h("div", { class: "danger-zone" });
  danger.append(h("p", { class: "warning", text: translate(language, "pause.warning") }), activity);

  let confirming = false;
  const button = h("button", {
    class: "button button-danger button-large",
    type: "button",
    text: translate(language, "pause.button"),
  });
  const cancel = h("button", {
    class: "button button-quiet",
    type: "button",
    text: translate(language, "pause.cancelConfirm"),
  });
  cancel.hidden = true;

  const notice = h("p", { class: "form-note", role: "status" });
  notice.hidden = true;

  const resetButton = (): void => {
    confirming = false;
    cancel.hidden = true;
    button.textContent = translate(language, "pause.button");
    button.setAttribute("class", "button button-danger button-large");
  };

  button.addEventListener("click", () => {
    if (!confirming) {
      confirming = true;
      button.textContent = translate(language, "pause.confirm");
      button.setAttribute("class", "button button-danger button-large is-armed");
      cancel.hidden = false;
      return;
    }
    resetButton();
    button.disabled = true;
    button.textContent = translate(language, "pause.sending");
    void app
      .pauseAll()
      .then((result) => {
        notice.textContent = translate(language, "pause.done", {
          count: result.interruptedSessionIds.length,
        });
        notice.hidden = false;
      })
      .catch((error: unknown) => {
        notice.textContent = translate(language, "pause.failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        notice.hidden = false;
      })
      .finally(() => {
        button.disabled = false;
        button.textContent = translate(language, "pause.button");
      });
  });
  cancel.addEventListener("click", resetButton);

  danger.append(h("div", { class: "pause-actions" }, button, cancel), notice);
  section.append(danger);
  element.append(section);

  return {
    element,
    update() {
      const running = app.sessions.filter(
        (session) => session.status === "running" || session.status === "waiting_approval",
      ).length;
      activity.textContent = translate(language, "pause.activity", {
        running,
        approvals: app.approvals.length,
      });
    },
  };
}
