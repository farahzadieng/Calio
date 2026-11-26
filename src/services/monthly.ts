import { applicableReferences } from "../domain/references";
import consultationTemplate from "../../prompts/05-monthly-consultation-template.md?raw";
import type { CalioDatabase } from "../db/database";
import type { Period, Row } from "../db/records";
import { timeZoneSchema, type Locale } from "../domain/dates";
import { compareWeight } from "../domain/insights";
import {
  aggregateDays,
  frequentFoods,
  insightTables,
  readPeriod,
} from "./insights";

export type MonthlyPolicy = {
  coefficient: number;
  modelName: string;
  modelVersion: string;
  caveat: string;
  minimumPairedDayRatio: number;
  discrepancyThresholdKg: number;
};

function pickWeight(weights: Row<"weight_logs">[], date: string) {
  return (
    weights
      .filter(({ localDate }) => localDate === date)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.kg ?? null
  );
}

export function prepareMonthlyConsultation(
  db: CalioDatabase,
  period: Period,
  options: {
    locale: Locale;
    timeZone: string;
    policy: MonthlyPolicy;
    includeReferenceDemographics: boolean;
    reportedSymptoms?: ReadonlyArray<{ date: string; text: string }>;
  },
) {
  timeZoneSchema.parse(options.timeZone);
  return db.transaction(
    "r",
    [...insightTables(db), db.weight_logs],
    async () => {
      const snapshot = await readPeriod(db, period);
      const weights = await db.weight_logs
        .where("localDate")
        .between(period.start, period.end, true, true)
        .toArray();
      const startingKg = pickWeight(weights, period.start);
      const endingKg = pickWeight(weights, period.end);
      const comparison = compareWeight({
        days: snapshot.days,
        startingKg,
        endingKg,
        policy: options.policy,
      });
      const profile = snapshot.profile;
      const aggregate = aggregateDays(snapshot.days, "combined");
      const applicable = applicableReferences(profile, snapshot.references);
      const payload = {
        period_start: period.start,
        period_end: period.end,
        timezone: options.timeZone,
        age: options.includeReferenceDemographics
          ? (profile?.age ?? null)
          : null,
        reference_demographics: options.includeReferenceDemographics
          ? (profile?.physiology ?? null)
          : null,
        height_cm: profile?.heightCm ?? null,
        goal: profile?.goal ?? null,
        weight_measurements: weights.map(({ localDate, kg }) => ({
          date: localDate,
          kg,
        })),
        actual_delta_kg: comparison.actualDeltaKg,
        model_name: options.policy.modelName,
        model_version: options.policy.modelVersion,
        coefficient_kcal_per_kg: options.policy.coefficient,
        caveat: options.policy.caveat,
        estimated_delta_kg: comparison.estimatedDeltaKg,
        discrepancy_kg: comparison.discrepancyKg,
        intake_kcal: comparison.intakeKcal,
        expenditure_kcal: comparison.expenditureKcal,
        paired_day_coverage: {
          days: comparison.pairedDays,
          total_days: comparison.totalDays,
          ratio: comparison.coverage,
        },
        energy_sources: {
          intake: "local_food_estimates",
          expenditure: "apple_health_read_only",
        },
        daily_energy_series: snapshot.days.map((day) => ({
          date: day.date,
          intake_kcal: day.intake,
          expenditure_kcal: day.expenditure,
          balance_kcal: day.balance,
          steps: day.steps,
          distance_km: day.distanceKm,
        })),
        nutrient_totals: aggregate.totals,
        nutrient_averages: aggregate.dailyAverages,
        nutrient_coverage: aggregate.coverage,
        reference_limits: applicable.map(
          ({ key, amount, unit, source, kind, version, scope }) => ({
            key,
            amount,
            unit,
            source,
            kind,
            version,
            scope,
          }),
        ),
        food_items: snapshot.meals.map((item) => ({
          date: item.localDate,
          name_fa: item.nameFa,
          name_en: item.nameEn,
          quantity: item.originalQuantity,
          unit: item.originalUnit,
          grams: item.grams,
          ml: item.ml,
          nutrients: item.nutrients,
          confidence: item.confidence,
          assumptions: item.assumptions,
        })),
        frequent_foods: frequentFoods(snapshot.meals),
        drinks: snapshot.drinks.map((drink) => ({
          date: drink.localDate,
          time: drink.time,
          kind: drink.kind,
          type: drink.title,
          volume_ml: drink.amountMl,
          caffeine_mg: drink.caffeineMg,
          strength: drink.strength,
        })),
        supplements: snapshot.supplements.map((log) => ({
          date: log.localDate,
          time: log.time,
          name: log.productSnapshot.name,
          servings: log.servings,
          serving_unit: log.productSnapshot.servingUnit,
          composition: log.productSnapshot.composition,
          other_labeled_ingredients: log.productSnapshot.otherIngredients ?? [],
        })),
        reported_symptoms:
          options.reportedSymptoms?.filter(
            ({ date }) => date >= period.start && date <= period.end,
          ) ?? [],
        missing_days: snapshot.days
          .filter((day) => day.noteCount === 0 || day.expenditure === null)
          .map((day) => ({
            date: day.date,
            missing_journal: day.noteCount === 0,
            missing_expenditure: day.expenditure === null,
          })),
        pending_note_count: snapshot.notes.filter(
          ({ status }) => status === "pending",
        ).length,
        prior_changes: null,
      };
      const prompt = consultationTemplate
        .replace("{{locale}}", () =>
          options.locale === "fa" ? "Persian" : "English",
        )
        .replace("{{monthly_payload_json}}", () =>
          JSON.stringify(payload, null, 2),
        );
      return {
        comparison,
        startingKg,
        endingKg,
        payload,
        prompt,
        days: snapshot.days,
      };
    },
  );
}
