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
    "تنظیمات اتصال و کلید API حتی آفلاین روی همین دستگاه ذخیره می‌شوند.",
    "آزمون مدل و پردازش هوش مصنوعی مستقیماً به ارائه‌دهندهٔ انتخابی وصل می‌شوند.",
  ],
  en: [
    "Save connection settings and your API key on this device, even offline.",
    "Model tests and AI processing connect directly to your provider.",
  ],
} satisfies Record<Locale, readonly string[]>;
