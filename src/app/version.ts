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
    "ویرایش نشانی، کلید و مدل‌های AI در نسخهٔ محلی پس از راه‌اندازی دوبارهٔ سرویس بازیابی می‌شود.",
    "دکمه‌های آزمون اتصال و مراحل فعال‌کردن آن‌ها در تنظیمات نمایش داده می‌شوند.",
  ],
  en: [
    "Edit the AI endpoint, key and model IDs after the local service restarts.",
    "Settings shows both model tests and how to enable them.",
  ],
} satisfies Record<Locale, readonly string[]>;
