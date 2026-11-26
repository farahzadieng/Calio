import { applicableReferences } from "../domain/references";
import {
  AiFailure,
  promptVersion,
  validateWeekly,
  type AiTransport,
  type Input,
} from "../ai/contracts";
import { requestAi } from "../ai/request";
import type { CalioDatabase } from "../db/database";
import type { Period } from "../db/records";
import { dateInTimeZone, shiftDate, type Locale } from "../domain/dates";
import { measuredExpenditure } from "../domain/health";
import { completedWeeks, type WeeklyPolicy } from "../domain/periods";
import { processNotes } from "./food-processing";
import { sha256 } from "./hash";
import {
  aggregateDays,
  frequentFoods,
  insightTables,
  periodSnapshot,
  readPeriod,
} from "./insights";
import { advanceJob, claimJob, releaseJob, requireLease } from "./jobs";

type Snapshot = Awaited<ReturnType<typeof readPeriod>>;

function freshness(snapshot: Snapshot, end: string, timeZone: string) {
  const firstDueDate = shiftDate(end, 1);
  return snapshot.health.filter(
    (day) =>
      measuredExpenditure(day) !== null &&
      dateInTimeZone(new Date(day.restingKcal.importedAt), timeZone) >=
        firstDueDate &&
      dateInTimeZone(new Date(day.activeKcal.importedAt), timeZone) >=
        firstDueDate,
  ).length;
}

function reportInput(
  snapshot: Snapshot,
  period: Period,
  locale: Locale,
  freshHealthDays: number,
): Input<"weekly"> {
  const { days, meals, profile } = snapshot;
  const nutrients = aggregateDays(days, "combined");
  const patterns = frequentFoods(meals);
  const supplements = aggregateDays(days, "supplements");
  const loggedDays = days.filter(({ noteCount }) => noteCount > 0).length;
  const referenceRows = applicableReferences(profile, snapshot.references);
  const referenceVersions = [
    ...new Set(referenceRows.map(({ version }) => version)),
  ];
  const evidence: Input<"weekly">["evidence"] = [
    ...days.map((day) => ({
      id: `day:${day.date}`,
      facts: {
        log_count: day.noteCount,
        parsed_notes: day.parsedNoteCount,
        intake_kcal: day.intake,
        measured_expenditure_kcal: day.expenditure,
        balance_kcal: day.balance,
        steps: day.steps,
        distance_km: day.distanceKm,
        nutrient_subtotals: day.combined.totals,
      },
    })),
    ...patterns.map((row, index) => ({
      id: `food-pattern:${index + 1}`,
      facts: row,
    })),
    { id: "nutrient-subtotals", facts: nutrients },
    { id: "supplement-subtotals", facts: supplements },
  ];
  return {
    period_id: period.id,
    locale,
    profile_reference: profile?.useWellnessEstimates
      ? { age: profile.age, physiology: profile.physiology }
      : null,
    goal: profile?.goal ?? null,
    local_statistics: {
      days: days.map((day) => ({
        date: day.date,
        intake_kcal: day.intake,
        expenditure_kcal: day.expenditure,
        balance_kcal: day.balance,
      })),
      nutrients,
      reference_limits: referenceRows.map(
        ({ key, kind, amount, unit, scope, source }) => ({
          key,
          kind,
          amount,
          unit,
          scope,
          source,
        }),
      ),
    },
    evidence,
    food_patterns: patterns,
    supplement_totals: supplements,
    reported_symptoms: [],
    coverage: {
      logged_days: loggedDays,
      fresh_health_days: freshHealthDays,
      period_days: days.length,
    },
    reference_versions: referenceVersions,
  };
}

function snapshotSignature(snapshot: Snapshot, input: Input<"weekly">) {
  return JSON.stringify([
    input,
    snapshot.notes.map(({ id, revision }) => [id, revision]),
    snapshot.meals.map(
      ({ entryId, revision, itemId, foodSnapshot, portionSnapshot }) => [
        entryId,
        revision,
        itemId,
        foodSnapshot?.version,
        portionSnapshot?.version,
      ],
    ),
  ]);
}

type WeekState =
  | "awaiting_health"
  | "ready"
  | "pending"
  | "empty"
  | "retryable"
  | "failed"
  | "stale"
  | "busy";

async function processWeek(
  db: CalioDatabase,
  transport: AiTransport,
  period: Period,
  options: {
    locale: Locale;
    policy: WeeklyPolicy;
    explicitRegeneration: boolean;
    now: Date;
  },
): Promise<WeekState> {
  const previous = await db.ai_reports.get(period.id);
  if (previous?.status === "ready") return "ready";
  if (previous?.status === "stale" && !options.explicitRegeneration)
    return "stale";
  let snapshot = await periodSnapshot(db, period);
  if (options.policy.maxSyncAgeMs !== undefined) {
    const last = await db.health_imports.orderBy("importedAt").last();
    const elapsed = last
      ? options.now.getTime() - Date.parse(last.importedAt)
      : Infinity;
    if (elapsed < 0 || elapsed > options.policy.maxSyncAgeMs)
      return "awaiting_health";
  }
  if (snapshot.notes.length === 0) return "empty";

  const pending = snapshot.notes.filter(({ status }) => status === "pending");
  if (pending.length) {
    const results = await processNotes(db, transport, {
      locale: options.locale,
      notes: pending,
      explicit: options.explicitRegeneration,
    });
    if (results.some(({ status }) => status === "failed")) return "failed";
    snapshot = await periodSnapshot(db, period);
    if (snapshot.notes.some(({ status }) => status === "pending"))
      return "pending";
  }

  const freshDays = freshness(snapshot, period.end, options.policy.timeZone);
  const input = reportInput(snapshot, period, options.locale, freshDays);
  const signature = snapshotSignature(snapshot, input);
  const inputHash = await sha256(
    JSON.stringify([transport.model, promptVersion, signature]),
  );
  const job = await claimJob(
    db,
    { id: `week:${period.id}`, inputHash, period },
    options.explicitRegeneration,
  );
  if (!job) return "busy";
  if (freshDays < options.policy.minimumFreshDays) {
    await releaseJob(db, job, "awaiting_health");
    return "awaiting_health";
  }
  try {
    await advanceJob(db, job, "reporting");
    const response = await requestAi(db, transport, "weekly", input, inputHash);
    const output = validateWeekly(response.output, input);
    await db.transaction(
      "rw",
      [
        ...insightTables(db),
        db.processing_queue,
        db.ai_reports,
        db.messages,
        db.settings,
      ],
      async () => {
        await requireLease(db, job);
        const current = await readPeriod(db, period);
        const updated = reportInput(
          current,
          period,
          options.locale,
          freshness(current, period.end, options.policy.timeZone),
        );
        if (snapshotSignature(current, updated) !== signature)
          throw new AiFailure("job_stale");
        if (
          db.mode === "real" &&
          !(await db.settings.get("settings"))?.aiConsentAt
        )
          throw new AiFailure("ai_consent_required");
        const createdAt = new Date().toISOString();
        await db.ai_reports.put({
          id: period.id,
          period,
          inputHash,
          evidenceIds: input.evidence.map(({ id }) => id),
          healthDays: freshDays,
          loggedDays: snapshot.days.filter(({ noteCount }) => noteCount > 0)
            .length,
          output: { ...output },
          promptVersion,
          status: "ready",
          createdAt,
        });
        await db.messages.put({
          id: `weekly-ready:${period.id}`,
          kind: "weekly_ready",
          period,
          test: db.mode === "demo",
          severity: "success",
          seen: false,
          createdAt,
        });
        await releaseJob(db, job, "ready");
      },
    );
    return "ready";
  } catch (error) {
    const failure =
      error instanceof AiFailure ? error : new AiFailure("report_failed");
    const stage =
      failure.code === "job_stale"
        ? "stale"
        : failure.retryable
          ? "retryable"
          : "failed";
    await releaseJob(db, job, stage, failure);
    return stage;
  }
}

export async function processForegroundWeeks(
  db: CalioDatabase,
  transport: AiTransport,
  options: {
    visible: boolean;
    online: boolean;
    now: Date;
    locale: Locale;
    policy: WeeklyPolicy;
    regeneratePeriodId?: string;
  },
) {
  if (db.mode !== transport.mode) throw new AiFailure("ai_mode_mismatch");
  if (!options.visible || !options.online) return [];
  if (db.mode === "real" && !(await db.settings.get("settings"))?.aiConsentAt)
    return [];
  const required = options.policy.minimumFreshDays;
  if (!Number.isSafeInteger(required) || required < 0 || required > 7)
    throw new RangeError("weekly_policy");
  const results: Array<{ period: Period; state: WeekState }> = [];
  for (const period of completedWeeks(options.policy, options.now)) {
    const state = await processWeek(db, transport, period, {
      locale: options.locale,
      policy: options.policy,
      explicitRegeneration: options.regeneratePeriodId === period.id,
      now: options.now,
    });
    results.push({ period, state });
    if (state !== "ready" && state !== "empty" && state !== "stale") break;
  }
  return results;
}
