import { setTimeout as delay } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";

const lib = await import(workerData.distUrl);
const { ApprovalLedger, Database, STATE_APPLICATION_ID, newUlid } = lib;

const db = Database.open(workerData.dbPath, { expectedApplicationId: STATE_APPLICATION_ID });
const ledger = new ApprovalLedger(db);
const results = [];
for (let index = 0; index < workerData.rounds; index += 1) {
  const outcome = ledger.record({
    id: newUlid(),
    approvalKey: workerData.approvalKey,
    sessionId: "session-1",
    turnId: "turn_1",
    toolName: "bash",
    actionKind: "tool-execution",
    requestJson: JSON.stringify({ input: "ls" }),
    requestedAt: new Date().toISOString(),
  });
  results.push({ id: outcome.record.id, status: outcome.status });
  await delay(2);
}
db.close();
parentPort.postMessage({ results });
