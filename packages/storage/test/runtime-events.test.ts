import { afterEach, describe, expect, it } from "vitest";

import { Storage, StorageError, TurnIndex } from "../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "runtime"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function open(tempRoot: TempRoot): Storage {
  const storage = openTestStorage(tempRoot);
  cleanups.push(() => storage.close());
  return storage;
}

describe("runtime_state 與 epoch", () => {
  it("全新資料庫建立單列、新 epoch、clean_shutdown = 0", () => {
    const storage = open(temp());
    expect(storage.state.countRows("runtime_state")).toBe(1);
    const snapshot = storage.runtime.read();
    expect(snapshot?.epoch).toMatch(/^[0-9A-Z]{26}$/);
    expect(snapshot?.cleanShutdown).toBe(false);
  });

  it("正常關閉沿用 epoch；MAX(stream_seq) 從同一個 epoch 接續", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const epoch = first.runtime.read()?.epoch;
    first.events.append({ stream: "system", kind: "system.status", payload: { n: 1 } });
    first.events.append({ stream: "session:one", kind: "stream.turn_started", payload: { n: 1 } });
    first.runtime.markCleanShutdown("control.shutdown");
    first.runtime.checkpointAndClose();
    first.close();

    const second = open(tempRoot);
    const snapshot = second.runtime.read();
    expect(snapshot?.epoch).toBe(epoch);
    expect(snapshot?.cleanShutdown).toBe(false);
    expect(second.events.maxSeq("system")).toBe(1);
    const appended = second.events.append({
      stream: "system",
      kind: "system.status",
      payload: { n: 2 },
    });
    expect(appended.streamSeq).toBe(2);
  });

  it("非正常結束（未 mark）下次啟動換 epoch，序號從 1 開始", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const oldEpoch = first.runtime.read()?.epoch as string;
    first.events.append({ stream: "system", kind: "system.status", payload: { n: 1 } });
    first.events.append({ stream: "system", kind: "system.status", payload: { n: 2 } });
    first.runtime.checkpointAndClose();
    first.close();

    const second = open(tempRoot);
    expect(second.runtime.read()?.epoch).not.toBe(oldEpoch);
    expect(second.events.maxSeq("system")).toBe(0);
    expect(second.events.maxSeq("system", oldEpoch)).toBe(2);
    expect(
      second.events.append({ stream: "system", kind: "system.status", payload: { n: 3 } })
        .streamSeq,
    ).toBe(1);
  });

  it("reopen 只重開連線：不換 epoch、不寫 clean_shutdown、不新增列", () => {
    const storage = open(temp());
    const before = storage.runtime.read();
    storage.events.append({ stream: "system", kind: "system.status", payload: { n: 1 } });
    const reopened = storage.runtime.reopen();
    expect(reopened.epoch).toBe(before?.epoch);
    expect(reopened.cleanShutdown).toBe(false);
    expect(storage.state.countRows("runtime_state")).toBe(1);
    expect(
      storage.events.append({ stream: "system", kind: "system.status", payload: { n: 2 } })
        .streamSeq,
    ).toBe(2);
  });

  it("stdin 中斷只關資料庫不寫 1；下次啟動照樣換 epoch", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const epoch = first.runtime.read()?.epoch;
    first.runtime.checkpointAndClose();
    first.close();
    const second = open(tempRoot);
    expect(second.runtime.read()?.epoch).not.toBe(epoch);
  });
});

describe("event_log", () => {
  it("(stream, epoch, stream_seq) 唯一，且查詢帶 stream 與 epoch", () => {
    const storage = open(temp());
    const epoch = storage.runtime.read()?.epoch as string;
    storage.events.append({ stream: "system", kind: "system.status", payload: { n: 1 } });
    storage.events.append({ stream: "system", kind: "system.status", payload: { n: 2 } });
    expect(() =>
      storage.state.run(
        "INSERT INTO event_log (stream, epoch, stream_seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        "system",
        epoch,
        1,
        "system.status",
        "{}",
        new Date().toISOString(),
      ),
    ).toThrowError(/UNIQUE/);
    expect(storage.events.maxSeq("system", epoch)).toBe(2);
    expect(storage.events.maxSeq("other", epoch)).toBe(0);
  });

  it("事件與狀態在同一個交易提交；callback 失敗時兩者都回滾", () => {
    const storage = open(temp());
    storage.events.appendWithState(
      { stream: "system", kind: "system.status", payload: { n: 1 } },
      (tx) => {
        tx.run(
          "INSERT INTO settings (key, value, level, updated_at, updated_by) VALUES ('a', '1', 'free', 'now', 'test')",
        );
      },
    );
    expect(storage.state.countRows("event_log")).toBe(1);
    expect(storage.settings.get("a")?.value).toBe("1");

    expect(() =>
      storage.events.appendWithState(
        { stream: "system", kind: "system.status", payload: { n: 2 } },
        (tx) => {
          tx.run(
            "INSERT INTO settings (key, value, level, updated_at, updated_by) VALUES ('b', '2', 'free', 'now', 'test')",
          );
          throw new Error("boom");
        },
      ),
    ).toThrowError("boom");
    expect(storage.state.countRows("event_log")).toBe(1);
    expect(storage.settings.get("b")).toBeNull();
  });

  it("stream.text_delta 不落地、不佔序號", () => {
    const storage = open(temp());
    storage.events.append({ stream: "system", kind: "system.status", payload: { n: 1 } });
    expect(() =>
      storage.events.append({
        stream: "session:one",
        kind: "stream.text_delta",
        payload: { t: "x" },
      }),
    ).toThrowError(StorageError);
    expect(storage.state.countRows("event_log")).toBe(1);
    expect(storage.events.maxSeq("session:one")).toBe(0);
  });

  it("保留策略只算耐久事件：30 天與每串流上限", () => {
    const storage = open(temp());
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    storage.events.append({
      stream: "system",
      kind: "system.status",
      payload: { n: 0 },
      createdAt: old,
    });
    for (let index = 1; index <= 4; index += 1) {
      storage.events.append({ stream: "system", kind: "system.status", payload: { n: index } });
    }
    storage.events.prune({ retainDays: 30, perStreamLimit: 3 });
    const remaining = storage.events.read("system", storage.runtime.read()?.epoch as string, 0);
    expect(remaining.map((event) => event.streamSeq)).toEqual([3, 4, 5]);
    expect(remaining.every((event) => event.kind !== "stream.text_delta")).toBe(true);
  });

  it("turn_index 與 stream.turn_started 同一個交易，回滾時一起消失", () => {
    const storage = open(temp());
    const turns = new TurnIndex(storage.state);
    const conversationId = "01CONVERSATION0000000000000";
    const triggerMessageId = "01MESSAGE000000000000000000";
    const turnId = `turn_${triggerMessageId}`;
    storage.events.appendWithState(
      { stream: `session:${conversationId}`, kind: "stream.turn_started", payload: { turnId } },
      (tx) => {
        turns.record(
          {
            turnId,
            conversationId,
            triggerMessageId,
            startedAt: new Date().toISOString(),
          },
          tx,
        );
      },
    );
    expect(turns.get(turnId)?.conversationId).toBe(conversationId);
    expect(turns.findByMessage(conversationId, triggerMessageId)?.turnId).toBe(turnId);

    const otherTurn = "turn_01ROLLBACK0000000000000000";
    expect(() =>
      storage.events.appendWithState(
        {
          stream: `session:${conversationId}`,
          kind: "stream.turn_started",
          payload: { turnId: otherTurn },
        },
        (tx) => {
          turns.record(
            {
              turnId: otherTurn,
              conversationId,
              triggerMessageId: "01ROLLBACKMSG00000000000000",
              startedAt: new Date().toISOString(),
            },
            tx,
          );
          throw new Error("rollback");
        },
      ),
    ).toThrowError("rollback");
    expect(turns.get(otherTurn)).toBeUndefined();
  });
});
