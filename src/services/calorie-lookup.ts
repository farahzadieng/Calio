import { AiFailure, type AiTransport } from "../ai/contracts";
import { requestAi } from "../ai/request";
import type { CalioDatabase } from "../db/database";
import type { MealItem } from "../db/records";
import {
  calorieSearchModel,
  calorieTargetKey,
  calorieTargetSchema,
  citationUrl,
  parseCalorieAnswer,
  type CalorieAnswer,
  type CalorieTarget,
} from "../domain/calorie-lookup";
import {
  findFood,
  findPortion,
  foodSchema,
  normalizeFoodText,
  normalizeServingUnit,
  portionSchema,
  type Food,
} from "../domain/library";
import {
  findIranianCalorieReference,
  iranianReferenceFood,
} from "../domain/iranian-calories";
import { amountForBasis, unknownNutrients } from "../domain/nutrition";
import { sha256 } from "./hash";
import { correctFoodAmount } from "./meal-corrections";

type KnownAnswer = Extract<CalorieAnswer, { status: "known" }>;

async function storedFor(db: CalioDatabase, target: CalorieTarget) {
  const [foods, aliases] = await Promise.all([
    db.foods.toArray(),
    db.aliases.toArray(),
  ]);
  const candidates = foods.filter((food) => food.basis === target.basis);
  const matched = findFood(target, candidates, aliases);
  if (matched) return matched;
  const published = findIranianCalorieReference(target);
  return published
    ? findFood(iranianReferenceFood(published), candidates, aliases)
    : null;
}

export async function findLocalCalorieFood(
  db: CalioDatabase,
  target: CalorieTarget,
) {
  const existing = await storedFor(db, target);
  if (existing && existing.nutrients.energy_kcal !== null) return existing;
  if (db.mode !== "real") return existing;
  const published = findIranianCalorieReference(target);
  if (!published) return existing;
  return db.transaction("rw", [db.foods, db.aliases], async () => {
    const latest = await storedFor(db, target);
    if (latest?.nutrients.energy_kcal != null) return latest;
    const reference = iranianReferenceFood(published);
    if (latest) {
      const updated = mergeEnergy(latest, reference);
      await db.foods.put(updated);
      return updated;
    }
    const saved = await db.foods.get(reference.id);
    if (saved) return saved;
    await db.foods.add(reference);
    return reference;
  });
}

function mergeEnergy(existing: Food, proposed: Food): Food {
  return foodSchema.parse({
    ...existing,
    nutrients: {
      ...existing.nutrients,
      energy_kcal: proposed.nutrients.energy_kcal,
    },
    assumptions: [
      ...new Set([...existing.assumptions, ...proposed.assumptions]),
    ],
    evidence: [...existing.evidence, ...proposed.evidence],
    version: existing.version + 1,
  });
}

export async function saveCalorieAnswer(
  db: CalioDatabase,
  target: CalorieTarget,
  answer: KnownAnswer,
  origin: "api" | "copy",
  accessedDate = new Date().toISOString().slice(0, 10),
) {
  const input = calorieTargetSchema.parse(target);
  const validated = parseCalorieAnswer(answer, input);
  if (validated.status !== "known") throw new Error("calorie_result_unknown");
  const proposed = foodSchema.parse({
    id: crypto.randomUUID(),
    ...input,
    nutrients: { ...unknownNutrients(), energy_kcal: validated.kcalPer100 },
    addedSugarG: null,
    evidence: [
      {
        url: citationUrl(validated.source.url),
        title: validated.source.title,
        basis: input.basis,
        accessedDate,
        evidenceId:
          origin === "api" ? "sonar-calories" : "manual-calorie-reference",
        keys: ["energy_kcal"],
      },
    ],
    assumptions: [
      origin === "api"
        ? "sonar_cited_estimate"
        : "source_reported_in_pasted_reply",
    ],
    confidence: origin === "api" ? "medium" : "low",
    version: 1,
  });
  return db.transaction("rw", [db.foods, db.aliases], async () => {
    const existing = await storedFor(db, input);
    if (existing?.nutrients.energy_kcal != null) return existing;
    const result = existing ? mergeEnergy(existing, proposed) : proposed;
    await db.foods.put(result);
    return result;
  });
}

async function cachedServing(
  db: CalioDatabase,
  food: Food | null,
  unit: string,
) {
  return (
    food &&
    findPortion(
      food,
      unit,
      await db.portions.where("foodId").equals(food.id).toArray(),
    )
  );
}

async function saveServing(
  db: CalioDatabase,
  target: CalorieTarget,
  unit: string,
  answer: CalorieAnswer,
  evidence: Awaited<ReturnType<typeof requestAi>>["evidence"],
) {
  const serving = answer.serving;
  if (!serving || normalizeServingUnit(serving.unit) !== unit) return;
  const cited = evidence.find(
    (entry) =>
      entry.supportsPortion &&
      entry.basis === target.basis &&
      citationUrl(entry.url) === citationUrl(serving.source.url),
  );
  if (!cited) return;
  const cheese = /cheese|پنیر/.test(
    normalizeFoodText(target.nameEn + " " + target.nameFa),
  );
  const smallCheese = cheese && ["matchbox", "block"].includes(unit);
  const maxAmount = smallCheese ? 120 : unit === "handful" ? 250 : 1000;
  const maxEnergy = smallCheese ? 500 : unit === "handful" ? 1000 : 2500;
  if (
    (serving.amountPerUnit ?? 0) > maxAmount ||
    (serving.kcalPerUnit ?? 0) > maxEnergy
  )
    return;
  if (serving.amountPerUnit === null && serving.kcalPerUnit === null) return;
  return db.transaction("rw", [db.foods, db.aliases, db.portions], async () => {
    const existing = await storedFor(db, target);
    if (await cachedServing(db, existing, unit)) return existing;
    const food =
      existing ??
      foodSchema.parse({
        id: crypto.randomUUID(),
        ...target,
        nutrients: unknownNutrients(),
        addedSugarG: null,
        evidence: [],
        assumptions: [],
        confidence: "medium",
        version: 1,
      });
    if (!existing) await db.foods.add(food);
    await db.portions.add(
      portionSchema.parse({
        id: crypto.randomUUID(),
        foodId: food.id,
        variant: food.variant,
        unit,
        ...(serving.kcalPerUnit === null
          ? {}
          : { energyKcalPerUnit: serving.kcalPerUnit }),
        gramsPerUnit:
          target.basis === "per_100g" ? serving.amountPerUnit : null,
        mlPerUnit: target.basis === "per_100ml" ? serving.amountPerUnit : null,
        range: null,
        evidence: [
          {
            url: citationUrl(cited.url),
            title: cited.title,
            accessedDate: cited.accessedDate,
            basis: unit,
            evidenceId: cited.id,
            keys: serving.kcalPerUnit === null ? [] : ["energy_kcal"],
          },
        ],
        assumptions: ["sonar_cited_serving_estimate"],
        confidence: "medium",
        version: 1,
      }),
    );
    return food;
  });
}

const activeLookups = new WeakMap<
  CalioDatabase,
  Map<string, Promise<Food | null>>
>();

export async function lookupCalorieFood(
  db: CalioDatabase,
  transport: AiTransport,
  target: CalorieTarget,
  portionUnit?: string,
) {
  const input = calorieTargetSchema.parse(target);
  const local = await findLocalCalorieFood(db, input);
  const unit = portionUnit ? normalizeServingUnit(portionUnit) : undefined;
  const serving = unit ? await cachedServing(db, local, unit) : null;
  const hasDensity = local?.nutrients.energy_kcal != null;
  if (
    serving?.energyKcalPerUnit !== undefined ||
    (hasDensity && (!unit || serving))
  )
    return local;
  const missingUnit = unit && !serving ? unit : undefined;
  const search = missingUnit
    ? {
        ...input,
        portionUnit: missingUnit,
        ...(hasDensity ? { portionOnly: true as const } : {}),
      }
    : input;
  if (db.mode !== "real") throw new AiFailure("ai_mode_mismatch");
  let active = activeLookups.get(db);
  if (!active) {
    active = new Map();
    activeLookups.set(db, active);
  }
  const key = JSON.stringify([calorieTargetKey(input), missingUnit]);
  const existing = active.get(key);
  if (existing) return existing;
  const lookup = (async () => {
    const idempotencyKey = await sha256(
      JSON.stringify([transport.calorieModel ?? calorieSearchModel, key]),
    );
    const response = await requestAi(
      db,
      transport,
      "calories",
      search,
      idempotencyKey,
    );
    const parsed = parseCalorieAnswer(response.output, input);
    let food = local;
    if (parsed.status === "known") {
      const evidence = response.evidence.find(
        (entry) =>
          !entry.supportsPortion &&
          entry.supportedNutrients.includes("energy_kcal") &&
          entry.basis === input.basis &&
          citationUrl(entry.url) === citationUrl(parsed.source.url),
      );
      if (!evidence) throw new AiFailure("ai_evidence");
      food = await saveCalorieAnswer(
        db,
        input,
        parsed,
        "api",
        evidence.accessedDate,
      );
    }
    const withServing = missingUnit
      ? await saveServing(db, input, missingUnit, parsed, response.evidence)
      : null;
    return withServing ?? food;
  })();
  active.set(key, lookup);
  try {
    return await lookup;
  } finally {
    active.delete(key);
  }
}

export async function applyCalorieReference(
  db: CalioDatabase,
  meal: MealItem,
  food: Food,
) {
  const amount = { grams: meal.grams, ml: meal.ml };
  const measured = amountForBasis(amount, food.basis);
  if (measured === null || measured <= 0 || meal.excludedFromTotals)
    return false;
  await correctFoodAmount(db, meal, { foodId: food.id, ...amount });
  return true;
}
