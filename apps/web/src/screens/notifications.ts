import type { CardiaryNotification } from "@cardiary/protocol";

import { translate, type Language, type MessageKey } from "../i18n";
import { formatTime, h, replaceChildren } from "../lib/dom";
import type { RemoteApp } from "../state/remote-app";

export function renderNotifications(app: RemoteApp, language: Language): HTMLElement {
  const section = h("section", { class: "panel" });
  const header = h(
    "header",
    { class: "panel-header" },
    h("h1", { text: translate(language, "notifications.title") }),
  );
  if (app.totalUnread > 0) {
    header.append(
      h("span", {
        class: "badge badge-accent",
        text: translate(language, "notifications.unread", { count: app.totalUnread }),
      }),
    );
  }
  if (app.notifications.length > 0 && app.totalUnread > 0) {
    header.append(
      h("button", {
        class: "button button-quiet",
        type: "button",
        text: translate(language, "notifications.markAllRead"),
        on: {
          click: () => {
            void app.markNotificationsRead("all").catch(showActionError(section, language));
          },
        },
      }),
    );
  }
  section.append(header);

  if (app.notifications.length === 0) {
    section.append(h("p", { class: "empty", text: translate(language, "notifications.empty") }));
    return section;
  }

  const list = h("div", { class: "list" });
  for (const notification of app.notifications) {
    list.append(renderNotificationCard(app, language, notification));
  }
  section.append(list);
  return section;
}

function renderNotificationCard(
  app: RemoteApp,
  language: Language,
  notification: CardiaryNotification,
): HTMLElement {
  const card = h("article", {
    class: notification.readAt ? "card notification-card is-read" : "card notification-card",
  });
  card.append(
    h(
      "div",
      { class: "meta-row" },
      h("span", {
        class: "badge",
        text: translate(language, `notifications.kind.${notification.kind}` as MessageKey),
      }),
      h("span", { class: "muted", text: formatTime(notification.createdAt, language) }),
      ...(notification.readAt
        ? []
        : [
            h("span", {
              class: "unread-dot",
              title: translate(language, "notifications.unread", { count: 1 }),
            }),
          ]),
    ),
  );
  card.append(h("h2", { class: "card-title" }, notification.title));
  // 內文是 Markdown，但依協定不能直接渲染原始 HTML；純文字顯示最安全。
  card.append(h("p", { class: "notification-body" }, notification.body));

  const buttons = h("div", { class: "button-row" });
  if (!notification.readAt) {
    buttons.append(
      h("button", {
        class: "button button-quiet",
        type: "button",
        text: translate(language, "notifications.markRead"),
        on: {
          click: () => {
            void app
              .markNotificationsRead([notification.notificationId])
              .catch(showActionError(card, language));
          },
        },
      }),
    );
  }
  // 網頁只負責對話、通知、審批與緊急暫停；把通知轉成卡片屬於 macOS 應用程式的範圍。
  if (buttons.childElementCount > 0) card.append(buttons);
  return card;
}

function showActionError(container: HTMLElement, language: Language) {
  return (error: unknown): void => {
    container.append(
      h("p", {
        class: "form-error",
        text: translate(language, "notifications.actionFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      }),
    );
  };
}

/** 建立畫面容器；每次 update 都重建內容以反映最新狀態。 */
export function createNotificationsScreen(
  app: RemoteApp,
  getLanguage: () => Language,
): { readonly element: HTMLElement; update(): void } {
  const element = h("div", { class: "screen" });
  return {
    element,
    update() {
      updateNotificationsScreen(element, app, getLanguage());
    },
  };
}

export function updateNotificationsScreen(
  container: HTMLElement,
  app: RemoteApp,
  language: Language,
): void {
  replaceChildren(container, renderNotifications(app, language));
}
