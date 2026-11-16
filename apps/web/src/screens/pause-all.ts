import { translate, type Language } from "../i18n";
import { h, replaceChildren } from "../lib/dom";
import type { RemoteApp } from "../state/remote-app";

export function renderPauseAll(app: RemoteApp, language: Language): HTMLElement {
  const section = h("section", { class: "panel" });
  section.append(
    h("header", { class: "panel-header" }, h("h1", { text: translate(language, "pause.title") })),
  );
  section.append(h("p", { class: "lead", text: translate(language, "pause.description") }));

  const danger = h("div", { class: "danger-zone" });
  danger.append(h("p", { class: "warning", text: translate(language, "pause.warning") }));

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

  const notice = h("p", { class: "form-note" });
  notice.hidden = true;

  button.addEventListener("click", () => {
    if (!confirming) {
      confirming = true;
      button.textContent = translate(language, "pause.confirm");
      cancel.hidden = false;
      return;
    }
    confirming = false;
    button.disabled = true;
    cancel.hidden = true;
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
  cancel.addEventListener("click", () => {
    confirming = false;
    cancel.hidden = true;
    button.textContent = translate(language, "pause.button");
  });

  danger.append(h("div", { class: "button-row" }, button, cancel), notice);
  section.append(danger);
  return section;
}

/** 建立畫面容器；每次 update 都重建內容以反映最新狀態。 */
export function createPauseAllScreen(
  app: RemoteApp,
  getLanguage: () => Language,
): { readonly element: HTMLElement; update(): void } {
  const element = h("div", { class: "screen" });
  return {
    element,
    update() {
      updatePauseAllScreen(element, app, getLanguage());
    },
  };
}

export function updatePauseAllScreen(
  container: HTMLElement,
  app: RemoteApp,
  language: Language,
): void {
  replaceChildren(container, renderPauseAll(app, language));
}
