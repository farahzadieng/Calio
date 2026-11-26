import type { CalioDatabase } from "../db/database";
import type { Period } from "../db/records";
import { dailyInsight, type DailyInsight } from "../domain/insights";
import { periodDates } from "../domain/periods";
import { nutrientKeys, unknownNutrients } from "../domain/nutrition";

export async function readPeriod(db: CalioDatabase, period: Period) {
  const dateRange = [period.start, period.end, true, true] as const;
  const [
    notes,
    parsed,
    meals,
    drinks,
    supplements,
    health,
    profile,
    references,
  ] = await Promise.all([
    db.journal_entries
      .where("localDate")
      .between(...dateRange)
      .toArray(),
    db.parsed_entries
      .where("localDate")
      .between(...dateRange)
      .toArray(),
    db.meal_items
      .where("localDate")
      .between(...dateRange)
      .toArray(),
    db.drinks
      .where("localDate")
      .between(...dateRange)
      .toArray(),
    db.supplement_logs
      .where("localDate")
      .between(...dateRange)
      .toArray(),
    db.health_daily
      .where("date")
      .between(...dateRange)
      .toArray(),
    db.profile.get("profile"),
    db.nutrient_references.toArray(),
  ]);
  const dates = periodDates(period);
  const days = dates.map((date) =>
    dailyInsight({
      date,
      noteCount: notes.filter(({ localDate }) => localDate === date).length,
      parsedNoteCount: parsed.filter(({ localDate }) => localDate === date)
        .length,
      meals: meals.filter(({ localDate }) => localDate === date),
      drinks: drinks.filter(({ localDate }) => localDate === date),
      supplements: supplements.filter(({ localDate }) => localDate === date),
      health: health.find((row) => row.date === date),
    }),
  );
  return {
    notes,
    parsed,
    meals,
    drinks,
    supplements,
    health,
    profile,
    references,
    days,
  };
}

export const insightTables = (db: CalioDatabase) => [
  db.journal_entries,
  db.parsed_entries,
  db.meal_items,
  db.drinks,
  db.supplement_logs,
  db.health_daily,
  db.profile,
  db.nutrient_references,
];

export const periodSnapshot = (db: CalioDatabase, period: Period) =>
  db.transaction("r", insightTables(db), () => readPeriod(db, period));

export function aggregateDays(
  days: DailyInsight[],
  source: "food" | "drinks" | "supplements" | "combined",
) {
  const totals = unknownNutrients();
  const dailyAverages = unknownNutrients();
  const coverage = Object.fromEntries(
    nutrientKeys.map((key) => [
      key,
      {
        knownDays: 0,
        completeDays: 0,
        knownItems: 0,
        totalItems: 0,
      },
    ]),
  ) as Record<
    (typeof nutrientKeys)[number],
    {
      knownDays: number;
      completeDays: number;
      knownItems: number;
      totalItems: number;
    }
  >;
  for (const key of nutrientKeys) {
    let total = 0;
    const counts = coverage[key];
    for (const day of days) {
      const data = day[source];
      counts.knownItems += data.knownItemCounts[key];
      counts.totalItems += data.itemCount;
      const value = data.totals[key];
      if (value !== null) {
        total += value;
        counts.knownDays += 1;
        if (
          data.knownItemCounts[key] === data.itemCount &&
          day.noteCount === day.parsedNoteCount
        )
          counts.completeDays += 1;
      }
    }
    if (counts.knownDays && Number.isFinite(total)) {
      totals[key] = total;
      dailyAverages[key] = total / counts.knownDays;
    }
  }
  return { totals, dailyAverages, coverage };
}

export function frequentFoods(
  meals: Awaited<ReturnType<typeof readPeriod>>["meals"],
) {
  const counts = new Map<
    string,
    { nameFa: string; nameEn: string; count: number }
  >();
  for (const meal of meals) {
    if (meal.excludedFromTotals) continue;
    const name = JSON.stringify([
      meal.nameFa,
      meal.nameEn,
      meal.foodSnapshot?.variant,
    ]);
    const previous = counts.get(name);
    counts.set(name, {
      nameFa: meal.nameFa,
      nameEn: meal.nameEn,
      count: (previous?.count ?? 0) + 1,
    });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}
