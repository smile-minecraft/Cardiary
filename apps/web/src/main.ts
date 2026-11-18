import "./style.css";

import { loadLanguage, saveLanguage, translate, type Language, type MessageKey } from "./i18n";
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

const SVG_NS = "http://www.w3.org/2000/svg";

/** 導覽與頁首用的線條圖示；路徑只用 stroke，顏色跟著文字色。 */
const ICONS: Record<Route | "logout" | "heart", string> = {
  conversation: "M4 5.5h16v10H9l-5 4z",
  notifications: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4",
  approvals: "M5 4h11l3 3v13H5zM9 13l2.5 2.5L16 11",
  "pause-all": "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M10 9v6M14 9v6",
  logout: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10",
  heart:
    "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z",
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
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
  headerSignature = "";
  navSignature = "";
  createViews();
  render();
}

let headerSignature = "";

function renderHeader(): void {
  const status = headerStatus(app, language);
  const signature = [language, status.state, app.needsPairing].join("|");
  if (signature === headerSignature) return;
  headerSignature = signature;

  const langButton = h("button", {
    class: "chrome-button lang-button",
    type: "button",
    text: translate(language, "lang.toggle"),
    title: translate(language, "lang.toggleLabel"),
    "aria-label": translate(language, "lang.toggleLabel"),
    on: {
      click: () => setLanguage(language === "zh-TW" ? "en" : "zh-TW"),
    },
  });
  const logoutButton = h("button", {
    class: "chrome-button logout-button",
    type: "button",
    title: translate(language, "logout.button"),
    "aria-label": translate(language, "logout.button"),
    on: {
      click: () => {
        if (globalThis.confirm(translate(language, "logout.confirm"))) app.logout();
      },
    },
  });
  logoutButton.append(
    icon("logout"),
    h("span", { class: "chrome-label", text: translate(language, "logout.button") }),
  );

  const mark = h("span", { class: "brand-mark" });
  mark.append(icon("heart"));
  replaceChildren(
    header,
    h(
      "div",
      { class: "brand" },
      mark,
      h("span", { class: "brand-name", text: translate(language, "app.title") }),
    ),
    h(
      "div",
      { class: "header-actions" },
      h(
        "span",
        { class: `connection connection-${status.state}`, role: "status" },
        h("span", { class: status.dotClass, "aria-hidden": "true" }),
        h("span", { class: "connection-label", text: status.label }),
      ),
      langButton,
      app.needsPairing ? null : logoutButton,
    ),
  );
}

let navSignature = "";

function renderNav(): void {
  const signature = [language, route, app.needsPairing, app.totalUnread, app.approvals.length].join(
    "|",
  );
  if (signature === navSignature) return;
  navSignature = signature;
  nav.hidden = app.needsPairing;

  const items: Array<{ route: Route; key: MessageKey; badge?: number; urgent?: boolean }> = [
    { route: "conversation", key: "nav.conversation" },
    { route: "notifications", key: "nav.notifications", badge: app.totalUnread },
    { route: "approvals", key: "nav.approvals", badge: app.approvals.length, urgent: true },
    { route: "pause-all", key: "nav.pauseAll" },
  ];
  const links = items.map((item) => {
    const active = route === item.route;
    const link = h("a", {
      class: active ? `nav-item nav-${item.route} is-active` : `nav-item nav-${item.route}`,
      href: `#/${item.route}`,
      "aria-current": active ? "page" : "false",
    });
    link.append(
      icon(item.route),
      h("span", { class: "nav-label", text: translate(language, item.key) }),
    );
    if (item.badge && item.badge > 0) {
      link.append(
        h("span", {
          class: item.urgent ? "nav-badge is-urgent" : "nav-badge",
          text: item.badge > 99 ? "99+" : String(item.badge),
        }),
      );
    }
    return link;
  });
  replaceChildren(nav, ...links);
}

let mounted: Element | null = null;

/** 只有換畫面時才換 main 的子節點；同一個畫面只呼叫 update，保留焦點與捲動位置。 */
function mount(element: Element): void {
  if (mounted === element) return;
  mounted = element;
  replaceChildren(main, element);
}

function render(): void {
  root!.setAttribute("data-route", app.needsPairing ? "pairing" : route);
  renderHeader();
  renderNav();
  if (app.needsPairing) {
    const key = `${app.pairingNotice ?? ""}`;
    if (pairingView === null || pairingKey !== key) {
      pairingView?.dispose();
      pairingView = createPairingView(app, language);
      pairingKey = key;
    }
    mount(pairingView.element);
    return;
  }
  pairingView?.dispose();
  pairingView = null;
  pairingKey = "";
  switch (route) {
    case "notifications":
      mount(notificationsView.element);
      notificationsView.update();
      return;
    case "approvals":
      mount(approvalsView.element);
      approvalsView.update();
      return;
    case "pause-all":
      mount(pauseView.element);
      pauseView.update();
      return;
    case "conversation":
    default:
      mount(conversationView.element);
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
  if (route === "notifications" && app.connectionStatus === "connected") {
    void app.refreshNotifications().catch(() => undefined);
  }
});
document.documentElement.lang = language === "zh-TW" ? "zh-Hant" : "en";
app.start();
render();
