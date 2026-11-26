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
import { findFood, foodSchema, type Food } from "../domain/library";
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
  return findFood(
    target,
    foods.filter((food) => food.basis === target.basis),
    aliases,
  );
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

const activeLookups = new WeakMap<
  CalioDatabase,
  Map<string, Promise<Food | null>>
>();

export async function lookupCalorieFood(
  db: CalioDatabase,
  transport: AiTransport,
  target: CalorieTarget,
) {
  const input = calorieTargetSchema.parse(target);
  const local = await findLocalCalorieFood(db, input);
  if (local?.nutrients.energy_kcal != null) return local;
  if (db.mode !== "real") throw new AiFailure("ai_mode_mismatch");
  let active = activeLookups.get(db);
  if (!active) {
    active = new Map();
    activeLookups.set(db, active);
  }
  const key = calorieTargetKey(input);
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
      input,
      idempotencyKey,
    );
    const parsed = parseCalorieAnswer(response.output, input);
    if (parsed.status === "unknown") return local;
    const evidence = response.evidence.find(
      (entry) =>
        entry.supportedNutrients.includes("energy_kcal") &&
        entry.basis === input.basis &&
        citationUrl(entry.url) === citationUrl(parsed.source.url),
    );
    if (!evidence) throw new AiFailure("ai_evidence");
    return saveCalorieAnswer(db, input, parsed, "api", evidence.accessedDate);
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
