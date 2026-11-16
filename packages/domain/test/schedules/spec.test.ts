process.env.TZ = "UTC";
import { describe, expect, it } from "vitest";

import {
  MIN_INTERVAL_MS,
  ScheduleSpecError,
  computeFirstRun,
  computeNextRunAfter,
  parseScheduleKind,
  parseScheduleSpec,
  parseScheduleTask,
} from "../../src/schedules/index.js";

describe("排程規格解析", () => {
  it("kind 只接受 once／daily／interval／heartbeat；cron 不支援", () => {
    expect(parseScheduleKind("once")).toBe("once");
    expect(parseScheduleKind("daily")).toBe("daily");
    expect(parseScheduleKind("interval")).toBe("interval");
    expect(parseScheduleKind("heartbeat")).toBe("heartbeat");
    expect(() => parseScheduleKind("cron")).toThrowError(ScheduleSpecError);
    expect(() => parseScheduleKind("weekly")).toThrowError(/cron|once|daily|interval|heartbeat/);
  });

  it("once 的 at 必須是合法時間；daily 的 time 必須是 24 小時制", () => {
    expect(parseScheduleSpec("once", { at: "2026-11-20T04:00:00.000Z" })).toEqual({
      kind: "once",
      at: "2026-11-20T04:00:00.000Z",
    });
    expect(() => parseScheduleSpec("once", { at: "不是時間" })).toThrowError(/at/);
    expect(() => parseScheduleSpec("once", {})).toThrowError(/at/);
    expect(parseScheduleSpec("daily", { time: "04:00" })).toEqual({ kind: "daily", time: "04:00" });
    expect(parseScheduleSpec("daily", { time: "23:59" })).toEqual({ kind: "daily", time: "23:59" });
    expect(() => parseScheduleSpec("daily", { time: "24:00" })).toThrowError(/time/);
    expect(() => parseScheduleSpec("daily", { time: "4:00" })).toThrowError(/time/);
    expect(() => parseScheduleSpec("daily", { time: "03:00:30" })).toThrowError(/time/);
    expect(() => parseScheduleSpec("daily", "04:00")).toThrowError(/spec/);
  });

  it("interval／heartbeat 的每Ms 不得短於 5 分鐘", () => {
    expect(parseScheduleSpec("interval", { everyMs: MIN_INTERVAL_MS })).toEqual({
      kind: "interval",
      everyMs: MIN_INTERVAL_MS,
    });
    expect(() => parseScheduleSpec("interval", { everyMs: MIN_INTERVAL_MS - 1 })).toThrowError(
      /5 分鐘|300000/,
    );
    expect(() => parseScheduleSpec("heartbeat", { everyMs: 60_000 })).toThrowError(
      ScheduleSpecError,
    );
    expect(() => parseScheduleSpec("heartbeat", { everyMs: Number.NaN })).toThrowError(
      ScheduleSpecError,
    );
    expect(() => parseScheduleSpec("heartbeat", { everyMs: "300000" })).toThrowError(
      ScheduleSpecError,
    );
  });

  it("task 只接受 distillation 與帶 prompt 的 agent", () => {
    expect(parseScheduleTask({ type: "distillation" })).toEqual({ type: "distillation" });
    expect(parseScheduleTask({ type: "agent", prompt: "檢查" })).toEqual({
      type: "agent",
      prompt: "檢查",
    });
    expect(() => parseScheduleTask({ type: "agent", prompt: "   " })).toThrowError(/prompt/);
    expect(() => parseScheduleTask({ type: "shell" })).toThrowError(/task/);
    expect(() => parseScheduleTask(null)).toThrowError(/task/);
  });
});

describe("下次執行時間計算", () => {
  it("once 沒有下一次；interval／heartbeat 加上 everyMs", () => {
    expect(
      computeNextRunAfter(
        { kind: "once", at: "2026-11-20T04:00:00.000Z" },
        "2026-11-19T00:00:00.000Z",
      ),
    ).toBeNull();
    expect(
      computeNextRunAfter({ kind: "interval", everyMs: 30 * 60_000 }, "2026-11-16T10:00:00.000Z"),
    ).toBe("2026-11-16T10:30:00.000Z");
    expect(
      computeNextRunAfter({ kind: "heartbeat", everyMs: 10 * 60_000 }, "2026-11-16T10:00:00.000Z"),
    ).toBe("2026-11-16T10:10:00.000Z");
  });

  it("daily 取 after 之後最近的 HH:MM（含跨午夜）", () => {
    const after1 = "2026-11-16T03:00:00.000Z"; // 本機時區視執行環境；只驗差值邏輯
    const next = computeNextRunAfter({ kind: "daily", time: "04:00" }, after1);
    expect(next).not.toBeNull();
    expect(Number.isFinite(Date.parse(next as string))).toBe(true);
    // 晚於 after、且在 after 24 小時之內。
    const delta = Date.parse(next as string) - Date.parse(after1);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    // 跨午夜：time 01:30、after 23:00 → 差 2.5 小時。
    const after2 = "2026-11-16T23:00:00.000Z";
    const night = computeNextRunAfter({ kind: "daily", time: "01:30" }, after2);
    expect(Date.parse(night as string) - Date.parse(after2)).toBeLessThanOrEqual(3 * 3600 * 1000);
  });

  it("computeFirstRun：once 用 at、daily 找今天或明天、interval 從現在往後推", () => {
    expect(
      computeFirstRun({ kind: "once", at: "2026-11-20T04:00:00.000Z" }, "2026-11-16T00:00:00.000Z"),
    ).toBe("2026-11-20T04:00:00.000Z");
    const first = computeFirstRun({ kind: "daily", time: "04:00" }, "2026-11-16T10:00:00.000Z");
    expect(Date.parse(first)).toBeGreaterThan(Date.parse("2026-11-16T10:00:00.000Z"));
    expect(
      computeFirstRun({ kind: "interval", everyMs: 6 * 60_000 }, "2026-11-16T10:00:00.000Z"),
    ).toBe("2026-11-16T10:06:00.000Z");
  });
});
