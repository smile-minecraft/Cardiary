import { afterEach, describe, expect, it } from "vitest";

import { fakeVector, testEmbedder } from "../../../src/modules/retrieval/test-seam.js";

/**
 * 假嵌入器只在測試環境生效：`CARDIARY_TEST_FAULTS=1` 且 `CARDIARY_TEST_EMBEDDER=fake`。
 * 正式組裝少了任何一個旗標都要回 `undefined`，模組改用本機嵌入模型。
 */

const saved = {
  faults: process.env.CARDIARY_TEST_FAULTS,
  embedder: process.env.CARDIARY_TEST_EMBEDDER,
};

function setEnv(faults: string | undefined, embedder: string | undefined): void {
  if (faults === undefined) delete process.env.CARDIARY_TEST_FAULTS;
  else process.env.CARDIARY_TEST_FAULTS = faults;
  if (embedder === undefined) delete process.env.CARDIARY_TEST_EMBEDDER;
  else process.env.CARDIARY_TEST_EMBEDDER = embedder;
}

afterEach(() => {
  setEnv(saved.faults, saved.embedder);
});

describe("檢索的測試接縫", () => {
  it.each([
    ["兩個旗標都沒有", undefined, undefined],
    ["只有 CARDIARY_TEST_EMBEDDER", undefined, "fake"],
    ["CARDIARY_TEST_FAULTS 不是 1", "0", "fake"],
    ["CARDIARY_TEST_FAULTS 是 true 字串", "true", "fake"],
    ["只有 CARDIARY_TEST_FAULTS", "1", undefined],
    ["嵌入器名稱不是 fake", "1", "real"],
  ])("%s 時不換成假嵌入器", (_label, faults, embedder) => {
    setEnv(faults, embedder);
    expect(testEmbedder()).toBeUndefined();
  });

  it("兩個旗標都對時回決定性的假嵌入器", async () => {
    setEnv("1", "fake");
    const embedder = testEmbedder();
    expect(embedder).toBeDefined();

    const first = await embedder!.embed("同一段文字");
    const second = await embedder!.embed("同一段文字");
    const other = await embedder!.embed("另一段文字");

    expect(first).toHaveLength(16);
    expect([...first]).toEqual([...second]);
    expect([...first]).not.toEqual([...other]);
    expect([...first].every((value) => value >= -1 && value < 1)).toBe(true);
    expect([...fakeVector("同一段文字")]).toEqual([...first]);
    embedder!.stop();
  });
});
