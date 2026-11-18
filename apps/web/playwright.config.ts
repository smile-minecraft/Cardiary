import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * 網頁客戶端的瀏覽器端到端測試。
 *
 * 由測試自己啟動真的主機服務（fake 引擎、demo 工具），再讓 Chromium
 * 連上同一個來源；不用 `webServer`，因為主機服務的埠是啟動後才拿到的。
 * 偶發失敗的證據（trace、截圖）寫到作業系統的暫存目錄，不進版控、也不會被
 * 格式檢查掃到；Playwright 每次執行前會清空它。
 */
export default defineConfig({
  testDir: "./e2e",
  // 用 .e2e.ts 結尾，避免根目錄的 vitest 把它當成單元測試收集。
  testMatch: "**/*.e2e.ts",
  outputDir: join(tmpdir(), "cardiary-web-e2e-results"),
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === "true",
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
