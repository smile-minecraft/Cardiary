import { describe, expect, it } from "vitest";

import { ApprovalServiceImpl } from "../src/internal/approval-service.js";
import { createInMemoryApprovalLedger } from "../src/index.js";
import type { ApprovalLedger, ApprovalRequestDraft, ApprovalUpdate } from "../src/index.js";

/**
 * 審批到期在計時器比時鐘早觸發時仍要成立。
 *
 * Node 的計時器可能比 `Date.now()` 早約 1 ms 觸發；注入的時鐘也可能落後。
 * 這裡用一個停住的時鐘重現：計時器先觸發、時鐘還沒到 `expiresAt`，
 * 之後時鐘推進，請求仍要被標成 expired，等待者要被喚醒。
 */

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

function draft(toolCallId: string, timeoutMs: number): ApprovalRequestDraft {
  return {
    conversationId: "conv-expiry",
    turnId: "turn_1",
    toolCallId,
    action: { kind: "tool-execution", summary: "等一下", toolName: "wait", toolInput: {} },
    risk: "low",
    requestedBy: { kind: "tool", toolName: "wait" },
    timeoutMs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 在 `ms` 內沒有結果就回 `"pending"`，不讓整個測試卡到逾時。 */
function within<T>(promise: Promise<T>, ms: number): Promise<T | "pending"> {
  return Promise.race([promise, sleep(ms).then(() => "pending" as const)]);
}

describe("審批到期", () => {
  it("計時器比時鐘早觸發時重新排程，時鐘到了就標成 expired", async () => {
    const clock = { ms: T0 };
    const service = new ApprovalServiceImpl({
      ledger: createInMemoryApprovalLedger(),
      clock: { now: () => new Date(clock.ms) },
    });
    const request = await service.request(draft("call-early", 10));
    const waiting = service.waitForDecision(request.id);

    // 真實時間已過 10 ms，計時器都觸發過了，但時鐘還停在建立當下。
    expect(await within(waiting, 40)).toBe("pending");
    expect((await service.get(request.id))?.status).toBe("pending");

    clock.ms = T0 + 10;
    const resolution = await within(waiting, 500);
    expect(resolution).not.toBe("pending");
    expect(resolution).toMatchObject({ outcome: "expired" });
    expect((await service.get(request.id))?.status).toBe("expired");
  });

  it("建立與等待各排的計時器同時到期，只寫一次、只發布一次 resolved", async () => {
    const inner = createInMemoryApprovalLedger();
    let updates = 0;
    // ledger 寫入刻意放慢，讓兩個到期路徑在寫入期間重疊。
    const ledger: ApprovalLedger = {
      ...inner,
      async update(request) {
        updates += 1;
        await sleep(20);
        return inner.update(request);
      },
    };
    const clock = { ms: T0 };
    const service = new ApprovalServiceImpl({ ledger, clock: { now: () => new Date(clock.ms) } });
    const resolved: ApprovalUpdate[] = [];
    service.subscribe((update) => {
      if (update.kind === "resolved") resolved.push(update);
    });
    const request = await service.request(draft("call-twice", 10));
    const first = service.waitForDecision(request.id);
    const second = service.waitForDecision(request.id);

    await sleep(30);
    clock.ms = T0 + 10;
    const results = await within(Promise.all([first, second]), 500);

    expect(results).not.toBe("pending");
    expect((results as Awaited<typeof first>[]).map((result) => result.outcome)).toEqual([
      "expired",
      "expired",
    ]);
    expect(updates).toBe(1);
    expect(resolved).toHaveLength(1);
  });

  it("決定之後到期計時器不再把請求改成 expired", async () => {
    const clock = { ms: T0 };
    const service = new ApprovalServiceImpl({
      ledger: createInMemoryApprovalLedger(),
      clock: { now: () => new Date(clock.ms) },
    });
    const request = await service.request(draft("call-decided", 10));
    const waiting = service.waitForDecision(request.id);
    await service.decide({
      requestId: request.id,
      verdict: "approve",
      decidedBy: { kind: "human", clientId: "client-test" },
    });

    clock.ms = T0 + 10;
    await sleep(30);

    expect(await waiting).toMatchObject({ outcome: "approved" });
    expect((await service.get(request.id))?.status).toBe("approved");
  });
});
