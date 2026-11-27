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
    "کلید API حتی پیش از اتصال به سرویس قابل وارد کردن است.",
    "صفحه‌ها در اولین اجرای آنلاین برای استفادهٔ آفلاین ذخیره می‌شوند.",
    "نسخهٔ تازه در پس‌زمینه دانلود می‌شود و پس از بستن همهٔ پنجره‌های کالیو در اجرای بعدی فعال می‌شود.",
  ],
  en: [
    "Enter an API key even before the connection service is reachable.",
    "The first online launch caches the app pages for offline use.",
    "Updates download in the background and take effect after all Calio windows close.",
  ],
} satisfies Record<Locale, readonly string[]>;
