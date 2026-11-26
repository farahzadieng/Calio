import type { Period } from "../db/records";
import { localDate, shiftDate, type Locale } from "./dates";

export function alignedWeekStart(date: string, locale: Locale) {
  const weekday = new Date(`${localDate.parse(date)}T12:00:00Z`).getUTCDay();
  const startDay = locale === "fa" ? 6 : 1;
  return shiftDate(date, -((weekday - startDay + 7) % 7));
}

export function calendarMonth(
  date: string,
  locale: Locale,
  offset = 0,
): Period {
  localDate.parse(date);
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 120)
    throw new RangeError("month_offset");
  const formatter = new Intl.DateTimeFormat("en", {
    calendar: locale === "fa" ? "persian" : "gregory",
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    numberingSystem: "latn",
  });
  function parts(value: string) {
    const values = formatter.formatToParts(new Date(`${value}T12:00:00Z`));
    return {
      day: Number(values.find(({ type }) => type === "day")?.value),
      month: Number(values.find(({ type }) => type === "month")?.value),
      year: Number(values.find(({ type }) => type === "year")?.value),
    };
  }
  function monthStart(value: string) {
    return shiftDate(value, 1 - parts(value).day);
  }
  function nextStart(start: string) {
    let candidate = shiftDate(start, 28);
    const prior = parts(start);
    while (
      parts(candidate).month === prior.month &&
      parts(candidate).year === prior.year
    )
      candidate = shiftDate(candidate, 1);
    return candidate;
  }
  let start = monthStart(date);
  for (
    let remaining = offset;
    remaining !== 0;
    remaining += remaining < 0 ? 1 : -1
  ) {
    start = remaining < 0 ? monthStart(shiftDate(start, -1)) : nextStart(start);
  }
  return { start, end: shiftDate(nextStart(start), -1), id: start };
}
