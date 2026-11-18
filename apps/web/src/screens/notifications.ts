import type { CardiaryNotification } from "@cardiary/protocol";

import { translate, type Language, type MessageKey } from "../i18n";
import { formatTime, h, replaceChildren } from "../lib/dom";
import { renderMarkdown } from "../lib/markdown";
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
        class: "count-pill",
        text: translate(language, "notifications.unread", { count: app.totalUnread }),
      }),
    );
  }
  if (app.notifications.length > 0 && app.totalUnread > 0) {
    header.append(
      h("button", {
        class: "link-button header-action",
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

  const list = h("ol", { class: "feed" });
  for (const notification of app.notifications) {
    list.append(renderNotificationItem(app, language, notification));
  }
  section.append(list);
  return section;
}

function renderNotificationItem(
  app: RemoteApp,
  language: Language,
  notification: CardiaryNotification,
): HTMLElement {
  const item = h("li", {
    class: notification.readAt
      ? "feed-item notification-card is-read"
      : "feed-item notification-card",
  });
  item.append(
    h(
      "div",
      { class: "feed-meta" },
      h("span", {
        class: `kind-tag kind-${notification.kind}`,
        text: translate(language, `notifications.kind.${notification.kind}` as MessageKey),
      }),
      h("time", {
        datetime: notification.createdAt,
        text: formatTime(notification.createdAt, language),
      }),
    ),
  );
  item.append(h("h2", { class: "feed-title" }, notification.title));
  // 內文是 Markdown；只轉成安全的 DOM 節點，不渲染原始 HTML。
  const body = h("div", { class: "feed-body" });
  renderMarkdown(body, notification.body);
  item.append(body);

  if (!notification.readAt) {
    item.append(
      h("button", {
        class: "link-button",
        type: "button",
        text: translate(language, "notifications.markRead"),
        on: {
          click: () => {
            void app
              .markNotificationsRead([notification.notificationId])
              .catch(showActionError(item, language));
          },
        },
      }),
    );
  }
  // 網頁只負責對話、通知、審批與緊急暫停；把通知轉成卡片屬於 macOS 應用程式的範圍。
  return item;
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

/** 建立畫面容器；通知或語言變了才重建，串流中的 token 不會觸發重繪。 */
export function createNotificationsScreen(
  app: RemoteApp,
  getLanguage: () => Language,
): { readonly element: HTMLElement; update(): void } {
  const element = h("div", { class: "screen" });
  let lastSignature = "";
  return {
    element,
    update() {
      const language = getLanguage();
      const signature = JSON.stringify([
        language,
        app.totalUnread,
        app.notifications.map((notification) => [
          notification.notificationId,
          notification.readAt ?? "",
        ]),
      ]);
      if (signature === lastSignature && element.childElementCount > 0) return;
      lastSignature = signature;
      updateNotificationsScreen(element, app, language);
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
