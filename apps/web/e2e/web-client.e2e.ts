import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium, expect, test } from "@playwright/test";

import {
  connect,
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../../../packages/contract-tests/test/support.js";

/**
 * 網頁客戶端的端到端測試：真的主機服務、真的 WebSocket、真的 Chromium。
 *
 * 流程照使用者的路徑走：殼在私有控制通道核准配對，瀏覽器拿到裝置 Token
 * 後連上主機、對話、在審批卡上核准、最後按緊急全部暫停。測試自己扮演殼，
 * 不經過產品程式以外的捷徑；唯一的替身是 fake 引擎與它固定的腳本。
 */

const WEB_BUILD = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const webRoot = fileURLToPath(new URL("../dist", import.meta.url));

if (!existsSync(WEB_BUILD)) {
  throw new Error(`找不到 ${WEB_BUILD}；先執行 pnpm --filter web build。`);
}

const chromiumPath = chromium.executablePath();
if (!existsSync(chromiumPath)) {
  // 少了瀏覽器就失敗，不讓 CI 以「全部 skip」誤判成通過。
  throw new Error(
    `找不到 Chromium（${chromiumPath}）；先執行 pnpm exec playwright install chromium。`,
  );
}

// 主機與瀏覽器在忙碌的機器上啟動較慢；設定與等待留寬一點，避免把負載當成失敗。
const SETUP_TIMEOUT = 30_000;

const STREAM_REPLY = "這是串流回覆的內容，會一段一段出現在對話裡。";
const APPROVED_REPLY = "核准後完成";
const TOOL_OUTPUT = "e2e 工具回顯 7f3a";

let service: SpawnedService;
let sessionId: string;
let deviceToken: string;
let baseUrl: string;

test.beforeAll(async () => {
  service = await spawnService({
    control: true,
    demo: true,
    env: { CARDIARY_WEB_ROOT: webRoot },
    scripts: [
      [{ kind: "text", text: STREAM_REPLY, chunkSize: 1, delayMs: 25 }],
      [
        { kind: "tool", toolName: "demo.echo", input: { text: TOOL_OUTPUT } },
        { kind: "text", text: APPROVED_REPLY, chunkSize: 2, delayMs: 10 },
      ],
    ],
  });
  baseUrl = `http://127.0.0.1:${service.ready.clientPort}`;

  // 遠端存取預設關閉；比照 Mac 設定頁，由本機客戶端打開人類專屬開關。
  const local = await connectAndHello(service);
  const enableId = local.request("system.settings.set", {
    changes: [{ key: "remote.accessEnabled", value: true }],
    clientRequestId: "web-e2e-remote-access",
  });
  const enableReply = await local.waitForReply(enableId, SETUP_TIMEOUT);
  expect(enableReply.kind, JSON.stringify(enableReply)).toBe("response");
  await local.close();

  // 未認證連線：pairing.begin → 殼從私有控制通道核准 → 同連線 pairing.complete。
  const pairing = await connect(`ws://127.0.0.1:${service.ready.clientPort}/v1/ws`);
  const beginId = pairing.request("pairing.begin", {
    deviceName: "Playwright Chromium",
    kind: "web",
  });
  const beginReply = await pairing.waitForReply(beginId, SETUP_TIMEOUT);
  expect(beginReply.kind, JSON.stringify(beginReply)).toBe("response");
  const { pairingRequestId } = beginReply.payload as { pairingRequestId: string };
  expect(pairingRequestId).toBeTruthy();

  const approved = await service.controlRequest(
    "control.pairing.approve",
    { pairingRequestId },
    undefined,
    SETUP_TIMEOUT,
  );
  expect(approved.ok, JSON.stringify(approved)).toBe(true);

  const completeId = pairing.request("pairing.complete", { pairingRequestId });
  const completeReply = await pairing.waitForReply(completeId, SETUP_TIMEOUT);
  expect(completeReply.kind, JSON.stringify(completeReply)).toBe("response");
  deviceToken = (completeReply.payload as { deviceToken: string }).deviceToken;
  expect(deviceToken).toBeTruthy();
  await pairing.close();

  // 先建一個「沒有訊息」的空會話，讓網頁啟動後自動選取；第一個回合留給瀏覽器送出的訊息。
  const api: ProtocolClient = await connect(`ws://127.0.0.1:${service.ready.clientPort}/v1/ws`);
  const helloId = await api.hello(deviceToken);
  const helloReply = await api.waitForReply(helloId, SETUP_TIMEOUT);
  expect(helloReply.kind, JSON.stringify(helloReply)).toBe("response");
  const createId = api.request("session.create", { clientRequestId: "web-e2e-session" });
  const createReply = await api.waitForReply(createId, SETUP_TIMEOUT);
  expect(createReply.kind, JSON.stringify(createReply)).toBe("response");
  sessionId = (createReply.payload as { session: { id: string } }).session.id;

  await api.close();
});

test.afterAll(async () => {
  await service?.stop().catch(() => undefined);
  // 主機的資料夾是 mkdtemp 建的；測試跑完自己清掉，不留在系統暫存目錄。
  if (service?.folder.path) {
    await rm(service.folder.path, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("配對後在網頁對話、核准審批與緊急暫停", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ token }) => {
      try {
        sessionStorage.setItem("cardiary.deviceToken", token);
        localStorage.setItem("cardiary.lang", "zh-TW");
      } catch {
        // about:blank 的 origin 不能存取儲存空間；真正的頁面載入時再寫一次。
      }
    },
    { token: deviceToken },
  );
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));
  const websocketUrls: string[] = [];
  page.on("websocket", (ws) => websocketUrls.push(ws.url()));

  try {
    await page.goto(`${baseUrl}/index.html`);

    // 已帶 Token：hello 通過，並自動選取剛建立的空會話。
    await expect(page.locator(".connection-label")).toHaveText("已連線");
    await expect(page.locator("select.session-select")).toHaveValue(sessionId);

    // 第一回合：送出訊息，先看到串流中的訊息，再看到完成後的文字。
    await page.locator(".message-input").fill("請開始第一則 ea71");
    await page.locator('.composer button[type="submit"]').click();
    await expect(page.locator(".message-input")).toHaveValue("");
    await expect(page.locator(".message-user .message-text").first()).toContainText("ea71");
    await expect(page.locator(".message-user")).toHaveCount(1);
    await expect(page.locator(".message-assistant.is-streaming")).toBeVisible();
    await expect(
      page.locator(".message-assistant .message-text").filter({ hasText: STREAM_REPLY }),
    ).toBeVisible();

    // 第二回合：工具呼叫要審批；對話頁顯示待審批提示。
    await page.locator(".message-input").fill("請執行 e30c");
    await page.locator('.composer button[type="submit"]').click();
    await expect(page.locator(".inline-notice")).toContainText("有一則審批等你決定。");
    // 等待審批時工具呼叫已經出現，但還沒有輸出。
    await expect(page.locator(".message-tool .tool-name")).toHaveText("demo.echo");
    await expect(page.locator(".message-tool .tool-output")).toHaveCount(0);

    // 審批頁：一張卡、按「核准」；核准後卡片消失。
    await page.locator('a.nav-item[href="#/approvals"]').click();
    const approvalCard = page.locator("article.approval-card");
    await expect(approvalCard).toHaveCount(1);
    await expect(approvalCard.getByRole("button", { name: "核准", exact: true })).toBeVisible();
    await approvalCard.getByRole("button", { name: "核准", exact: true }).click();
    await expect(approvalCard).toHaveCount(0);

    // 回到對話：工具結果與核准後的回覆都出現，代表回合續跑完成。
    await page.locator('a.nav-item[href="#/conversation"]').click();
    await expect(
      page.locator(".message-assistant .message-text").filter({ hasText: APPROVED_REPLY }),
    ).toBeVisible();
    // 工具輸出要出現在輸出區塊，不能只靠輸入 JSON 裡剛好有同一段文字。
    await expect(page.locator(".message-tool .tool-output")).toContainText(TOOL_OUTPUT);
    await expect(page.locator(".message-assistant.is-streaming")).toHaveCount(0);

    // 緊急全部暫停：第一次點擊進入確認，第二次才送出；閒置時中斷數為 0。
    await page.locator('a.nav-item[href="#/pause-all"]').click();
    const pauseButton = page.locator(".danger-zone button.button-large");
    await expect(pauseButton).toHaveText("緊急全部暫停");
    await pauseButton.click();
    await expect(pauseButton).toHaveText("再按一次確認暫停");
    await pauseButton.click();
    await expect(page.locator(".danger-zone .form-note")).toHaveText(
      "已全部暫停，共中止 0 個回合。",
    );

    // 網路層斷言：沒有 console error，Token 從不出現在任何 URL。
    expect(consoleErrors, `console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
    expect(page.url()).not.toContain(deviceToken);
    expect(requestUrls.filter((url) => url.includes(deviceToken))).toEqual([]);
    expect(websocketUrls.length).toBeGreaterThanOrEqual(1);
    expect(websocketUrls.filter((url) => url.includes(deviceToken))).toEqual([]);
  } finally {
    await context.close();
  }
});
