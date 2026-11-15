import { describe, expect, it } from "vitest";

import {
  computeFreshness,
  decayFreshness,
  linearFreshness,
  type FreshnessInput,
} from "../../src/freshness/index.js";

/**
 * 規格書第 7 章的新鮮度規則。
 *
 * 每一種情況都用注入的時間跑；不讀系統時鐘，所以半年後再跑結果一樣。
 * 白板釘選在 M4 才有介面，但純函式先照規則回 100，避免之後補規則時
 * 改動計算路徑。
 */

const DAY = 86_400_000;
const T0 = "2026-01-01T00:00:00.000Z";

function iso(offsetDays: number): string {
  return new Date(Date.parse(T0) + offsetDays * DAY).toISOString();
}

function input(overrides: Partial<FreshnessInput> = {}): FreshnessInput {
  return {
    state: { value: 100, at: T0, pinned: false, lifecycle: "live" },
    now: T0,
    halfLifeDays: 30,
    liveConversationCount: 1,
    orphaned: false,
    ...overrides,
  };
}

describe("新鮮度", () => {
  it("釘在白板永遠 100，不隨時間衰減", () => {
    const value = computeFreshness(
      input({
        state: { value: 37, at: T0, pinned: true, lifecycle: "live" },
        now: iso(365),
        liveConversationCount: 0,
        orphaned: true,
      }),
    );
    expect(value).toBe(100);
  });

  it("實際載入後回滿到 100", () => {
    // 載入的寫入端把 value 設回 100、at 設成載入時間；這裡驗計算不再扣。
    const value = computeFreshness(
      input({
        state: { value: 100, at: iso(10), pinned: false, lifecycle: "live" },
        now: iso(10),
        liveConversationCount: 1,
      }),
    );
    expect(value).toBe(100);
  });

  it("手動保鮮後回滿到 100", () => {
    const value = computeFreshness(
      input({
        state: { value: 100, at: iso(20), pinned: false, lifecycle: "live" },
        now: iso(20),
        liveConversationCount: 1,
      }),
    );
    expect(value).toBe(100);
  });

  it("平時以 30 天半衰期衰減：30 天後剩一半、60 天後剩四分之一", () => {
    expect(computeFreshness(input({ now: iso(30) }))).toBeCloseTo(50, 6);
    expect(computeFreshness(input({ now: iso(60) }))).toBeCloseTo(25, 6);
    // 從 80 開始也依同一個比例。
    expect(
      computeFreshness(
        input({
          state: { value: 80, at: T0, pinned: false, lifecycle: "live" },
          now: iso(15),
        }),
      ),
    ).toBeCloseTo(80 * Math.SQRT1_2, 6);
  });

  it("所屬對話全部封存時線性下降，倒數結束到 0", () => {
    const purgeAt = iso(7);
    const base = input({
      state: { value: 100, at: T0, pinned: false, lifecycle: "live" },
      liveConversationCount: 0,
      archivedConversationCount: 1,
      archivePurgeAt: purgeAt,
    });
    expect(computeFreshness({ ...base, now: iso(3.5) })).toBeCloseTo(50, 6);
    expect(computeFreshness({ ...base, now: iso(7) })).toBe(0);
    expect(computeFreshness({ ...base, now: iso(9) })).toBe(0);
    // 倒數開始前不回春。
    expect(computeFreshness({ ...base, now: iso(-1) })).toBe(100);
  });

  it("成為孤兒歸零，即使時間還在前一刻", () => {
    const value = computeFreshness(
      input({
        state: { value: 72, at: T0, pinned: false, lifecycle: "live" },
        now: iso(1),
        liveConversationCount: 0,
        orphaned: true,
      }),
    );
    expect(value).toBe(0);
  });

  it("多個對話引用時，只要還有一個未封存就按平時衰減", () => {
    const value = computeFreshness(
      input({
        now: iso(30),
        liveConversationCount: 1,
        archivedConversationCount: 2,
        archivePurgeAt: iso(7),
      }),
    );
    expect(value).toBeCloseTo(50, 6);
  });

  it("冷封存的卡保留原值，不再衰減", () => {
    const value = computeFreshness(
      input({
        state: { value: 12.5, at: T0, pinned: false, lifecycle: "cold" },
        now: iso(300),
        liveConversationCount: 0,
        orphaned: true,
      }),
    );
    expect(value).toBe(12.5);
  });

  it("時間往回走、格式不合法或半衰期非正數時不增加新鮮度", () => {
    expect(decayFreshness(50, iso(10), iso(5), 30)).toBe(50);
    expect(decayFreshness(50, "not-a-date", T0, 30)).toBe(50);
    expect(decayFreshness(50, T0, iso(30), 0)).toBe(50);
    expect(linearFreshness(50, T0, iso(7), "not-a-date")).toBe(50);
  });

  it("數值一律夾在 0 到 100", () => {
    expect(decayFreshness(150, T0, T0, 30)).toBe(100);
    expect(decayFreshness(-5, T0, iso(30), 30)).toBe(0);
    expect(linearFreshness(100, T0, iso(7), iso(3.5))).toBe(50);
  });
});
