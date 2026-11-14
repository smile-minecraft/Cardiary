import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

const distPath = path.join(process.cwd(), "packages/storage/dist/index.js");

describe.skipIf(!existsSync(distPath))("production ApprovalLedger 的並行", () => {
  it("兩個 worker 直接 import production 程式，5 輪後只留一筆 pending", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const distUrl = pathToFileURL(distPath).href;
    const first = new Worker(new URL("./helpers/ledger-worker.mjs", import.meta.url), {
      workerData: {
        dbPath: storage.state.filePath,
        distUrl,
        approvalKey: "parallel-key",
        rounds: 5,
      },
    });
    const second = new Worker(new URL("./helpers/ledger-worker.mjs", import.meta.url), {
      workerData: {
        dbPath: storage.state.filePath,
        distUrl,
        approvalKey: "parallel-key",
        rounds: 5,
      },
    });
    const collect = (worker: Worker) =>
      new Promise<Array<{ id: string; status: string }>>((resolve, reject) => {
        worker.once("message", (message: { results: Array<{ id: string; status: string }> }) =>
          resolve(message.results),
        );
        worker.once("error", reject);
      });
    const [left, right] = await Promise.all([collect(first), collect(second)]);
    await Promise.all([first.terminate(), second.terminate()]);

    const results = [...left, ...right];
    expect(results.every((result) => result.status === "pending")).toBe(true);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    const ledger = new ApprovalLedger(storage.state);
    expect(ledger.countPendingForKey("parallel-key")).toBe(1);
    expect(storage.state.countRows("approvals")).toBe(1);
  });
});

describe("兩個獨立連線的並行審批", () => {
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
    // 用 SharedArrayBuffer 握手，不用「等 30 毫秒」猜 worker 有沒有拿到鎖：
    //   slot 0：hold worker 已 BEGIN IMMEDIATE
    //   slot 1：主執行緒放行，hold worker 可以 COMMIT
    //   slot 2：record worker 已開始呼叫 record
    const sync = new SharedArrayBuffer(12);
    const view = new Int32Array(sync);
    const hold = runWorker(workerOptions(storage.state.filePath, "hold", { sync }));
    const waitForSlot = async (index: number, label: string): Promise<void> => {
      const deadline = Date.now() + 10_000;
      while (Atomics.load(view, index) === 0) {
        if (Date.now() > deadline) {
          throw new Error(`等待 ${label} 逾時`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    await waitForSlot(0, "hold worker 取得寫入鎖");

    const distUrl = pathToFileURL(distPath).href;
    const recorder = new Worker(new URL("./helpers/busy-record-worker.mjs", import.meta.url), {
      workerData: {
        dbPath: storage.state.filePath,
        distUrl,
        sync,
        input: {
          id: newUlid(),
          approvalKey: "busy-key",
          sessionId: "session-1",
          turnId: "turn_1",
          toolName: "bash",
          actionKind: "tool-execution",
          requestJson: "{}",
          requestedAt: new Date().toISOString(),
        },
      },
    });
    const recorded = new Promise<{
      ok: boolean;
      id?: string;
      status?: string;
      releasedWhenDone?: boolean;
      message?: string;
    }>((resolve, reject) => {
      recorder.once("message", resolve);
      recorder.once("error", reject);
    });
    // record 已經開始（此時鎖還握在 hold worker 手上），才放行。
    await waitForSlot(2, "record worker 開始 record");
    Atomics.store(view, 1, 1);
    Atomics.notify(view, 1);

    const result = await recorded;
    await hold.done;
    await Promise.all([hold.worker.terminate(), recorder.terminate()]);
    expect(result.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.status).toBe("pending");
    // 真正證明「等到鎖放開」：record 完成時，主執行緒已經放行過。
    expect(result.releasedWhenDone).toBe(true);
  }, 60_000);
});
