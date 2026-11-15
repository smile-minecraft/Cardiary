import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

import { detectCaseSensitivity } from "../../src/permissions/index.js";
import { makeFixture, mountPointOnSameVolume } from "./support.js";

/**
 * 這個檔案刻意自己一份：探測結果的快取是模組層級的，要在「還沒有任何路徑
 * 探測過」的狀態下重現「先探測掛載點、再寫 TMP/」的順序。
 */
const fixture = makeFixture();
afterAll(() => fixture.cleanup());

it("先探測掛載點得到的 unknown 不會讓同一個卷的路徑全部變成 unknown", () => {
  const mountPoint = mountPointOnSameVolume(fixture.root);
  if (mountPoint === null) {
    // 平台找不到同一個卷的掛載點時沒有東西可驗；`tmp/` 的守門由
    // isWithinTmpRoot 的注入測試覆蓋。
    return;
  }
  expect(detectCaseSensitivity(mountPoint)).toBe("unknown");
  // 修好之前，這一行會拿到掛載點快取下來的 unknown，於是大小寫敏感卷上的
  // `TMP/` 會折疊成 `tmp/` 而被自動放行。
  expect(detectCaseSensitivity(fixture.folder)).not.toBe("unknown");
  expect(detectCaseSensitivity(join(fixture.folder, "state", "cardiary.sqlite"))).not.toBe(
    "unknown",
  );
});
