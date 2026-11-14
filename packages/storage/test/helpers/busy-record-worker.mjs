import { parentPort, workerData } from "node:worker_threads";

// 用 production 的 ApprovalLedger 在另一個連線上 record；呼叫前先告訴主執行緒
// 「我開始了」（slot 2），完成時回報「主執行緒是否已經放行」（slot 1）。
const lib = await import(workerData.distUrl);
const { ApprovalLedger, Database, STATE_APPLICATION_ID } = lib;

const sync = workerData.sync ? new Int32Array(workerData.sync) : null;
const db = Database.open(workerData.dbPath, { expectedApplicationId: STATE_APPLICATION_ID });
const ledger = new ApprovalLedger(db);

if (sync) {
  Atomics.store(sync, 2, 1);
  Atomics.notify(sync, 2);
}

try {
  const outcome = ledger.record(workerData.input);
  const releasedWhenDone = sync ? Atomics.load(sync, 1) === 1 : false;
  parentPort.postMessage({
    ok: true,
    id: outcome.record.id,
    status: outcome.status,
    releasedWhenDone,
  });
} catch (error) {
  parentPort.postMessage({ ok: false, message: String(error) });
} finally {
  db.close();
}
