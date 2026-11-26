import packageInfo from "../../package.json" with { type: "json" };
import { numberFormatter, type Locale } from "../domain/dates";

export const APP_VERSION = packageInfo.version;

export function displayAppVersion(locale: Locale) {
  const label = APP_VERSION.replace(/^(\d+\.\d+)\.0$/, "$1");
  if (locale === "en") return label;
  const formatter = numberFormatter(locale, { useGrouping: false });
  return label
    .replaceAll(".", "/")
    .replace(/[0-9]/g, (digit) => formatter.format(Number(digit)));
}

export const latestReleaseNotes = {
  fa: [
    "نسخهٔ اپ و فهرست تغییرات از تنظیمات در دسترس‌اند.",
    "پس از انتخاب زبان، راهنمای کوتاه ثبت خوراک و مشاهدهٔ گزارش‌ها نمایش داده می‌شود.",
  ],
  en: [
    "See the app version and release notes in Settings.",
    "After choosing a language, get a quick guide to logging food and viewing reports.",
  ],
} satisfies Record<Locale, readonly string[]>;
