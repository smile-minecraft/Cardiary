import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";

import { ApprovalLedger, Database, STATE_APPLICATION_ID, newUlid } from "../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "concurrency"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function workerOptions(
  dbPath: string,
  mode: "record" | "hold",
  overrides: Record<string, unknown> = {},
): { workerData: Record<string, unknown> } {
  return {
    workerData: {
      dbPath,
      mode,
      approvalKey: "parallel-key",
      sessionId: "session-1",
      turnId: "turn_1",
      id: newUlid(),
      requestedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

function runWorker(options: { workerData: Record<string, unknown> }): {
  readonly done: Promise<{ id: string | null; status: string | null; held?: boolean }>;
  readonly worker: Worker;
} {
  const worker = new Worker(new URL("./helpers/approval-worker.mjs", import.meta.url), options);
  const done = new Promise<{ id: string | null; status: string | null; held?: boolean }>(
    (resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    },
  );
  return { done, worker };
}

describe("兩個獨立連線的並行審批", () => {
  it("兩個 worker 同時 record，只留一筆 pending", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const dbPath = storage.state.filePath;

    const first = runWorker(workerOptions(dbPath, "record"));
    const second = runWorker(workerOptions(dbPath, "record"));
    const [left, right] = await Promise.all([first.done, second.done]);
    await Promise.all([first.worker.terminate(), second.worker.terminate()]);

    expect(left.status).toBe("pending");
    expect(right.status).toBe("pending");
    expect(left.id).toBe(right.id);
    const ledger = new ApprovalLedger(storage.state);
    expect(ledger.countPendingForKey("parallel-key")).toBe(1);
    expect(storage.state.countRows("approvals")).toBe(1);
  });

  it("兩個獨立連線先後 record 也拿到同一列", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const other = Database.open(storage.state.filePath, {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    cleanups.push(() => other.close());
    const ledgerA = new ApprovalLedger(storage.state);
    const ledgerB = new ApprovalLedger(other);
    const inputA = {
      id: newUlid(),
      approvalKey: "two-connections",
      sessionId: "session-1",
      turnId: "turn_1",
      toolName: "bash",
      actionKind: "tool-execution",
      requestJson: "{}",
      requestedAt: new Date().toISOString(),
    };
    const first = ledgerA.record(inputA);
    const second = ledgerB.record({ ...inputA, id: newUlid() });
    expect(second.record.id).toBe(first.record.id);
    expect(ledgerB.countPendingForKey("two-connections")).toBe(1);
  });

  it("另一個連線持有寫入鎖時，record 等到鎖放開才成功（SQLITE_BUSY 重試）", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const hold = runWorker(workerOptions(storage.state.filePath, "hold", { holdMs: 150 }));
    // 讓 worker 先拿到 BEGIN IMMEDIATE。
    await new Promise((resolve) => setTimeout(resolve, 30));
    const ledger = new ApprovalLedger(storage.state);
    const input = {
      id: newUlid(),
      approvalKey: "busy-key",
      sessionId: "session-1",
      turnId: "turn_1",
      toolName: "bash",
      actionKind: "tool-execution",
      requestJson: "{}",
      requestedAt: new Date().toISOString(),
    };
    const startedAt = Date.now();
    const outcome = ledger.record(input);
    expect(outcome.status).toBe("pending");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    await hold.done;
    await hold.worker.terminate();
  });
});
