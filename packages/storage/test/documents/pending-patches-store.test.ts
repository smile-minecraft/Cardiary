process.env.TZ = "UTC";
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { PendingPatchesStore, type Storage } from "../../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function fixture(start = "2026-01-01T00:00:00.000Z"): {
  readonly store: PendingPatchesStore;
  readonly storage: Storage;
  readonly temp: TempRoot;
  readonly advance: (ms: number) => void;
} {
  const temp = createTempRoot("m3-pending-patches");
  const storage = openTestStorage(temp);
  cleanups.push(() => storage.close());
  cleanups.push(() => rmSync(temp.root, { recursive: true, force: true }));
  let current = Date.parse(start);
  return {
    storage,
    temp,
    store: new PendingPatchesStore(storage.state, {
      now: () => new Date(current),
    }),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("待決補丁儲存", () => {
  it("提出後一律是 pending，可列出、可讀回，附來源", () => {
    const { store } = fixture();
    const proposed = store.propose({
      cardId: "card-a",
      baseRevision: "rev-1",
      patch: { format: "unified", text: "@@ -1 +1 @@\n-old\n+new" },
      summary: "改個字",
      sourceConversationId: "conv-1",
      sourceTurnId: "turn-1",
    });

    expect(proposed.status).toBe("pending");
    expect(proposed.patchId).toMatch(/^patch_/);
    expect(proposed.cardId).toBe("card-a");
    expect(proposed.baseRevision).toBe("rev-1");
    expect(proposed.patch).toEqual({ format: "unified", text: "@@ -1 +1 @@\n-old\n+new" });
    expect(proposed.summary).toBe("改個字");
    expect(proposed.sourceConversationId).toBe("conv-1");
    expect(proposed.sourceTurnId).toBe("turn-1");
    expect(proposed.decidedAt).toBeUndefined();
    expect(store.get(proposed.patchId)).toEqual(proposed);
    expect(store.list({ status: "pending" })).toEqual([proposed]);
    expect(store.countPending("card-a")).toBe(1);
    expect(store.countPending("card-b")).toBe(0);
  });

  it("決定後留下時間與結果，重複決定回 null", () => {
    const { store, advance } = fixture();
    const proposed = store.propose({
      cardId: "card-a",
      baseRevision: "rev-1",
      patch: { format: "replace", text: "新內文" },
    });
    advance(1000);

    const accepted = store.decide(proposed.patchId, "accepted");
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.decidedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(store.decide(proposed.patchId, "rejected")).toBeNull();
    expect(store.list({ status: "pending" })).toEqual([]);
    expect(store.countPending()).toBe(0);
    expect(store.list({ cardId: "card-a" })).toHaveLength(1);
  });

  it("不同卡片可分別篩選，刪卡時一起清掉", () => {
    const { store } = fixture();
    const first = store.propose({
      cardId: "card-a",
      baseRevision: "rev-1",
      patch: { format: "replace", text: "A" },
    });
    store.propose({
      cardId: "card-b",
      baseRevision: "rev-2",
      patch: { format: "replace", text: "B" },
    });

    expect(store.list({ cardId: "card-a" }).map((patch) => patch.patchId)).toEqual([first.patchId]);
    expect(store.deleteCard("card-a")).toBe(1);
    expect(store.get(first.patchId)).toBeNull();
    expect(store.countPending()).toBe(1);
  });

  it("狀態與格式有 CHECK 約束", () => {
    const { storage } = fixture();
    expect(() =>
      storage.state.run(
        `INSERT INTO pending_card_patches
          (patch_id, card_id, base_revision, patch_format, patch_text, status, created_at)
         VALUES ('p1', 'c', 'r', 'oops', 't', 'pending', 'now')`,
      ),
    ).toThrowError(/CHECK/);
    expect(() =>
      storage.state.run(
        `INSERT INTO pending_card_patches
          (patch_id, card_id, base_revision, patch_format, patch_text, status, created_at)
         VALUES ('p2', 'c', 'r', 'unified', 't', 'done', 'now')`,
      ),
    ).toThrowError(/CHECK/);
  });
});
