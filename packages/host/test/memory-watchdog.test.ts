import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MEMORY_CHECK_MS,
  DEFAULT_MEMORY_LIMIT_MB,
  EXIT_MEMORY_LIMIT,
  MemoryWatchdog,
  memoryLimitConfig,
} from "../src/memory-watchdog.js";

/** 規格第 13 章「記憶體」：主機自我監控 RSS，超標以結束碼 75 退出。 */

const MB = 1024 * 1024;

afterEach(() => {
  vi.useRealTimers();
});

describe("記憶體上限設定", () => {
  it("預設 1536 MB、每 30 秒量一次；結束碼是 75", () => {
    const config = memoryLimitConfig({});
    expect(config).toEqual({ limitBytes: 1536 * MB, intervalMs: 30_000 });
    expect(DEFAULT_MEMORY_LIMIT_MB).toBe(1536);
    expect(DEFAULT_MEMORY_CHECK_MS).toBe(30_000);
    expect(EXIT_MEMORY_LIMIT).toBe(75);
  });

  it("正式環境可以調高或調到安全門檻以上", () => {
    expect(memoryLimitConfig({ CARDIARY_MEMORY_LIMIT_MB: "2048" }).limitBytes).toBe(2048 * MB);
    expect(memoryLimitConfig({ CARDIARY_MEMORY_LIMIT_MB: "256" }).limitBytes).toBe(256 * MB);
    expect(memoryLimitConfig({ CARDIARY_MEMORY_CHECK_MS: "5000" }).intervalMs).toBe(5000);
  });

  it.each([
    ["低於 256 MB", { CARDIARY_MEMORY_LIMIT_MB: "64" }],
    [
      "低於門檻但 CARDIARY_TEST_FAULTS 不是 1",
      { CARDIARY_MEMORY_LIMIT_MB: "1", CARDIARY_TEST_FAULTS: "0" },
    ],
    ["不是數字", { CARDIARY_MEMORY_LIMIT_MB: "lots" }],
    ["零", { CARDIARY_MEMORY_LIMIT_MB: "0" }],
    ["負數", { CARDIARY_MEMORY_LIMIT_MB: "-5" }],
  ])("上限覆寫不合法或不在測試環境（%s）時退回預設並附說明", (_label, env) => {
    const config = memoryLimitConfig(env);
    expect(config.limitBytes).toBe(1536 * MB);
    expect(config.warning).toContain("CARDIARY_MEMORY_LIMIT_MB");
  });

  it.each([
    ["低於 1 秒", { CARDIARY_MEMORY_CHECK_MS: "50" }],
    ["不是整數", { CARDIARY_MEMORY_CHECK_MS: "1.5" }],
    ["不是數字", { CARDIARY_MEMORY_CHECK_MS: "soon" }],
  ])("量測間隔覆寫不合法或不在測試環境（%s）時退回預設", (_label, env) => {
    const config = memoryLimitConfig(env);
    expect(config.intervalMs).toBe(30_000);
    expect(config.warning).toContain("CARDIARY_MEMORY_CHECK_MS");
  });

  it("測試環境可以設很低的上限與很短的間隔", () => {
    const config = memoryLimitConfig({
      CARDIARY_TEST_FAULTS: "1",
      CARDIARY_MEMORY_LIMIT_MB: "1",
      CARDIARY_MEMORY_CHECK_MS: "50",
    });
    expect(config).toEqual({ limitBytes: 1 * MB, intervalMs: 50 });
  });

  it("空字串視為沒設定", () => {
    expect(
      memoryLimitConfig({ CARDIARY_MEMORY_LIMIT_MB: " ", CARDIARY_MEMORY_CHECK_MS: "" }),
    ).toEqual({ limitBytes: 1536 * MB, intervalMs: 30_000 });
  });
});

describe("記憶體監控", () => {
  it("沒超過上限時不回報；超過時只回報一次並停止", () => {
    const samples = [100, 200, 300, 900, 1200];
    const exceeded: Array<[number, number]> = [];
    const watchdog = new MemoryWatchdog({
      limitBytes: 1000,
      intervalMs: 10,
      sample: () => samples.shift() ?? 5000,
      onExceeded: (rss, limit) => exceeded.push([rss, limit]),
    });

    expect(watchdog.check()).toBe(false);
    expect(watchdog.check()).toBe(false);
    expect(watchdog.check()).toBe(false);
    expect(watchdog.check()).toBe(false);
    expect(exceeded).toEqual([]);
    expect(watchdog.check()).toBe(true);
    expect(exceeded).toEqual([[1200, 1000]]);
    // 回報之後不再量、不再回報。
    expect(watchdog.check()).toBe(false);
    expect(exceeded).toHaveLength(1);
  });

  it("剛好等於上限不算超過", () => {
    const onExceeded = vi.fn();
    const watchdog = new MemoryWatchdog({
      limitBytes: 1000,
      intervalMs: 10,
      sample: () => 1000,
      onExceeded,
    });
    expect(watchdog.check()).toBe(false);
    expect(onExceeded).not.toHaveBeenCalled();
  });

  it("start 依間隔量測，超標後計時器停止；stop 之後不再量", () => {
    vi.useFakeTimers();
    let rss = 100;
    let samples = 0;
    const onExceeded = vi.fn();
    const watchdog = new MemoryWatchdog({
      limitBytes: 1000,
      intervalMs: 50,
      sample: () => {
        samples += 1;
        return rss;
      },
      onExceeded,
    });
    watchdog.start();
    vi.advanceTimersByTime(160);
    expect(samples).toBe(3);
    expect(onExceeded).not.toHaveBeenCalled();

    rss = 2000;
    vi.advanceTimersByTime(50);
    expect(onExceeded).toHaveBeenCalledTimes(1);
    const after = samples;
    vi.advanceTimersByTime(500);
    expect(samples).toBe(after);

    const quiet = new MemoryWatchdog({
      limitBytes: 1000,
      intervalMs: 50,
      sample: () => 5000,
      onExceeded,
    });
    quiet.start();
    quiet.stop();
    vi.advanceTimersByTime(500);
    expect(onExceeded).toHaveBeenCalledTimes(1);
  });
});
