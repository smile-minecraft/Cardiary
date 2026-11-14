import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(workerData.dbPath, { timeout: 5000 });
db.exec("PRAGMA busy_timeout = 5000");

const sleep = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

function latest(key) {
  return db
    .prepare(
      `SELECT id, status FROM approvals
       WHERE approval_key = ?
       ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, requested_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(key);
}

if (workerData.mode === "hold") {
  db.exec("BEGIN IMMEDIATE");
  if (workerData.sync) {
    // 握手：拿到鎖才通知主執行緒（slot 0），等主執行緒放行（slot 1）才提交。
    // 不用時間門檻，CI 再快也不會漏掉「已持鎖」這件事。
    const sync = new Int32Array(workerData.sync);
    Atomics.store(sync, 0, 1);
    Atomics.notify(sync, 0);
    const deadline = Date.now() + 10_000;
    while (Atomics.load(sync, 1) === 0 && Date.now() < deadline) {
      Atomics.wait(sync, 1, 0, 50);
    }
  } else {
    sleep(workerData.holdMs ?? 150);
  }
  db.exec("COMMIT");
  parentPort.postMessage({ held: true });
  db.close();
} else {
  for (let attempt = 0; ; attempt += 1) {
    try {
      db.exec("BEGIN IMMEDIATE");
      break;
    } catch (error) {
      if (attempt >= 50) {
        throw error;
      }
      sleep(10);
    }
  }
  const current = latest(workerData.approvalKey);
  if (current === undefined || current.status === "expired" || current.status === "withdrawn") {
    db.prepare(
      `INSERT INTO approvals (
         id, approval_key, scope, session_id, turn_id, tool_name, subject_id, tool_call_id,
         action_kind, status, request_json, requested_at
       ) VALUES (?, ?, 'tool', ?, ?, 'bash', NULL, NULL, 'tool-execution', 'pending', ?, ?)
       ON CONFLICT DO NOTHING`,
    ).run(
      workerData.id,
      workerData.approvalKey,
      workerData.sessionId,
      workerData.turnId,
      JSON.stringify({ input: "ls" }),
      workerData.requestedAt,
    );
  }
  db.exec("COMMIT");
  const final = latest(workerData.approvalKey);
  parentPort.postMessage({ id: final?.id ?? null, status: final?.status ?? null });
  db.close();
}
