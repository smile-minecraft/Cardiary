import { describe, expect, it } from "vitest";
import type { SpawnRegistry } from "../../host/src/spawn/wrapper.js";
import { CardVectors } from "../../host/src/modules/retrieval/vectors.js";

describe("向量檢索的同意邊界", () => {
  it("未同意時不建立子行程、不讀寫索引並回空結果", async () => {
    let opened = 0;
    let spawned = 0;
    const spawn = {
      spawn() {
        spawned += 1;
        throw new Error("不應建立子行程");
      },
    } as unknown as SpawnRegistry;
    const vectors = new CardVectors(
      { get: async () => null } as never,
      () => {
        opened += 1;
        throw new Error("不應開啟快取");
      },
      () => false,
      spawn,
      "/nonexistent/cache",
      () => {},
    );
    expect(await vectors.search({ query: "任意" })).toEqual([]);
    expect(opened).toBe(0);
    expect(spawned).toBe(0);
    vectors.stop();
  });
});
