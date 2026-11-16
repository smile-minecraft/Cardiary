/**
 * 配對畫面。
 *
 * 流程（設計 m2-remote §2）：
 * 1. 用一條**沒有 Token** 的連線送 `pairing.begin`，帶裝置名稱與 `kind: "web"`。
 * 2. 伺服器回短碼；畫面顯示短碼並提示「請在 Mac 上核准」。短碼只用來核對，
 *    不是輸入框，也不能拿來領 Token。
 * 3. 在同一條連線輪詢 `pairing.complete`。核准前主機會回 `conflict`，這是正常的
 *    等待狀態，不顯示成錯誤；核准後同一條連線回一次 Token，接著主動關閉。
 * 4. 拿到 Token 後依「記住這個裝置」存到 localStorage 或 sessionStorage，
 *    再由 RemoteApp 用 Token 重連。
 */

import { translate, type Language } from "../i18n";
import { h, replaceChildren } from "../lib/dom";
import { ProtocolClient, ProtocolRequestError } from "../net/protocol-client";
import type { RemoteApp } from "../state/remote-app";

const POLL_INTERVAL_MS = 2000;

/** 畫面生命週期；配上層 unmount 時呼叫，清掉輪詢與配對連線。 */
export interface PairingView {
  readonly element: HTMLElement;
  dispose(): void;
}

export function createPairingView(app: RemoteApp, language: Language): PairingView {
  const element = h("section", { class: "panel pairing-panel" });
  element.append(
    h("header", { class: "panel-header" }, h("h1", { text: translate(language, "pairing.title") })),
  );
  const body = h("div", { class: "pairing-body" });
  element.append(body);

  let client: ProtocolClient | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let completed = false;

  const dispose = () => {
    disposed = true;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    client?.close();
    client = null;
  };

  const renderForm = (error?: string) => {
    const nameInput = h("input", {
      class: "input",
      type: "text",
      autocomplete: "off",
      maxlength: "80",
      placeholder: translate(language, "pairing.deviceNamePlaceholder"),
      "aria-label": translate(language, "pairing.deviceNameLabel"),
    });
    const remember = h("input", { class: "switch", type: "checkbox" });
    const submit = h("button", {
      class: "button button-primary",
      type: "button",
      text: translate(language, "pairing.submit"),
    });

    const start = () => {
      const deviceName = nameInput.value.trim();
      if (!deviceName) {
        renderForm(translate(language, "pairing.deviceNameRequired"));
        return;
      }
      submit.disabled = true;
      submit.textContent = translate(language, "pairing.submitting");
      void beginPairing({
        app,
        language,
        deviceName,
        remember: remember.checked,
        body,
        renderForm,
        setClient: (value) => {
          client = value;
        },
        setPollTimer: (value) => {
          pollTimer = value;
        },
        isDisposed: () => disposed,
        isCompleted: () => completed,
        markCompleted: () => {
          completed = true;
        },
      });
    };
    submit.addEventListener("click", start);
    nameInput.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") start();
    });

    replaceChildren(
      body,
      h("p", { class: "lead", text: translate(language, "pairing.description") }),
      h(
        "label",
        { class: "field" },
        h("span", { text: translate(language, "pairing.deviceNameLabel") }),
        nameInput,
      ),
      error ? h("p", { class: "form-error", text: error }) : null,
      h(
        "label",
        { class: "checkbox-row" },
        remember,
        h("span", { text: translate(language, "pairing.remember") }),
      ),
      submit,
    );
  };

  const notice = app.pairingNotice;
  renderForm(
    notice === "revoked"
      ? translate(language, "connection.revoked")
      : notice === "authFailed"
        ? translate(language, "connection.authFailed")
        : undefined,
  );

  return { element, dispose };
}

interface BeginPairingInput {
  readonly app: RemoteApp;
  readonly language: Language;
  readonly deviceName: string;
  readonly remember: boolean;
  readonly body: HTMLElement;
  readonly renderForm: (error?: string) => void;
  readonly setClient: (client: ProtocolClient | null) => void;
  readonly setPollTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
  readonly isDisposed: () => boolean;
  readonly isCompleted: () => boolean;
  readonly markCompleted: () => void;
}

async function beginPairing(input: BeginPairingInput): Promise<void> {
  const { app, language, body, renderForm } = input;
  const codePanel = h("div", { class: "code-panel" });
  const codeValue = h("div", { class: "pairing-code", "aria-live": "polite" }, "••••••");
  const status = h("p", { class: "waiting", text: translate(language, "pairing.waiting") });
  const expires = h("p", { class: "muted" });
  codePanel.append(
    h("h2", { class: "section-title", text: translate(language, "pairing.codeLabel") }),
    codeValue,
    h("p", { class: "approve-hint", text: translate(language, "pairing.approveOnMac") }),
    status,
    expires,
    h("p", { class: "form-hint", text: translate(language, "pairing.codeHint") }),
  );
  replaceChildren(body, codePanel);

  const client = new ProtocolClient({
    instanceId: app.instanceId,
    clientVersion: app.clientVersion,
    handlers: {
      onClose: () => {
        if (input.isDisposed() || input.isCompleted()) return;
        status.textContent = translate(language, "pairing.unknown");
      },
    },
  });
  input.setClient(client);
  client.start();

  // onopen 沒有掛載點可見，用 isOpen 輪詢最多五秒；WebSocket 本機連線通常立即開啟。
  let opened = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (input.isDisposed()) return;
    if (client.isOpen) {
      opened = true;
      break;
    }
    await delay(100);
  }
  if (!opened) {
    renderForm(translate(language, "pairing.unknown"));
    return;
  }

  try {
    const result = await client.request<{
      pairingRequestId: string;
      code: string;
      expiresAt: string;
    }>("pairing.begin", { deviceName: input.deviceName, kind: "web" });
    codeValue.textContent = result.code;
    expires.textContent = translate(language, "pairing.expiresAt", {
      time: formatCodeExpiry(result.expiresAt, language),
    });

    const poll = async (): Promise<void> => {
      if (input.isDisposed() || input.isCompleted()) return;
      try {
        const complete = await client.request<{
          deviceId: string;
          deviceName: string;
          deviceToken: string;
        }>("pairing.complete", { pairingRequestId: result.pairingRequestId });
        input.markCompleted();
        status.textContent = translate(language, "pairing.done");
        // 拿到 Token 就立刻存，避免主機關閉連線前遺失。
        app.adoptDeviceToken(complete.deviceToken, input.remember);
        client.close();
        input.setClient(null);
      } catch (error) {
        if (input.isDisposed() || input.isCompleted()) return;
        const code = error instanceof ProtocolRequestError ? error.code : "";
        if (code === "conflict" || code === "connection_closed" || code === "timeout") {
          // 尚未核准、或短時間連線抖動：繼續等，不把正常的等待顯示成錯誤。
        } else {
          status.textContent = translate(language, "pairing.unknown");
          return;
        }
        input.setPollTimer(setTimeout(() => void poll(), POLL_INTERVAL_MS));
      }
    };
    input.setPollTimer(setTimeout(() => void poll(), POLL_INTERVAL_MS));
  } catch (error) {
    renderForm(
      translate(language, "pairing.beginFailed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function formatCodeExpiry(rfc3339: string, language: Language): string {
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return rfc3339;
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
