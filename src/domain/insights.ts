import type { MealItem, Drink, SupplementLog } from "../db/records";
import type { HealthDay } from "./health";
import { measuredExpenditure } from "./health";
import {
  nutrientMetadata,
  scaleAmount,
  sodiumToSalt,
  summarizeNutrients,
  unknownNutrients,
  type Nutrients,
} from "./nutrition";

function sumNullable(values: readonly (number | null)[]) {
  const known = values.filter((value) => value !== null);
  if (!known.length) return null;
  const sum = known.reduce((total, value) => total + value, 0);
  return Number.isFinite(sum) ? sum : null;
}

const vitaminDIUToMicrograms = 0.025;
const gramsPerUnit = new Map([
  ["g", 1],
  ["mg", 0.001],
  ["µg", 0.000001],
]);

export function supplementAmounts(log: SupplementLog): Nutrients {
  const amounts = unknownNutrients();
  for (const ingredient of log.productSnapshot.composition) {
    const target = nutrientMetadata.find(
      (nutrient) => nutrient.key === ingredient.key,
    )?.unit;
    const fromMass = gramsPerUnit.get(ingredient.unit);
    const toMass = gramsPerUnit.get(target ?? "");
    const ratio =
      ingredient.unit === target
        ? 1
        : fromMass !== undefined && toMass !== undefined
          ? fromMass / toMass
          : ingredient.unit === "IU" && ingredient.key === "vitamin_d_ug"
            ? vitaminDIUToMicrograms
            : null;
    amounts[ingredient.key] = scaleAmount(
      scaleAmount(ingredient.amount, ratio),
      log.servings,
    );
  }
  return amounts;
}

export function dailyInsight(input: {
  date: string;
  noteCount: number;
  parsedNoteCount: number;
  meals: readonly MealItem[];
  drinks: readonly Drink[];
  supplements: readonly SupplementLog[];
  health: HealthDay | undefined;
}) {
  const included = input.meals.filter(
    ({ excludedFromTotals }) => !excludedFromTotals,
  );
  const drinkAmounts = input.drinks.map((drink) => {
    const link = drink.matchedMeal;
    const matched = link
      ? included.find(
          (meal) =>
            link.entryId === meal.entryId &&
            link.revision === meal.revision &&
            link.itemId === meal.itemId,
        )
      : undefined;
    const amounts = unknownNutrients();
    if (matched?.nutrients.water_ml == null && drink.kind === "water")
      amounts.water_ml = drink.amountMl;
    if (matched?.nutrients.caffeine_mg == null)
      amounts.caffeine_mg = drink.kind === "water" ? 0 : drink.caffeineMg;
    return amounts;
  });
  const meals = included.map(({ nutrients }) => nutrients);
  const supplementAmountsForDay = input.supplements.map(supplementAmounts);
  const food = summarizeNutrients(meals);
  const drinks = summarizeNutrients(drinkAmounts);
  const supplements = summarizeNutrients(supplementAmountsForDay);
  const combined = summarizeNutrients([
    ...meals,
    ...drinkAmounts,
    ...supplementAmountsForDay,
  ]);
  const expenditure = measuredExpenditure(input.health);
  // Partial intake is available in the breakdown. A balance needs complete food-energy data.
  const intakeComplete =
    input.noteCount > 0 &&
    input.noteCount === input.parsedNoteCount &&
    meals.length > 0 &&
    food.knownItemCounts.energy_kcal === meals.length &&
    input.drinks.every(
      ({ kind, matchedMeal }) => kind === "water" || matchedMeal !== null,
    );
  const intake = intakeComplete ? food.totals.energy_kcal : null;
  return {
    date: input.date,
    noteCount: input.noteCount,
    parsedNoteCount: input.parsedNoteCount,
    food,
    drinks,
    supplements,
    combined,
    intake,
    expenditure,
    balance:
      intake === null || expenditure === null ? null : intake - expenditure,
    addedSugarG: sumNullable(included.map(({ addedSugarG }) => addedSugarG)),
    saltEquivalentG: sodiumToSalt(combined.totals.sodium_mg),
    drinkVolumeMl: sumNullable(input.drinks.map(({ amountMl }) => amountMl)),
    steps: input.health?.steps.value ?? null,
    distanceKm: input.health?.distanceKm.value ?? null,
  };
}

export type DailyInsight = ReturnType<typeof dailyInsight>;

export function compareWeight(input: {
  days: readonly DailyInsight[];
  startingKg: number | null;
  endingKg: number | null;
  policy: {
    coefficient: number;
    minimumPairedDayRatio: number;
    discrepancyThresholdKg: number;
  };
}) {
  const { coefficient, minimumPairedDayRatio, discrepancyThresholdKg } =
    input.policy;
  if (
    !Number.isFinite(coefficient) ||
    coefficient <= 0 ||
    !Number.isFinite(minimumPairedDayRatio) ||
    minimumPairedDayRatio <= 0 ||
    minimumPairedDayRatio > 1 ||
    !Number.isFinite(discrepancyThresholdKg) ||
    discrepancyThresholdKg < 0
  ) {
    throw new RangeError("weight_policy");
  }
  const paired = input.days.filter(({ balance }) => balance !== null);
  const coverage = input.days.length ? paired.length / input.days.length : 0;
  const actualDeltaKg =
    input.startingKg === null || input.endingKg === null
      ? null
      : input.endingKg - input.startingKg;
  const net = sumNullable(paired.map(({ balance }) => balance));
  const estimatedDeltaKg =
    coverage >= minimumPairedDayRatio && net !== null
      ? net / coefficient
      : null;
  const discrepancyKg =
    actualDeltaKg === null || estimatedDeltaKg === null
      ? null
      : Math.abs(actualDeltaKg - estimatedDeltaKg);
  return {
    actualDeltaKg,
    estimatedDeltaKg,
    discrepancyKg,
    pairedDays: paired.length,
    totalDays: input.days.length,
    coverage,
    intakeKcal: sumNullable(paired.map(({ intake }) => intake)),
    expenditureKcal: sumNullable(paired.map(({ expenditure }) => expenditure)),
    offerPrompt:
      discrepancyKg === null || discrepancyKg > discrepancyThresholdKg,
  };
}
