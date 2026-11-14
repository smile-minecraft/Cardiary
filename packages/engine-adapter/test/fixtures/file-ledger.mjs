import { readFile, rename, writeFile } from "node:fs/promises";

/** 跨行程共用的檔案版審批 ledger；正式產品用儲存層的 approvals 表。 */
export function createFileApprovalLedger(path) {
  let queue = Promise.resolve();
  const load = async () => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return [];
    }
  };
  const save = async (rows) => {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(rows), "utf8");
    await rename(temporary, path);
  };
  const serial = (body) => {
    const next = queue.then(body, body);
    queue = next.catch(() => {});
    return next;
  };
  const strip = ({ sequence, ...rest }) => rest;
  return {
    record: (request) =>
      serial(async () => {
        const rows = await load();
        const keyed = rows.filter((row) => row.approvalKey === request.approvalKey);
        const pending = keyed.find((row) => row.status === "pending");
        if (pending !== undefined) return { kind: "existing", request: strip(pending) };
        const decided = [...keyed]
          .filter((row) => row.status === "approved" || row.status === "denied")
          .sort((left, right) => right.sequence - left.sequence)[0];
        if (decided !== undefined) return { kind: "decided", request: strip(decided) };
        const sequence = rows.length === 0 ? 1 : Math.max(...rows.map((row) => row.sequence)) + 1;
        const stored = { ...request, sequence };
        rows.push(stored);
        await save(rows);
        return { kind: "created", request: strip(stored) };
      }),
    update: (request) =>
      serial(async () => {
        const rows = await load();
        const index = rows.findIndex((row) => row.id === request.id);
        if (index >= 0) {
          rows[index] = { ...request, sequence: rows[index].sequence };
          await save(rows);
        }
      }),
    get: (requestId) =>
      serial(async () => {
        const rows = await load();
        const found = rows.find((row) => row.id === requestId);
        return found === undefined ? null : strip(found);
      }),
    findByApprovalKey: (approvalKey) =>
      serial(async () => {
        const rows = await load();
        const keyed = rows.filter((row) => row.approvalKey === approvalKey);
        const found =
          keyed.find((row) => row.status === "pending") ??
          [...keyed].sort((left, right) => right.sequence - left.sequence)[0];
        return found === undefined ? null : strip(found);
      }),
    listPending: (filter) =>
      serial(async () => {
        const rows = await load();
        return rows
          .filter((row) => {
            if (row.status !== "pending") return false;
            if (
              filter?.conversationId !== undefined &&
              row.draft.conversationId !== filter.conversationId
            ) {
              return false;
            }
            return true;
          })
          .map(strip);
      }),
    commitDecision: (decision) =>
      serial(async () => {
        const rows = await load();
        const index = rows.findIndex((row) => row.id === decision.requestId);
        if (index < 0 || rows[index].status !== "pending") return "already-decided";
        rows[index] = {
          ...rows[index],
          status: decision.verdict === "approve" ? "approved" : "denied",
          decision,
        };
        await save(rows);
        return "committed";
      }),
  };
}
