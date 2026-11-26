import {
  AiFailure,
  promptVersion,
  validateExtract,
  validatePortion,
  validateResearch,
  type AiTransport,
  type Input,
  type Output,
} from "../ai/contracts";
import { requestAi } from "../ai/request";
import type { CalioDatabase } from "../db/database";
import {
  records,
  type DiaryNote,
  type Job,
  type MealItem,
} from "../db/records";
import type { Locale } from "../domain/dates";
import { calorieTargetSchema } from "../domain/calorie-lookup";
import {
  findFood,
  findPortion,
  foodSchema,
  normalizeFoodText,
  portionSchema,
  resolveAmount,
  type Food,
  type Portion,
} from "../domain/library";
import {
  amountForBasis,
  nutrientKeys,
  recipeReference,
  scaleAmount,
  scaleReference,
  unknownNutrients,
} from "../domain/nutrition";
import { sha256 } from "./hash";
import { findLocalCalorieFood, lookupCalorieFood } from "./calorie-lookup";
import { advanceJob, claimJob, releaseJob, requireLease } from "./jobs";

type ExtractEntry = Output<"extract">["entries"][number];
type ExtractItem = ExtractEntry["items"][number];
type Claim = { note: DiaryNote; job: Job };

function isSupplement(item: ExtractItem) {
  return /supplement|مکمل/.test(
    normalizeFoodText(item.variant + " " + item.preparation),
  );
}

function referenceIdentity(item: ExtractItem) {
  return {
    nameFa: item.name_fa,
    nameEn: item.name_en,
    variant: item.variant,
    preparation: item.preparation,
    brand: item.brand,
  };
}

function foodEvidence(sources: Output<"research">["sources"]) {
  return sources.map((source) => ({
    title: source.title,
    url: source.url,
    accessedDate: source.accessed_date,
    evidenceId: source.tool_evidence_id,
    basis: source.basis,
    keys: source.nutrient_keys,
  }));
}

async function fetchFood(
  db: CalioDatabase,
  transport: AiTransport,
  item: ExtractItem,
  locale: Locale,
): Promise<Food | null> {
  const identity = referenceIdentity(item);
  const [foods, aliases] = await Promise.all([
    db.foods.toArray(),
    db.aliases.toArray(),
  ]);
  const cached = findFood(identity, foods, aliases);
  if (db.mode === "real") {
    const amount = resolveAmount(item.quantity, item.unit, null);
    const basis =
      cached?.basis ?? (amount.ml !== null ? "per_100ml" : "per_100g");
    const parsed = calorieTargetSchema.safeParse({ ...identity, basis });
    if (!parsed.success) return cached;
    const local = (await findLocalCalorieFood(db, parsed.data)) ?? cached;
    const settings = await db.settings.get("settings");
    const measured = amountForBasis(amount, basis);
    if (
      local?.nutrients.energy_kcal != null ||
      settings?.calorieLookupMode !== "api" ||
      measured === null ||
      measured <= 0
    )
      return local;
    try {
      return (await lookupCalorieFood(db, transport, parsed.data)) ?? local;
    } catch (error) {
      if (!(error instanceof AiFailure)) throw error;
      return local;
    }
  }
  if (cached) return cached;
  const input: Input<"research"> = {
    food_name_fa: item.name_fa,
    food_name_en: item.name_en,
    variant: item.variant,
    preparation: item.preparation,
    brand: item.brand,
    requested_nutrient_keys: nutrientKeys,
    known_reference: null,
    locale,
  };
  const key = await sha256(
    JSON.stringify(["research", transport.model, promptVersion, identity]),
  );
  const response = await requestAi(db, transport, "research", input, key);
  const result = validateResearch(
    response.output,
    input,
    response.evidence,
    transport.mode === "demo",
  );
  const nutrients = result.recipe
    ? recipeReference(
        result.recipe.ingredients.map((ingredient) => ({
          amount: { grams: ingredient.amount_g, ml: ingredient.amount_ml },
          basis: ingredient.reference_basis,
          nutrients: ingredient.nutrients,
        })),
        result.recipe.final_yield_g,
      )
    : result.nutrients;
  if (
    !nutrientKeys.some((key) => nutrients[key] !== null) &&
    result.added_sugar_g === null
  )
    return null;
  const food = foodSchema.parse({
    id: crypto.randomUUID(),
    ...identity,
    basis: result.basis,
    nutrients,
    addedSugarG: result.added_sugar_g,
    evidence: foodEvidence(result.sources),
    confidence: result.confidence,
    assumptions: result.assumptions,
    version: 1,
  });
  return db.transaction("rw", [db.foods, db.aliases], async () => {
    const existing = findFood(
      identity,
      await db.foods.toArray(),
      await db.aliases.toArray(),
    );
    if (existing) return existing;
    await db.foods.add(food);
    return food;
  });
}

async function fetchPortion(
  db: CalioDatabase,
  transport: AiTransport,
  food: Food,
  item: ExtractItem,
  locale: Locale,
): Promise<{ portion: Portion | null; requiresReview: boolean }> {
  const cached = findPortion(
    food,
    item.unit,
    await db.portions.where("foodId").equals(food.id).toArray(),
  );
  if (cached) return { portion: cached, requiresReview: false };
  const input: Input<"portion"> = {
    food_name: food.nameEn || food.nameFa,
    variant: food.variant,
    preparation: food.preparation,
    unit: item.unit,
    quantity: item.quantity,
    known_evidence: null,
    locale,
  };
  const key = await sha256(
    JSON.stringify([
      "portion",
      transport.model,
      promptVersion,
      input.food_name,
      food.variant,
      food.preparation,
      food.brand,
      item.unit,
    ]),
  );
  const response = await requestAi(db, transport, "portion", input, key);
  const result = validatePortion(
    response.output,
    input,
    response.evidence,
    db.mode === "demo",
  );
  const { range_low: low, range_high: high, range_unit: unit } = result;
  if (result.status === "unresolved")
    return { portion: null, requiresReview: result.requires_review };
  const portion = portionSchema.parse({
    id: crypto.randomUUID(),
    foodId: food.id,
    variant: food.variant,
    unit: item.unit,
    gramsPerUnit: result.grams_per_unit,
    mlPerUnit: result.ml_per_unit,
    range:
      low !== null && high !== null && unit !== null
        ? { low, high, unit }
        : null,
    evidence: foodEvidence(result.sources),
    confidence: result.confidence,
    assumptions: result.assumptions,
    version: 1,
  });
  const saved = await db.transaction("rw", db.portions, async () => {
    const existing = findPortion(
      food,
      item.unit,
      await db.portions.where("foodId").equals(food.id).toArray(),
    );
    if (existing) return existing;
    await db.portions.add(portion);
    return portion;
  });
  return { portion: saved, requiresReview: result.requires_review };
}

async function calculateMeal(
  db: CalioDatabase,
  transport: AiTransport,
  note: DiaryNote,
  item: ExtractItem,
  locale: Locale,
): Promise<MealItem> {
  let food: Food | null = null;
  let portion: Portion | null = null;
  let requiresReview = item.requires_review;
  const supplement = isSupplement(item);
  const assumptions = [...item.assumptions];
  try {
    if (!supplement && !(item.requires_review && item.quantity === null)) {
      food = await fetchFood(db, transport, item, locale);
      const direct = resolveAmount(item.quantity, item.unit, null);
      if (
        food &&
        item.quantity !== null &&
        amountForBasis(direct, food.basis) === null
      ) {
        const result = await fetchPortion(db, transport, food, item, locale);
        portion = result.portion;
        requiresReview ||= result.requiresReview;
      }
    }
  } catch (error) {
    if (!(error instanceof AiFailure) || error.code !== "ai_search_unavailable")
      throw error;
    assumptions.push("ai_search_unavailable");
  }
  const amount = resolveAmount(item.quantity, item.unit, portion);
  const measured = food ? amountForBasis(amount, food.basis) : null;
  const nutrients = food
    ? scaleReference(food.nutrients, food.basis, amount)
    : unknownNutrients();
  const reviewReason = supplement
    ? "supplement_label_required"
    : (item.review_reason ?? (requiresReview ? "portion_review" : null));
  return records.meal_items.parse({
    entryId: note.id,
    revision: note.revision,
    itemId: item.item_id,
    localDate: note.localDate,
    nameFa: item.name_fa,
    nameEn: item.name_en,
    originalQuantity: item.quantity,
    originalUnit: item.unit,
    ...amount,
    foodId: food?.id ?? null,
    portionId: portion?.id ?? null,
    foodSnapshot: food,
    portionSnapshot: portion,
    nutrients,
    addedSugarG: scaleAmount(
      food?.addedSugarG ?? null,
      measured === null ? null : measured / 100,
    ),
    excludedFromTotals: supplement,
    confidence: item.confidence,
    assumptions: [...assumptions, ...(portion?.assumptions ?? [])],
    reviewReason,
    status: reviewReason
      ? "needs_review"
      : measured === null
        ? "unresolved"
        : "calculated",
  });
}

async function commitExtraction(
  db: CalioDatabase,
  claim: Claim,
  output: ExtractEntry,
  model: string,
) {
  return db.transaction(
    "rw",
    [db.processing_queue, db.journal_entries, db.parsed_entries],
    async () => {
      await requireLease(db, claim.job);
      const current = await db.journal_entries.get(claim.note.id);
      if (current?.revision !== claim.note.revision)
        throw new AiFailure("job_stale");
      await db.parsed_entries.put(
        records.parsed_entries.parse({
          entryId: current.id,
          revision: current.revision,
          localDate: current.localDate,
          promptVersion,
          model,
          output,
          symptoms: output.symptoms,
          unparsedText: output.unparsed_text,
          createdAt: new Date().toISOString(),
        }),
      );
    },
  );
}

async function commitMeals(db: CalioDatabase, claim: Claim, meals: MealItem[]) {
  const stage = meals.some(({ status }) => status === "needs_review")
    ? "needs_review"
    : "processed";
  return db.transaction(
    "rw",
    [db.processing_queue, db.journal_entries, db.meal_items],
    async () => {
      await requireLease(db, claim.job);
      const current = await db.journal_entries.get(claim.note.id);
      if (current?.revision !== claim.note.revision)
        throw new AiFailure("job_stale");
      await db.meal_items.where("entryId").equals(current.id).delete();
      await db.meal_items.bulkAdd(meals);
      await db.journal_entries.put({ ...current, status: stage });
      await releaseJob(db, claim.job, stage);
    },
  );
}

function noteInput(note: DiaryNote) {
  return {
    entry_id: note.id,
    revision: note.revision,
    local_date: note.localDate,
    text: note.text,
  };
}

function failureFor(error: unknown) {
  return error instanceof AiFailure
    ? error
    : new AiFailure("processing_failed");
}

function failureStage(error: AiFailure) {
  if (error.code === "job_stale") return "stale";
  if (error.code === "ai_offline") return "offline";
  return error.retryable ? "retryable" : "failed";
}

export async function processNotes(
  db: CalioDatabase,
  transport: AiTransport,
  options: { locale: Locale; explicit: boolean; notes: readonly DiaryNote[] },
) {
  if (db.mode !== transport.mode) throw new AiFailure("ai_mode_mismatch");
  if (db.mode === "real" && !(await db.settings.get("settings"))?.aiConsentAt)
    throw new AiFailure("ai_consent_required");
  const claims: Claim[] = [];
  for (const note of options.notes.slice(0, 12)) {
    const inputHash = await sha256(
      JSON.stringify([
        note.id,
        note.revision,
        note.localDate,
        promptVersion,
        transport.model,
      ]),
    );
    const job = await claimJob(
      db,
      { id: `note:${inputHash}`, period: null, inputHash },
      options.explicit,
    );
    if (job) claims.push({ note, job });
  }
  const result: Array<{
    noteId: string;
    status: "processed" | "needs_review" | "failed";
    error?: string;
  }> = [];
  if (!claims.length) return result;
  const fresh: Claim[] = [];
  const outputs = new Map<string, ExtractEntry>();
  try {
    for (const claim of claims) {
      const { note, job } = claim;
      await advanceJob(db, job, "extracting");
      const stored = await db.parsed_entries.get([note.id, note.revision]);
      if (
        stored?.model === transport.model &&
        stored.promptVersion === promptVersion
      ) {
        const validated = validateExtract(
          { entries: [stored.output] },
          { entries: [noteInput(note)], locale: options.locale },
        );
        const output = validated.entries[0];
        if (output) outputs.set(note.id, output);
      } else {
        fresh.push(claim);
      }
    }
    if (fresh.length) {
      const input = {
        entries: fresh.map(({ note }) => noteInput(note)),
        locale: options.locale,
      };
      const key = await sha256(
        JSON.stringify(["extract", transport.model, promptVersion, input]),
      );
      const response = await requestAi(db, transport, "extract", input, key);
      const output = validateExtract(response.output, input);
      for (const claim of fresh) {
        const parsed = output.entries.find(
          (row) => row.entry_id === claim.note.id,
        );
        if (!parsed) throw new AiFailure("ai_extract_identity");
        await commitExtraction(db, claim, parsed, transport.model);
        outputs.set(claim.note.id, parsed);
      }
    }
  } catch (error) {
    const failure = failureFor(error);
    await Promise.all(
      claims.map(({ job }) =>
        releaseJob(db, job, failureStage(failure), failure),
      ),
    );
    return claims.map(({ note }) => ({
      noteId: note.id,
      status: "failed" as const,
      error: failure.code,
    }));
  }
  for (const claim of claims) {
    try {
      const parsed = outputs.get(claim.note.id);
      if (!parsed) throw new AiFailure("ai_extract_identity");
      await advanceJob(db, claim.job, "matching");
      const meals: MealItem[] = [];
      for (const item of parsed.items) {
        await advanceJob(db, claim.job, "researching");
        meals.push(
          await calculateMeal(db, transport, claim.note, item, options.locale),
        );
      }
      await advanceJob(db, claim.job, "calculating");
      await commitMeals(db, claim, meals);
      result.push({
        noteId: claim.note.id,
        status: meals.some(({ status }) => status === "needs_review")
          ? "needs_review"
          : "processed",
      });
    } catch (error) {
      const failure = failureFor(error);
      await releaseJob(db, claim.job, failureStage(failure), failure);
      result.push({
        noteId: claim.note.id,
        status: "failed",
        error: failure.code,
      });
    }
  }
  return result;
}
