import { afterEach, describe, expect, it } from "vitest";

import {
  RequestDedupeStore,
  parseSendMessageKey,
  recoverPendingRequest,
  sendMessageKey,
  sessionCreateKey,
} from "../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "dedupe"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function response(resourceId: string): string {
  return JSON.stringify({ sessionId: resourceId, created: true });
}

describe("claim / complete / lookup", () => {
  it("先宣告再執行；完成後重送回原本的回應，不會再執行一次", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    const key = sessionCreateKey("req-1");
    const first = store.claim(key, "session-create");
    expect(first.claimed).toBe(true);
    expect(first.record.state).toBe("pending");
    expect(first.record.responseJson).toBeNull();

    expect(store.setResource(key, "conversation-1")).toBe(true);
    expect(store.complete(key, response("conversation-1"))).toBe(true);
    const completed = store.lookup(key);
    expect(completed?.state).toBe("completed");
    expect(JSON.parse(completed?.responseJson ?? "{}")).toMatchObject({
      sessionId: "conversation-1",
    });

    const second = store.claim(key, "session-create");
    expect(second.claimed).toBe(false);
    expect(second.record.state).toBe("completed");
    expect(second.record.responseJson).toBe(completed?.responseJson);
  });

  it("重啟後同一個鍵仍有效", () => {
    const tempRoot = temp();
    const first = openTestStorage(tempRoot);
    const key = sendMessageKey("conversation-1", "msg-1");
    first.dedupe.claim(key, "send-message");
    first.dedupe.setResource(key, "message-1");
    first.dedupe.complete(key, JSON.stringify({ userMessageId: "message-1" }));
    first.close();

    const second = openTestStorage(tempRoot);
    cleanups.push(() => second.close());
    const record = second.dedupe.lookup(key);
    expect(record?.state).toBe("completed");
    expect(second.dedupe.claim(key, "send-message").claimed).toBe(false);
    expect(JSON.parse(record?.responseJson ?? "{}")).toEqual({ userMessageId: "message-1" });
  });

  it("send-message 的鍵可以解析回會話與訊息", () => {
    const key = sendMessageKey("conversation-1", "msg:with:colons");
    expect(parseSendMessageKey(key)).toEqual({
      sessionId: "conversation-1",
      clientMessageId: "msg:with:colons",
    });
    expect(parseSendMessageKey("session-create:x")).toBeNull();
  });

  it("過期列由維護清理，不在請求路徑刪", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    store.claim(sessionCreateKey("old"), "session-create", {
      now: "2020-01-01T00:00:00.000Z",
      retainDays: 30,
    });
    expect(store.count()).toBe(1);
    store.prune({ now: new Date(), retainDays: 30 });
    expect(store.count()).toBe(0);
  });
});

describe("pending 的恢復順序", () => {
  function probes(overrides: Record<string, unknown> = {}) {
    return {
      conversationExists: () => false,
      findConversationByClientRequestId: () => null,
      messageExists: () => false,
      findMessageByClientId: () => null,
      buildResponse: (resourceId: string) => response(resourceId),
      ...overrides,
    };
  }

  it("resource_id 有值且資源還在：補上回應、標成 completed，回傳成功", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    const key = sessionCreateKey("req-1");
    store.claim(key, "session-create");
    store.setResource(key, "conversation-1");
    const outcome = recoverPendingRequest(store, key, {
      probes: probes({ conversationExists: (id: string) => id === "conversation-1" }),
    });
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome === "completed") {
      expect(outcome.resourceId).toBe("conversation-1");
      expect(JSON.parse(outcome.responseJson)).toEqual({
        sessionId: "conversation-1",
        created: true,
      });
    }
    expect(store.lookup(key)?.state).toBe("completed");
  });

  it("resource_id 是 NULL，但 clientRequestId 回查找得到：補資源與回應", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    const key = sessionCreateKey("req-lookup");
    store.claim(key, "session-create");
    const outcome = recoverPendingRequest(store, key, {
      probes: probes({
        findConversationByClientRequestId: (id: string) =>
          id === "req-lookup" ? "conversation-found" : null,
      }),
    });
    expect(outcome.outcome).toBe("completed");
    expect(store.lookup(key)?.resourceId).toBe("conversation-found");
    expect(store.lookup(key)?.state).toBe("completed");
  });

  it("send-message 用 clientMessageId 回查", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    const key = sendMessageKey("conversation-1", "msg-1");
    store.claim(key, "send-message");
    const outcome = recoverPendingRequest(store, key, {
      probes: probes({
        findMessageByClientId: (sessionId: string, clientMessageId: string) =>
          sessionId === "conversation-1" && clientMessageId === "msg-1" ? "user-message-1" : null,
      }),
    });
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome === "completed") {
      expect(outcome.resourceId).toBe("user-message-1");
      expect(JSON.parse(outcome.responseJson)).toEqual({
        sessionId: "user-message-1",
        created: true,
      });
    }
  });

  it("判斷不了且超過期限：result_unknown，不是成功也不是空回應", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    const key = sessionCreateKey("req-unknown");
    store.claim(key, "session-create", {
      now: new Date(Date.now() - 61_000).toISOString(),
    });
    const outcome = recoverPendingRequest(store, key, { probes: probes() });
    expect(outcome.outcome).toBe("result_unknown");
    expect(store.lookup(key)?.state).toBe("pending");
  });

  it("期限內判斷不了：pending，可以重試", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    const key = sessionCreateKey("req-pending");
    store.claim(key, "session-create");
    const outcome = recoverPendingRequest(store, key, { probes: probes() });
    expect(outcome.outcome).toBe("pending");
  });

  it("找不到鍵時回 missing", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    const store = new RequestDedupeStore(storage.state);
    expect(recoverPendingRequest(store, "session-create:none", { probes: probes() }).outcome).toBe(
      "missing",
    );
  });
});
