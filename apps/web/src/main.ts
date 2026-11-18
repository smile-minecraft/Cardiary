import "./style.css";

import { loadLanguage, saveLanguage, translate, type Language } from "./i18n";
import { h, replaceChildren } from "./lib/dom";
import { createApprovalsScreen } from "./screens/approvals";
import { createConversationView } from "./screens/conversation";
import { headerStatus } from "./screens/header-status";
import { createNotificationsScreen } from "./screens/notifications";
import { createPairingView } from "./screens/pairing";
import { createPauseAllScreen } from "./screens/pause-all";
import { RemoteApp } from "./state/remote-app";

type Route = "conversation" | "notifications" | "approvals" | "pause-all";

const ROUTES: Route[] = ["conversation", "notifications", "approvals", "pause-all"];

function routeFromHash(): Route {
  const raw = globalThis.location?.hash.replace(/^#\/?/, "") ?? "";
  return ROUTES.find((route) => route === raw) ?? "conversation";
}

const root = document.getElementById("app");
if (!root) throw new Error("找不到 #app");

let language: Language = loadLanguage();
let route = routeFromHash();
const app = new RemoteApp({ clientVersion: "0.1.0" });

const header = h("header", { class: "app-header" });
const nav = h("nav", { class: "nav" });
const main = h("main", { class: "main" });
replaceChildren(root, header, nav, main);

function createViews(): void {
  conversationView = createConversationView(app, language, () => {
    globalThis.location.hash = "#/approvals";
  });
  notificationsView = createNotificationsScreen(app, () => language);
  approvalsView = createApprovalsScreen(app, () => language);
  pauseView = createPauseAllScreen(app, () => language);
}

let conversationView: ReturnType<typeof createConversationView>;
let notificationsView: ReturnType<typeof createNotificationsScreen>;
let approvalsView: ReturnType<typeof createApprovalsScreen>;
let pauseView: ReturnType<typeof createPauseAllScreen>;
let pairingView: ReturnType<typeof createPairingView> | null = null;
let pairingKey = "";
createViews();

function setLanguage(next: Language): void {
  language = next;
  saveLanguage(next);
  document.documentElement.lang = next === "zh-TW" ? "zh-Hant" : "en";
  pairingView?.dispose();
  pairingView = null;
  pairingKey = "";
  createViews();
  render();
}

function renderHeader(): void {
  const langButton = h("button", {
    class: "button button-quiet lang-button",
    type: "button",
    text: translate(language, "lang.toggle"),
    title: translate(language, "lang.toggleLabel"),
    "aria-label": translate(language, "lang.toggleLabel"),
    on: {
      click: () => setLanguage(language === "zh-TW" ? "en" : "zh-TW"),
    },
  });
  const status = headerStatus(app, language);
  const logoutButton = h("button", {
    class: "button button-quiet",
    type: "button",
    text: translate(language, "logout.button"),
    title: translate(language, "logout.confirm"),
    on: {
      click: () => {
        if (globalThis.confirm(translate(language, "logout.confirm"))) app.logout();
      },
    },
  });
  replaceChildren(
    header,
    h(
      "div",
      { class: "brand" },
      h("img", { class: "brand-mark", src: "/favicon.svg", alt: "" }),
      h("strong", { text: translate(language, "app.title") }),
    ),
    h(
      "div",
      { class: "header-actions" },
      h("span", {
        class: status.dotClass,
        title: status.label,
        "aria-label": status.label,
      }),
      h("span", { class: "connection-label", text: status.label }),
      app.needsPairing ? null : logoutButton,
      langButton,
    ),
  );
}

function renderNav(): void {
  const items: Array<{
    route: Route;
    key: "nav.conversation" | "nav.notifications" | "nav.approvals" | "nav.pauseAll";
    hash: string;
    badge?: number;
  }> = [
    { route: "conversation", key: "nav.conversation", hash: "#/conversation" },
    {
      route: "notifications",
      key: "nav.notifications",
      hash: "#/notifications",
      badge: app.totalUnread,
    },
    { route: "approvals", key: "nav.approvals", hash: "#/approvals", badge: app.approvals.length },
    { route: "pause-all", key: "nav.pauseAll", hash: "#/pause-all" },
  ];
  const links = items.map((item) => {
    const link = h("a", {
      class: route === item.route ? "nav-item is-active" : "nav-item",
      href: item.hash,
      text: translate(language, item.key),
      "aria-current": route === item.route ? "page" : "false",
    });
    if (item.badge && item.badge > 0) {
      link.append(h("span", { class: "nav-badge", text: String(item.badge) }));
    }
    return link;
  });
  replaceChildren(nav, ...links);
}

function render(): void {
  renderHeader();
  renderNav();
  if (app.needsPairing) {
    const key = `${app.pairingNotice ?? ""}`;
    if (pairingView === null || pairingKey !== key) {
      pairingView?.dispose();
      pairingView = createPairingView(app, language);
      pairingKey = key;
    }
    replaceChildren(main, pairingView.element);
    return;
  }
  pairingView?.dispose();
  pairingView = null;
  pairingKey = "";
  switch (route) {
    case "notifications":
      replaceChildren(main, notificationsView.element);
      notificationsView.update();
      return;
    case "approvals":
      replaceChildren(main, approvalsView.element);
      approvalsView.update();
      return;
    case "pause-all":
      replaceChildren(main, pauseView.element);
      pauseView.update();
      return;
    case "conversation":
    default:
      replaceChildren(main, conversationView.element);
      conversationView.update();
      return;
  }
}

app.subscribe(() => {
  render();
});
globalThis.addEventListener("hashchange", () => {
  route = routeFromHash();
  render();
});
document.documentElement.lang = language === "zh-TW" ? "zh-Hant" : "en";
app.start();
render();
