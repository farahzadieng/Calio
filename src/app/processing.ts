import { DirectAiTransport } from "../ai/browser";
import type { CalioDatabase } from "../db/database";
import { alignedWeekStart } from "../domain/calendar-periods";
import { dateInTimeZone, type Locale } from "../domain/dates";
import { processNotes } from "../services/food-processing";
import { processForegroundWeeks } from "../services/weekly";

export const healthFreshMs = 24 * 60 * 60_000;

export async function healthIsRecent(db: CalioDatabase, now = new Date()) {
  const latest = await db.health_imports.orderBy("importedAt").last();
  if (!latest) return false;
  const elapsed = now.getTime() - new Date(latest.importedAt).getTime();
  return elapsed >= 0 && elapsed <= healthFreshMs;
}

export async function runManualAnalysis(
  db: CalioDatabase,
  locale: Locale,
  date: string,
) {
  const notes = await db.journal_entries
    .where("localDate")
    .equals(date)
    .filter((note) => note.status === "pending")
    .toArray();
  if (!notes.length) return "empty";
  if (!(await db.settings.get("settings"))?.aiConsentAt) return "unavailable";
  if (!navigator.onLine) return "error";
  const transport = await DirectAiTransport.connect(db);
  if (!transport) return "unavailable";
  if (!(await healthIsRecent(db))) return "sync";
  const results = await processNotes(db, transport, {
    locale,
    notes,
    explicit: true,
  });
  return results.length && results.every(({ status }) => status !== "failed")
    ? "done"
    : "error";
}

export async function runOnForeground(
  db: CalioDatabase,
  regeneratePeriodId?: string,
) {
  if (!navigator.onLine || document.visibilityState !== "visible") return [];
  const [profile, settings] = await Promise.all([
    db.profile.get("profile"),
    db.settings.get("settings"),
  ]);
  if (!profile || !settings?.aiConsentAt) return [];
  const now = new Date();
  const transport = await DirectAiTransport.connect(db);
  if (!transport) return [];
  return processForegroundWeeks(db, transport, {
    now,
    locale: settings.locale,
    visible: true,
    online: true,
    regeneratePeriodId,
    policy: {
      firstStart: alignedWeekStart(
        dateInTimeZone(new Date(profile.createdAt), settings.timeZone),
        settings.locale,
      ),
      timeZone: settings.timeZone,
      minimumFreshDays: 0,
      maxSyncAgeMs: healthFreshMs,
    },
  });
}
