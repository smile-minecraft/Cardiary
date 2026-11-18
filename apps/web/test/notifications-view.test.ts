import type { CardiaryNotification } from "@cardiary/protocol";
import { describe, expect, it, vi } from "vitest";

import { createNotificationsScreen } from "../src/screens/notifications";
import type { RemoteApp } from "../src/state/remote-app";
import { FakeElement, installFakeDocument, screenButtons } from "./helpers/fake-dom";

function stubNotification(): CardiaryNotification {
  return {
    notificationId: "n1",
    kind: "schedule",
    title: "排程完成",
    body: "今天的工作已排好。",
    createdAt: "2026-11-18T04:00:00Z",
    payload: {},
  };
}

describe("通知畫面", () => {
  it("不再提供轉成卡片，也不會送出建立卡片的請求", async () => {
    installFakeDocument();
    const createCard = vi.fn(async () => ({ deduped: false, card: { title: "卡" } }));
    const app = {
      notifications: [stubNotification()],
      totalUnread: 1,
      async markNotificationsRead() {},
      async refreshNotifications() {},
      createCardFromNotification: createCard,
    } as unknown as RemoteApp;

    const screen = createNotificationsScreen(app, () => "zh-TW");
    screen.update();

    const root = screen.element as unknown as FakeElement;
    const buttons = screenButtons(root);
    expect(buttons.map((button) => button.textContent)).toContain("標為已讀");
    expect(buttons.map((button) => button.textContent)).not.toContain("轉成卡片");

    for (const button of buttons) button.dispatch("click");
    await Promise.resolve();
    expect(createCard).not.toHaveBeenCalled();
  });
});
