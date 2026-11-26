import { z } from "zod";
import { localDate, timestamp } from "./dates";
import { nonNegative } from "./nutrition";

const columns = [
  "Dates",
  "Resting_Energy",
  "Active_Energy",
  "Steps",
  "Distance",
] as const;
type Column = (typeof columns)[number];
const columnNames: ReadonlySet<string> = new Set(columns);
const block = /\s*(\w+)\s*:\s*\{([^{}]*)\}\s*(,|$)/y;
const decimal = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

export type HealthMetrics = {
  restingKcal: number | null;
  activeKcal: number | null;
  steps: number | null;
  distanceKm: number | null;
};
export type HealthImportRow = Readonly<HealthMetrics & { date: string }>;

type ParseFailure =
  | "health_size"
  | "health_grammar"
  | "health_columns"
  | "health_length"
  | "health_date"
  | "health_duplicate_date"
  | "health_number";

export class HealthParseError extends Error {
  constructor(readonly code: ParseFailure) {
    super(code);
  }
}

function readMetric(
  raw: string,
  integer: boolean,
  missing: string | null,
): number | null {
  if (missing !== null && raw === missing) return null;
  const value = Number(raw);
  if (
    !decimal.test(raw) ||
    !Number.isFinite(value) ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new HealthParseError("health_number");
  }
  return value;
}

// Parses the documented interchange text. Unit and optional missing-token decisions
// belong to the bridge configuration, outside this pure parser.
export function parseHealthText(
  input: string,
  missing: string | null = null,
): HealthImportRow[] {
  if (input.length > 128_000) throw new HealthParseError("health_size");
  const source = input.trim();
  const sections = new Map<Column, string[]>();
  const pattern = new RegExp(block);
  for (let cursor = 0; cursor < source.length; cursor = pattern.lastIndex) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) throw new HealthParseError("health_grammar");
    const [, rawName, body] = match;
    if (!rawName || !columnNames.has(rawName))
      throw new HealthParseError("health_columns");
    const name = rawName as Column;
    if (sections.has(name)) throw new HealthParseError("health_columns");
    const values = (body ?? "")
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim());
    if (values.some((value) => value === ""))
      throw new HealthParseError("health_length");
    sections.set(name, values);
  }
  if (sections.size !== columns.length)
    throw new HealthParseError("health_columns");
  const dates = sections.get("Dates") ?? [];
  if ([...sections.values()].some((values) => values.length !== dates.length)) {
    throw new HealthParseError("health_length");
  }
  if (dates.some((date) => !localDate.safeParse(date).success))
    throw new HealthParseError("health_date");
  if (new Set(dates).size !== dates.length)
    throw new HealthParseError("health_duplicate_date");
  const value = (name: Exclude<Column, "Dates">, index: number) =>
    readMetric(sections.get(name)?.[index] ?? "", name === "Steps", missing);
  return dates.map((date, index) => ({
    date,
    restingKcal: value("Resting_Energy", index),
    activeKcal: value("Active_Energy", index),
    steps: value("Steps", index),
    distanceKm: value("Distance", index),
  }));
}

const healthStatus = z.enum(["valid", "missing", "partial", "suspicious"]);
const observation = z
  .strictObject({
    value: nonNegative.nullable(),
    status: healthStatus,
    importedAt: timestamp,
    importId: z.uuid(),
  })
  .refine(({ value, status }) =>
    status === "missing" ? value === null : value !== null,
  );

export const healthDaySchema = z.strictObject({
  date: localDate,
  restingKcal: observation,
  activeKcal: observation,
  steps: observation.refine(
    ({ value }) => value === null || Number.isSafeInteger(value),
  ),
  distanceKm: observation,
});
export type HealthDay = z.infer<typeof healthDaySchema>;
type Observation = z.infer<typeof observation>;

export const healthImportSchema = z.strictObject({
  id: z.uuid(),
  importedAt: timestamp,
  fingerprint: z.string().regex(/^[a-f\d]{64}$/),
  start: localDate,
  end: localDate,
  count: z.number().int().positive(),
  incompleteDays: z.number().int().nonnegative(),
});

export function healthDayFromRow(
  row: HealthImportRow,
  input: {
    importedAt: string;
    importId: string;
    today: string;
    minimumRestingKcal: number;
  },
): HealthDay {
  const { importedAt, importId, today, minimumRestingKcal } = input;
  const onOrAfterToday = row.date >= today;
  const suspiciousEnergy =
    row.restingKcal === 0 ||
    (row.restingKcal !== null && row.restingKcal < minimumRestingKcal);
  const mark = (value: number | null, suspect = false): Observation => ({
    value,
    status:
      value === null
        ? "missing"
        : onOrAfterToday
          ? "partial"
          : suspect
            ? "suspicious"
            : "valid",
    importedAt,
    importId,
  });
  return {
    date: row.date,
    restingKcal: mark(row.restingKcal, suspiciousEnergy),
    activeKcal: mark(row.activeKcal, row.activeKcal === 0 && suspiciousEnergy),
    steps: mark(row.steps),
    distanceKm: mark(row.distanceKm),
  };
}

export function mergeHealthDay(
  previous: HealthDay | undefined,
  incoming: HealthDay,
): HealthDay {
  if (!previous) return incoming;
  const prefer = (key: keyof HealthMetrics) => {
    const old = previous[key];
    const next = incoming[key];
    if (next.importedAt < old.importedAt) return old;
    if (next.status !== "valid" && old.status === "valid") return old;
    return next;
  };
  return {
    date: incoming.date,
    restingKcal: prefer("restingKcal"),
    activeKcal: prefer("activeKcal"),
    steps: prefer("steps"),
    distanceKm: prefer("distanceKm"),
  };
}

export function measuredExpenditure(day: HealthDay | undefined): number | null {
  if (
    !day ||
    day.restingKcal.status !== "valid" ||
    day.activeKcal.status !== "valid"
  )
    return null;
  const { restingKcal, activeKcal } = day;
  if (
    restingKcal.value === null ||
    activeKcal.value === null ||
    restingKcal.value <= 0
  )
    return null;
  const total = restingKcal.value + activeKcal.value;
  return Number.isFinite(total) ? total : null;
}
