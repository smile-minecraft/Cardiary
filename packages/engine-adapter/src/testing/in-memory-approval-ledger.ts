/**
 * 記憶體版的審批 ledger；給測試與假引擎使用。
 *
 * 語意和正式的 SQLite 版一致：`record` 先讀最新列再決定是否插入、
 * `commitDecision` 先寫入者勝出、`findByApprovalKey` 取 pending 優先的最新列。
 * 正式產品用儲存層的 `approvals` 表，不用這一份。
 */
export function createInMemoryApprovalLedger(): import("../approval.js").ApprovalLedger {
  const rows: import("../approval.js").ApprovalRequest[] = [];
  let sequence = 0;
  return {
    async record(request) {
      sequence += 1;
      const keyed = rows.filter((row) => row.approvalKey === request.approvalKey);
      const pending = keyed.find((row) => row.status === "pending");
      if (pending !== undefined) {
        return { kind: "existing", request: pending };
      }
      const decided = keyed
        .filter((row) => row.status === "approved" || row.status === "denied")
        .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt) || 0)
        .at(-1);
      if (decided !== undefined) {
        return { kind: "decided", request: decided };
      }
      const stored = { ...request, id: request.id || `apr_${sequence}` };
      rows.push(stored);
      return { kind: "created", request: stored };
    },
    async update(request) {
      const index = rows.findIndex((row) => row.id === request.id);
      if (index >= 0) {
        rows[index] = request;
      }
    },
    async get(requestId) {
      return rows.find((row) => row.id === requestId) ?? null;
    },
    async findByApprovalKey(approvalKey) {
      const keyed = rows.filter((row) => row.approvalKey === approvalKey);
      return (
        keyed.find((row) => row.status === "pending") ??
        keyed.sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)).at(-1) ??
        null
      );
    },
    async listPending(filter) {
      return rows.filter((row) => {
        if (row.status !== "pending") {
          return false;
        }
        if (
          filter?.conversationId !== undefined &&
          row.draft.conversationId !== filter.conversationId
        ) {
          return false;
        }
        if (filter?.rootConversationId !== undefined) {
          const root = row.draft.subagent?.rootConversationId ?? row.draft.conversationId;
          if (root !== filter.rootConversationId) {
            return false;
          }
        }
        return true;
      });
    },
    async commitDecision(decision) {
      const row = rows.find((entry) => entry.id === decision.requestId);
      if (row === undefined) {
        return "already-decided";
      }
      if (row.status !== "pending") {
        return "already-decided";
      }
      const index = rows.indexOf(row);
      rows[index] = {
        ...row,
        status: decision.verdict === "approve" ? "approved" : "denied",
        decision,
      };
      return "committed";
    },
  };
}
