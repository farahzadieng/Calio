import type { CalioDatabase } from "../db/database";
import { dateInTimeZone, timeZoneSchema } from "../domain/dates";
import {
  healthDayFromRow,
  healthDaySchema,
  healthImportSchema,
  mergeHealthDay,
  parseHealthText,
} from "../domain/health";
import { sha256 } from "./hash";

export type HealthImportPolicy = {
  timeZone: string;
  minimumRestingKcal: number;
  missingToken: string | null;
};

export async function importHealthText(
  db: CalioDatabase,
  text: string,
  policy: HealthImportPolicy,
  now = new Date(),
) {
  timeZoneSchema.parse(policy.timeZone);
  if (
    !Number.isFinite(policy.minimumRestingKcal) ||
    policy.minimumRestingKcal < 0
  ) {
    throw new RangeError("health_policy");
  }
  const rows = parseHealthText(text, policy.missingToken).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const fingerprint = await sha256(JSON.stringify(rows));
  const today = dateInTimeZone(now, policy.timeZone);
  const importedAt = now.toISOString();
  const importId = crypto.randomUUID();
  const incoming = rows.map((row) =>
    healthDaySchema.parse(
      healthDayFromRow(row, { ...policy, today, importedAt, importId }),
    ),
  );
  const metadata = healthImportSchema.parse({
    id: importId,
    importedAt,
    fingerprint,
    start: rows.at(0)?.date,
    end: rows.at(-1)?.date,
    count: rows.length,
    incompleteDays: incoming.filter((row) =>
      [row.restingKcal, row.activeKcal, row.steps, row.distanceKm].some(
        ({ status }) => status !== "valid",
      ),
    ).length,
  });
  return db.transaction(
    "rw",
    [
      db.health_daily,
      db.health_imports,
      db.ai_reports,
      db.messages,
      db.processing_queue,
    ],
    async () => {
      const previous = await db.health_imports
        .where("fingerprint")
        .equals(fingerprint)
        .first();
      if (previous && previous.importedAt >= importedAt)
        return { duplicate: true, ...previous };
      const record = previous ? { ...metadata, id: previous.id } : metadata;
      const observations = previous
        ? rows.map((row) =>
            healthDayFromRow(row, {
              ...policy,
              today,
              importedAt,
              importId: previous.id,
            }),
          )
        : incoming;
      const existing = await db.health_daily.bulkGet(
        observations.map(({ date }) => date),
      );
      const fields = [
        "restingKcal",
        "activeKcal",
        "steps",
        "distanceKm",
      ] as const;
      const merged = observations.map((day, index) => {
        const old = existing[index];
        const result = mergeHealthDay(old, day);
        if (previous && old) {
          // Refresh replay provenance without replacing a later correction.
          for (const field of fields) {
            if (old[field].importId !== previous.id) result[field] = old[field];
          }
        }
        return result;
      });
      await db.health_daily.bulkPut(merged);
      await db.health_imports.put(record);
      const measurementsChanged = new Set(
        merged
          .filter((day, index) => {
            const old = existing[index];
            if (!old) return true;
            return fields.some(
              (field) =>
                day[field].value !== old[field].value ||
                day[field].status !== old[field].status,
            );
          })
          .map(({ date }) => date),
      );
      const changedIn = (period: { start: string; end: string }) =>
        [...measurementsChanged].some(
          (date) => date >= period.start && date <= period.end,
        );
      await db.ai_reports
        .filter(
          (report) => report.status === "ready" && changedIn(report.period),
        )
        .modify({ status: "stale" });
      await db.processing_queue
        .filter(
          (job) =>
            job.period !== null &&
            ["reporting", "ready"].includes(job.stage) &&
            changedIn(job.period),
        )
        .modify({ stage: "stale", leaseOwner: null, leaseUntil: null });
      await db.messages
        .filter(
          (message) =>
            message.kind === "weekly_ready" &&
            message.period !== null &&
            changedIn(message.period),
        )
        .delete();
      return { duplicate: !!previous, ...record };
    },
  );
}
