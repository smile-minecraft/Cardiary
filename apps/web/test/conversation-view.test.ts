import type { SessionSummary } from "@cardiary/protocol";
import { describe, expect, it } from "vitest";

import { createConversationView } from "../src/screens/conversation";
import type { RemoteApp } from "../src/state/remote-app";
import { FakeElement, elementAt, elementChildren, installFakeDocument } from "./helpers/fake-dom";

function sessionSummary(id: string, title: string, updatedAt: string): SessionSummary {
  return { id, title, status: "idle", createdAt: updatedAt, updatedAt, messageCount: 0 };
}

/** 只提供對話畫面會讀寫的狀態，`createSession` 模擬主機回覆後的狀態變化。 */
function stubApp(): { app: RemoteApp; stored: { sessions: SessionSummary[] } } {
  const stored = {
    sessions: [sessionSummary("s1", "舊對話", "2026-11-18T04:00:00Z")],
  };
  let currentSessionId: string | null = "s1";
  const app = {
    get sessions() {
      return stored.sessions;
    },
    get currentSessionId() {
      return currentSessionId;
    },
    entries: [],
    streaming: null,
    activeTurn: null,
    pendingApproval: null,
    transcriptError: null,
    async createSession() {
      const created = sessionSummary("s2", "新對話", "2026-11-18T05:00:00Z");
      stored.sessions = [created, ...stored.sessions];
      currentSessionId = created.id;
    },
    async selectSession(sessionId: string) {
      currentSessionId = sessionId;
    },
    async sendMessage() {},
    async interrupt() {},
  };
  return { app: app as unknown as RemoteApp, stored };
}

function optionLabels(select: FakeElement): string[] {
  return elementChildren(select).map((option) => option.textContent);
}

function selectedLabels(select: FakeElement): string[] {
  return elementChildren(select)
    .filter((option) => option.selected)
    .map((option) => option.textContent);
}

describe("對話畫面的會話列", () => {
  it("按下新對話後，下拉立即出現新會話並選取它", () => {
    installFakeDocument();
    const { app } = stubApp();
    const view = createConversationView(app, "zh-TW", () => {});
    view.update();

    const root = view.element as unknown as FakeElement;
    const sessionBar = elementAt(root, 0);
    expect(optionLabels(elementAt(sessionBar, 0))).toEqual(["選擇對話", "舊對話"]);

    const newButton = elementAt(sessionBar, 1);
    expect(newButton.textContent).toBe("新對話");
    newButton.dispatch("click");
    view.update();

    const select = elementAt(elementAt(root, 0), 0);
    expect(optionLabels(select)).toEqual(["選擇對話", "新對話", "舊對話"]);
    expect(selectedLabels(select)).toEqual(["新對話"]);
  });

  it("切換會話時下拉的選取項目跟著改變", async () => {
    installFakeDocument();
    const { app, stored } = stubApp();
    stored.sessions = [sessionSummary("s2", "新對話", "2026-11-18T05:00:00Z"), ...stored.sessions];
    const view = createConversationView(app, "zh-TW", () => {});
    view.update();

    const root = view.element as unknown as FakeElement;
    const select = elementAt(elementAt(root, 0), 0);
    select.value = "s2";
    select.dispatch("change");
    await Promise.resolve();
    view.update();

    expect(selectedLabels(elementAt(elementAt(root, 0), 0))).toEqual(["新對話"]);
  });
});
