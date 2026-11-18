/**
 * 產品時區的日期鍵。
 *
 * 核心組「一天最多變動一次」、每日蒸餾的 run 與復原都共用同一個日期鍵：
 * 使用者所在地的日曆日（行程的在地時區）。以 UTC 取日會讓台灣的凌晨活動
 * 落到前一個 UTC 日，蒸餾與前一日白天的變更就會被誤判成同一天。
 */

/** 取 `YYYY-MM-DD` 的日曆日；格式不合法回 `null`。`timeZone` 省略時用在地時區。 */
export function localDayKey(value: Date | string, timeZone?: string): string | null {
  const ms = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone === undefined ? {} : { timeZone }),
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const pick = (type: "year" | "month" | "day"): string | undefined =>
    parts.find((part) => part.type === type)?.value;
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }
  return `${year}-${month}-${day}`;
}
