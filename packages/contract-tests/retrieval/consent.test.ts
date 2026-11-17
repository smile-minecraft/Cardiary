import { describe, expect, it } from "vitest";
import type { SpawnRegistry } from "../../host/src/spawn/wrapper.js";
import {
  CardVectors,
  type RetrievalStatus,
} from "../../host/src/modules/retrieval/vectors.js";

describe("向量檢索的同意邊界", () => {
  it("未同意時不建立子行程、不讀寫索引，refresh 只回報 disabled", async () => {
    let opened = 0;
    let spawned = 0;
    const spawn = {
      spawn() {
        spawned += 1;
        throw new Error("不應建立子行程");
      },
    } as unknown as SpawnRegistry;
    const statuses: RetrievalStatus[] = [];
    const vectors = new CardVectors({
      library: { get: async () => null } as never,
      database: () => {
        opened += 1;
        throw new Error("不應開啟快取");
      },
      allowed: () => false,
      spawn,
      cache: "/nonexistent/cache",
      warn: () => {},
      onStatus: (status) => statuses.push(status),
    });
    vectors.refresh();
    expect(await vectors.search({ query: "任意" })).toEqual([]);
    expect(opened).toBe(0);
    expect(spawned).toBe(0);
    expect(statuses).toEqual([
      { state: "disabled", reason: "consent-required", fallback: "fts" },
    ]);
    vectors.stop();
  });
});
