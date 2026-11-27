import { z } from "zod";
import * as validate from "../generated/validate.mjs";
import type { ExtractOutput } from "../generated/extract";
import type { PortionOutput } from "../generated/portion";
import type { ResearchOutput } from "../generated/research";
import type { WeeklyOutput } from "../generated/weekly";
import { localDate, localeSchema } from "../domain/dates";
import {
  calorieSearchSchema,
  type CalorieAnswer,
} from "../domain/calorie-lookup";
import { httpUrl, normalizeFoodText } from "../domain/library";
import {
  nonNegative,
  nutrientKeys,
  type NutrientKey,
} from "../domain/nutrition";

export const promptVersion = "v1";
export const extractionPromptVersion = "v2";
export const operations = [
  "extract",
  "portion",
  "research",
  "weekly",
  "calories",
] as const;
export type Operation = (typeof operations)[number];

const entry = z.strictObject({
  entry_id: z.string().min(1).max(100),
  revision: z.number().int().positive(),
  local_date: localDate,
  text: z.string().min(1).max(32_000),
});
const foodName = z.string().trim().max(250);
const key = z.enum(nutrientKeys);

export const inputSchemas = {
  calories: calorieSearchSchema,
  extract: z.strictObject({
    entries: z.array(entry).min(1).max(12),
    locale: localeSchema,
  }),
  portion: z.strictObject({
    food_name: foodName.min(1),
    variant: foodName,
    preparation: foodName,
    unit: foodName.min(1),
    quantity: nonNegative.nullable(),
    known_evidence: z.null(),
    locale: localeSchema,
  }),
  research: z.strictObject({
    food_name_fa: foodName,
    food_name_en: foodName,
    variant: foodName,
    preparation: foodName,
    brand: foodName.nullable(),
    requested_nutrient_keys: z.array(key).max(nutrientKeys.length),
    known_reference: z.null(),
    locale: localeSchema,
  }),
  weekly: z.strictObject({
    period_id: z.string().min(1).max(150),
    locale: localeSchema,
    profile_reference: z
      .strictObject({
        age: z.number().int().min(18),
        physiology: z.enum(["male", "female"]).nullable(),
      })
      .nullable(),
    goal: z.enum(["understand", "maintain", "lose", "gain"]).nullable(),
    local_statistics: z.json(),
    evidence: z.array(
      z.strictObject({ id: z.string().min(1).max(250), facts: z.json() }),
    ),
    food_patterns: z.json(),
    supplement_totals: z.json(),
    reported_symptoms: z.array(z.string().max(2000)),
    coverage: z.json(),
    reference_versions: z.array(z.string().max(250)),
  }),
};

type Inputs = { [Name in Operation]: z.infer<(typeof inputSchemas)[Name]> };
type Outputs = {
  extract: ExtractOutput;
  portion: PortionOutput;
  research: ResearchOutput;
  weekly: WeeklyOutput;
  calories: CalorieAnswer;
};

export const toolEvidenceSchema = z.strictObject({
  id: z.string().min(1).max(250),
  url: httpUrl,
  title: z.string().trim().min(1).max(250),
  accessedDate: localDate,
  basis: z.string().trim().min(1).max(150),
  supportedNutrients: z.array(key),
  supportsPortion: z.boolean(),
  supportsAddedSugar: z.boolean(),
  supportsRecipeYield: z.boolean(),
});

export const responseSchema = z.strictObject({
  requestId: z.string().min(1).max(160),
  model: z.string().min(1).max(250),
  provider: z.string().min(1).max(250),
  output: z.unknown(),
  evidence: z.array(toolEvidenceSchema).max(100),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  }),
});

export type Input<Name extends Operation> = Inputs[Name];
export type Output<Name extends Operation> = Outputs[Name];
export type AiResponse = z.infer<typeof responseSchema>;
export type ToolEvidence = z.infer<typeof toolEvidenceSchema>;
export type RequestContext = {
  requestId: string;
  idempotencyKey: string;
  signal: AbortSignal;
};

export interface AiTransport {
  readonly mode: "real" | "demo";
  readonly model: string;
  readonly calorieModel?: string;
  request<Name extends Operation>(
    operation: Name,
    input: Input<Name>,
    context: RequestContext,
  ): Promise<unknown>;
}

export class AiFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(code);
  }
}

type Source = ResearchOutput["sources"][number];

function verifySources(sources: Source[], toolEvidence: ToolEvidence[]) {
  const ids = new Map(toolEvidence.map((row) => [row.id, row]));
  if (ids.size !== toolEvidence.length) throw new AiFailure("ai_evidence");
  const verified = sources.map((source) => {
    const record = ids.get(source.tool_evidence_id);
    if (
      !record ||
      source.url !== record.url ||
      source.title !== record.title ||
      source.accessed_date !== record.accessedDate ||
      source.basis !== record.basis ||
      source.nutrient_keys.some(
        (key) => !record.supportedNutrients.includes(key),
      )
    ) {
      throw new AiFailure("ai_evidence");
    }
    return record;
  });
  return verified;
}

export function validateExtract(
  raw: unknown,
  input: Input<"extract">,
): ExtractOutput {
  if (!validate.extract(raw) || raw.entries.length !== input.entries.length)
    throw new AiFailure("ai_extract_schema");
  const expected = new Map(
    input.entries.map((entry) => [entry.entry_id, entry]),
  );
  for (const row of raw.entries) {
    const match = expected.get(row.entry_id);
    if (
      !match ||
      row.revision !== match.revision ||
      row.local_date !== match.local_date
    ) {
      throw new AiFailure("ai_extract_identity");
    }
    expected.delete(row.entry_id);
    if (
      new Set(row.items.map(({ item_id }) => item_id)).size !==
        row.items.length ||
      row.items.some(
        (item) =>
          !item.item_id.trim() ||
          !(item.name_en.trim() || item.name_fa.trim()) ||
          !item.unit.trim() ||
          (item.requires_review && !item.review_reason?.trim()),
      )
    ) {
      throw new AiFailure("ai_extract_item");
    }
  }
  return raw;
}

export function validatePortion(
  raw: unknown,
  input: Input<"portion">,
  evidence: ToolEvidence[],
  demo: boolean,
): PortionOutput {
  if (!validate.portion(raw)) throw new AiFailure("ai_portion_schema");
  const same = (a: string, b: string) =>
    normalizeFoodText(a) === normalizeFoodText(b);
  if (
    !same(raw.food_name, input.food_name) ||
    !same(raw.variant, input.variant) ||
    !same(raw.unit, input.unit)
  ) {
    throw new AiFailure("ai_portion_identity");
  }
  const amountExists = raw.grams_per_unit !== null || raw.ml_per_unit !== null;
  if (
    (raw.status === "unresolved") === amountExists ||
    raw.grams_per_unit === 0 ||
    raw.ml_per_unit === 0
  ) {
    throw new AiFailure("ai_portion_amount");
  }
  const { range_low: low, range_high: high, range_unit: unit } = raw;
  if (low !== null || high !== null || unit !== null) {
    const center = unit === "g" ? raw.grams_per_unit : raw.ml_per_unit;
    if (
      low === null ||
      high === null ||
      unit === null ||
      center === null ||
      low > center ||
      high < center
    ) {
      throw new AiFailure("ai_portion_range");
    }
  }
  if (
    !demo &&
    amountExists &&
    !verifySources(raw.sources, evidence).some(
      ({ supportsPortion }) => supportsPortion,
    )
  ) {
    throw new AiFailure("ai_evidence");
  }
  return raw;
}

export function validateResearch(
  raw: unknown,
  input: Input<"research">,
  evidence: ToolEvidence[],
  demo: boolean,
): ResearchOutput {
  if (!validate.research(raw)) throw new AiFailure("ai_research_schema");
  const same = (a: string, b: string) =>
    normalizeFoodText(a) === normalizeFoodText(b);
  if (
    !same(raw.variant, input.variant) ||
    !(
      (input.food_name_fa && same(raw.food_name_fa, input.food_name_fa)) ||
      (input.food_name_en && same(raw.food_name_en, input.food_name_en))
    )
  ) {
    throw new AiFailure("ai_research_identity");
  }
  if (demo) return raw;
  const sources = verifySources(raw.sources, evidence);
  const supported = (nutrient: NutrientKey, supporting: Source[]) =>
    supporting.some(({ nutrient_keys }) => nutrient_keys.includes(nutrient));
  if (
    (raw.added_sugar_g !== null &&
      !sources.some(({ supportsAddedSugar }) => supportsAddedSugar)) ||
    nutrientKeys.some(
      (key) => raw.nutrients[key] !== null && !supported(key, raw.sources),
    )
  ) {
    throw new AiFailure("ai_evidence");
  }
  if (raw.recipe) {
    if (
      raw.basis !== "per_100g" ||
      raw.recipe.final_yield_g === 0 ||
      (raw.recipe.final_yield_g !== null &&
        !sources.some(({ supportsRecipeYield }) => supportsRecipeYield))
    ) {
      throw new AiFailure("ai_recipe_yield");
    }
    for (const ingredient of raw.recipe.ingredients) {
      const matching = raw.sources.filter((source) =>
        ingredient.source_ids.includes(source.tool_evidence_id),
      );
      if (
        ingredient.source_ids.some(
          (id) => !sources.some((source) => source.id === id),
        ) ||
        nutrientKeys.some(
          (key) =>
            ingredient.nutrients[key] !== null && !supported(key, matching),
        )
      ) {
        throw new AiFailure("ai_evidence");
      }
    }
  }
  if (
    raw.status === "unresolved" &&
    (raw.recipe || nutrientKeys.some((key) => raw.nutrients[key] !== null))
  ) {
    throw new AiFailure("ai_research_unresolved");
  }
  return raw;
}

export function validateWeekly(
  raw: unknown,
  input: Input<"weekly">,
): WeeklyOutput {
  if (!validate.weekly(raw) || raw.period_id !== input.period_id)
    throw new AiFailure("ai_weekly_schema");
  const evidence = new Set(input.evidence.map(({ id }) => id));
  const findings = [
    ...raw.strengths,
    ...raw.attention,
    ...raw.lifestyle_associations,
    ...raw.actions,
  ];
  if (
    findings.some(
      ({ evidence_ids }) =>
        !evidence_ids.length || evidence_ids.some((id) => !evidence.has(id)),
    )
  ) {
    throw new AiFailure("ai_weekly_evidence");
  }
  return raw;
}
