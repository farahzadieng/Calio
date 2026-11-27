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
    "پردازش یک‌جای یادداشت و محاسبهٔ کالری بر اساس واحدهایی مثل عدد، قالب و مشت.",
    "ذخیرهٔ مرجع هر ۱۰۰ گرم و هر واحد مصرف در کتابخانه برای استفادهٔ دوباره.",
  ],
  en: [
    "Process whole notes together and calculate calories for units such as pieces, blocks and handfuls.",
    "Reuse per-100 and per-serving references from the food library.",
  ],
} satisfies Record<Locale, readonly string[]>;
