import { afterEach, describe, expect, it } from "vitest";

import {
  CardLifecycleStore,
  CoreMemoryStore,
  DistillationStore,
} from "../../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup(now?: () => Date) {
  const temp: TempRoot = createTempRoot("memory-store");
  const storage = openTestStorage(temp);
  cleanups.push(storage.close.bind(storage));
  cleanups.push(temp.cleanup);
  const store = new DistillationStore(storage.state, now === undefined ? {} : { now });
  const core = new CoreMemoryStore(storage.state, now === undefined ? {} : { now });
  const lifecycle = new CardLifecycleStore(storage.state, now === undefined ? {} : { now });
  return { storage, store, core, lifecycle };
}

describe("DistillationStore：run 與單元", () => {
  it("一天一個 run；同日再建立回傳既有run", () => {
    const { store } = setup();
    const first = store.createRun({ persona: "default", day: "2026-11-16" });
    expect(first.status).toBe("running");
    expect(first.runId).toMatch(/^dst_/);
    const again = store.createRun({ persona: "default", day: "2026-11-16" });
    expect(again.runId).toBe(first.runId);
    expect(store.getRun(first.runId)?.day).toBe("2026-11-16");
    expect(store.findRunByDay("default", "2026-11-16")?.runId).toBe(first.runId);
    // 不同日可再開。
    const next = store.createRun({ persona: "default", day: "2026-11-17" });
    expect(next.runId).not.toBe(first.runId);
  });

  it("單元的 upsert 幂等，選填欄位不被 null 抹掉", () => {
    const { store } = setup();
    const run = store.createRun({ persona: "default", day: "2026-11-16" });
    const base = {
      runId: run.runId,
      batchId: "batch_1",
      persona: "default",
      sourceCardId: "card_src",
      phase: "extract" as const,
      status: "pending" as const,
    };
    store.upsertItem({
      ...base,
      itemKey: "card_src:extract",
      contentHash: "hash_1",
      outputCardId: "card_out",
      detailJson: '{"items":[]}',
    });
    const pending = store.getItem(run.runId, "card_src:extract");
    expect(pending?.contentHash).toBe("hash_1");
    expect(pending?.outputCardId).toBe("card_out");
    // 只更新 status，其他欄位保留。
    store.upsertItem({ ...base, itemKey: "card_src:extract", status: "done" });
    const done = store.getItem(run.runId, "card_src:extract");
    expect(done?.status).toBe("done");
    expect(done?.contentHash).toBe("hash_1");
    expect(done?.outputCardId).toBe("card_out");
  });

  it("中斷判斷：running 且早於門檻時間才回傳", () => {
    const times = [
      new Date("2026-11-16T03:00:00.000Z"),
      new Date("2026-11-16T05:00:00.000Z"),
    ];
    let index = 0;
    const { store } = setup(() => times[index++ % times.length] as Date);
    const old = store.createRun({ persona: "default", day: "2026-11-16" });
    const recent = store.createRun({ persona: "default", day: "2026-11-17" });
    const interrupted = store.findInterruptedRuns("2026-11-16T03:30:00.000Z");
    expect(interrupted.map((run) => run.runId)).toContain(old.runId);
    expect(interrupted.map((run) => run.runId)).not.toContain(recent.runId);
    store.finishRun({ runId: old.runId, status: "completed" });
    expect(store.findInterruptedRuns("2026-11-16T03:30:00.000Z").map((r) => r.runId)).not.toContain(
      old.runId,
    );
  });

  it("跨批次去重：排除 failed、undone、無輸出卡與同批次", () => {
    const { store } = setup();
    const run = store.createRun({ persona: "default", day: "2026-11-16" });
    const base = {
      runId: run.runId,
      persona: "default",
      phase: "merge" as const,
      sourceCardId: "src",
    };
    store.upsertItem({
      ...base,
      itemKey: "a",
      batchId: "batch_old",
      status: "done",
      contentHash: "same",
      outputCardId: "card_1",
    });
    // 同批次不列入。
    expect(
      store.findCrossBatchMatch({ persona: "default", contentHash: "same", excludeBatchId: "batch_old" }),
    ).toBeNull();
    // 不同批次命中。
    expect(
      store.findCrossBatchMatch({ persona: "default", contentHash: "same", excludeBatchId: "batch_new" })?.outputCardId,
    ).toBe("card_1");
    // undone 不列入。
    store.markUndone(run.runId, "a");
    expect(
      store.findCrossBatchMatch({ persona: "default", contentHash: "same", excludeBatchId: "batch_new" }),
    ).toBeNull();
  });
});

describe("CoreMemoryStore", () => {
  it("增刪與每日計數在同一交易；一天只標記一次", () => {
    const { core, storage } = setup();
    expect(core.list("default")).toEqual([]);
    expect(core.change({ persona: "default", day: "2026-11-16", op: "add", cardId: "card_a" })).toBe(true);
    expect(core.list("default").map((e) => e.cardId)).toEqual(["card_a"]);
    expect(core.getDaily("default", "2026-11-16")?.changed).toBe(true);
    // 重複加入不變動，也不再標記。
    expect(core.change({ persona: "default", day: "2026-11-16", op: "add", cardId: "card_a" })).toBe(false);
    expect(core.getDaily("default", "2026-11-16")?.changed).toBe(true);
    // 一天只寫一列。
    expect(storage.state.countRows("core_memory_daily")).toBe(1);
    expect(core.change({ persona: "default", day: "2026-11-17", op: "remove", cardId: "card_a" })).toBe(true);
    expect(core.list("default")).toEqual([]);
    expect(core.getDaily("default", "2026-11-17")?.changed).toBe(true);
  });

  it("固定順序 added_day, card_id 升冪", () => {
    const { core } = setup();
    core.add({ persona: "default", cardId: "card_z", addedDay: "2026-11-15", source: "import" });
    core.add({ persona: "default", cardId: "card_a", addedDay: "2026-11-16", source: "distillation" });
    core.add({ persona: "default", cardId: "card_b", addedDay: "2026-11-15", source: "user" });
    expect(core.list("default").map((e) => e.cardId)).toEqual(["card_b", "card_z", "card_a"]);
  });
});

describe("CardLifecycleStore", () => {
  it("live → cold → live 只改 card_state，不動卡片檔", () => {
    const { storage, lifecycle } = setup();
    storage.state.run(
      `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, updated_at)
       VALUES ('c1', 'default', 0, 'now', 'live', 'now')`,
    );
    expect(lifecycle.getLifecycle("c1")).toBe("live");
    expect(lifecycle.cold(["c1"])).toBe(1);
    expect(lifecycle.getLifecycle("c1")).toBe("cold");
    expect(lifecycle.cold(["c1"])).toBe(0); // 幂等
    expect(lifecycle.live(["c1"])).toBe(1);
    expect(lifecycle.getLifecycle("c1")).toBe("live");
    const fresh = storage.state.get<{ freshness: number }>(
      "SELECT freshness FROM card_state WHERE card_id = 'c1'",
    );
    expect(fresh?.freshness).toBe(0); // 新鮮度不回滿
  });

  it("只挑 live 且歸零、未取代的候選", () => {
    const { storage, lifecycle } = setup();
    storage.state.run(
      `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, updated_at)
       VALUES ('zero', 'default', 0, 'now', 'live', 'now'),
              ('fresh', 'default', 50, 'now', 'live', 'now'),
              ('cold', 'default', 0, 'now', 'cold', 'now'),
              ('replaced', 'default', 0, 'now', 'live', 'now')`,
    );
    storage.state.run(
      "UPDATE card_state SET superseded_by = 'other' WHERE card_id = 'replaced'",
    );
    const picked = lifecycle.listFreshnessZeroCandidates("default");
    expect(picked.map((c) => c.cardId)).toEqual(["zero"]);
  });
});
