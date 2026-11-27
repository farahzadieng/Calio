import { z } from "zod";
import { localDate } from "./dates";
import {
  basisSchema,
  nonNegative,
  nutrientKeySchema,
  nutrientValuesSchema,
  scaleAmount,
} from "./nutrition";

const name = z.string().trim().max(250);
export const version = z.number().int().positive();
export const confidence = z.enum(["high", "medium", "low"]);

export const httpUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
});

export const foodEvidenceSchema = z.strictObject({
  url: httpUrl,
  title: name.min(1),
  accessedDate: localDate,
  basis: name.min(1),
  evidenceId: name.min(1),
  keys: z.array(nutrientKeySchema.or(z.literal("added_sugar_g"))),
});

export const foodSchema = z
  .strictObject({
    id: z.uuid(),
    nameFa: name,
    nameEn: name,
    variant: name,
    preparation: name,
    brand: name.nullable(),
    basis: basisSchema,
    nutrients: nutrientValuesSchema,
    addedSugarG: nonNegative.nullable(),
    evidence: z.array(foodEvidenceSchema),
    assumptions: z.array(z.string().max(2000)),
    confidence,
    version,
  })
  .refine((food) => !!(food.nameFa || food.nameEn));
export type Food = z.infer<typeof foodSchema>;

export const aliasSchema = z.strictObject({
  id: z.uuid(),
  foodId: z.uuid(),
  name: name.min(1),
});
export type FoodAlias = z.infer<typeof aliasSchema>;

export const portionSchema = z
  .strictObject({
    id: z.uuid(),
    foodId: z.uuid(),
    variant: name,
    unit: name.min(1),
    energyKcalPerUnit: z.number().min(0).max(2500).optional(),
    gramsPerUnit: z.number().positive().nullable(),
    mlPerUnit: z.number().positive().nullable(),
    range: z
      .strictObject({
        low: nonNegative,
        high: nonNegative,
        unit: z.enum(["g", "mL"]),
      })
      .nullable(),
    evidence: z.array(foodEvidenceSchema),
    assumptions: z.array(z.string().max(2000)),
    confidence,
    version,
  })
  .superRefine((portion, context) => {
    if (
      !portion.gramsPerUnit &&
      !portion.mlPerUnit &&
      portion.energyKcalPerUnit === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["gramsPerUnit"],
        message: "portion_amount_missing",
      });
    }
    if (!portion.range) return;
    const amount =
      portion.range.unit === "g" ? portion.gramsPerUnit : portion.mlPerUnit;
    if (
      amount === null ||
      amount < portion.range.low ||
      amount > portion.range.high
    ) {
      context.addIssue({
        code: "custom",
        path: ["range"],
        message: "portion_range",
      });
    }
  });
export type Portion = z.infer<typeof portionSchema>;

export function normalizeFoodText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u0640|[\u064b-\u065f]/g, "")
    .replace(/[\u200c\u200d\s]+/g, " ")
    .trim()
    .toLowerCase();
}

type Identity = Pick<
  Food,
  "nameFa" | "nameEn" | "variant" | "preparation" | "brand"
>;

function identityPart(value: string | null) {
  const normalized = normalizeFoodText(value ?? "");
  return normalized === "unknown" ? "" : normalized;
}

export function findFood(
  input: Identity,
  foods: readonly Food[],
  aliases: readonly FoodAlias[],
): Food | null {
  const names = new Set(
    [input.nameFa, input.nameEn].map(normalizeFoodText).filter(Boolean),
  );
  const aliased = new Set(
    aliases
      .filter((alias) => names.has(normalizeFoodText(alias.name)))
      .map((alias) => alias.foodId),
  );
  const candidates = foods.filter(
    (food) =>
      identityPart(input.variant) === identityPart(food.variant) &&
      identityPart(input.preparation) === identityPart(food.preparation) &&
      identityPart(input.brand) === identityPart(food.brand) &&
      (names.has(normalizeFoodText(food.nameFa)) ||
        names.has(normalizeFoodText(food.nameEn)) ||
        aliased.has(food.id)),
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

const servingUnits: Record<string, [string, string]> = {
  piece: ["عدد", "piece"],
  block: ["قالب", "block"],
  matchbox: ["قوطی کبریت", "matchbox"],
  handful: ["مشت", "handful"],
};

export function normalizeServingUnit(unit: string) {
  const normalized = normalizeFoodText(unit);
  return (
    Object.entries(servingUnits).find(([, labels]) =>
      labels.includes(normalized),
    )?.[0] ?? normalized
  );
}

export function servingUnitLabel(unit: string, locale: "fa" | "en") {
  return (
    servingUnits[normalizeServingUnit(unit)]?.[locale === "fa" ? 0 : 1] ?? unit
  );
}

export function findPortion(
  food: Food,
  unit: string,
  portions: readonly Portion[],
): Portion | null {
  const matching = portions.filter(
    (portion) =>
      portion.foodId === food.id &&
      identityPart(portion.variant) === identityPart(food.variant) &&
      normalizeServingUnit(portion.unit) === normalizeServingUnit(unit),
  );
  return (
    matching.find(
      (portion) => normalizeFoodText(portion.unit) === normalizeFoodText(unit),
    ) ?? (matching.length === 1 ? (matching[0] ?? null) : null)
  );
}

const massUnit = new Map([
  ["g", 1],
  ["gram", 1],
  ["grams", 1],
  ["گرم", 1],
  ["kg", 1000],
  ["کیلوگرم", 1000],
]);
const volumeUnit = new Map([
  ["ml", 1],
  ["میلی لیتر", 1],
  ["l", 1000],
  ["لیتر", 1000],
]);

export function resolveAmount(
  quantity: number | null,
  unit: string,
  portion: Portion | null,
) {
  const normalized = normalizeFoodText(unit);
  return {
    grams: scaleAmount(
      quantity,
      massUnit.get(normalized) ?? portion?.gramsPerUnit ?? null,
    ),
    ml: scaleAmount(
      quantity,
      volumeUnit.get(normalized) ?? portion?.mlPerUnit ?? null,
    ),
  };
}
