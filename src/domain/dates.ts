import { z } from "zod";

export const localDate = z.iso.date();
export const timestamp = z.iso.datetime();
export const calendarSchema = z.enum(["persian", "gregory"]);
export const localeSchema = z.enum(["fa", "en"]);
export type Calendar = z.infer<typeof calendarSchema>;
export type Locale = z.infer<typeof localeSchema>;

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => {
    if (/^[+-]/.test(value)) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });

export function normalizeDigits(text: string) {
  return text
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function parseDecimal(text: string): number | null {
  const value = normalizeDigits(text).trim().replace("٫", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function dateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(instant);

  const part = (key: Intl.DateTimeFormatPartTypes) =>
    parts.find(({ type }) => type === key)?.value;
  return localDate.parse(
    `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}`,
  );
}

// UTC is used for arithmetic on date-only values, never as a diary timezone.
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${localDate.parse(date)}T00:00:00Z`);
  if (!Number.isSafeInteger(days)) throw new RangeError("date_offset");
  value.setUTCDate(value.getUTCDate() + days);
  return localDate.parse(value.toISOString().slice(0, 10));
}

export function dateDistance(start: string, end: string): number {
  return (
    (Date.parse(localDate.parse(end)) - Date.parse(localDate.parse(start))) /
    86_400_000
  );
}

export function numberingSystem(locale: Locale) {
  return locale === "fa" ? "arabext" : "latn";
}

export function numberFormatter(
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat(locale, {
    ...options,
    numberingSystem: numberingSystem(locale),
  });
}

export function formatDate(
  date: string,
  locale: Locale,
  calendar: Calendar,
): string {
  return new Intl.DateTimeFormat(locale, {
    calendar,
    numberingSystem: numberingSystem(locale),
    timeZone: "UTC",
    dateStyle: "long",
  }).format(new Date(`${localDate.parse(date)}T12:00:00Z`));
}
