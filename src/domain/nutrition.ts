import { z } from "zod";
import nutrientContract from "../../schemas/nutrients.schema.json";
import nutrientRegistry from "../../data/nutrients.json";

export type NutrientKey = keyof typeof nutrientContract.properties;
export const nutrientKeys = Object.keys(
  nutrientContract.properties,
) as NutrientKey[];
export const nutrientMetadata = nutrientRegistry as Array<{
  key: NutrientKey;
  unit: string;
  category: string;
}>;
export const nutrientKeySchema = z.enum(nutrientKeys);
export const nonNegative = z.number().nonnegative();
export const basisSchema = z.enum(["per_100g", "per_100ml"]);
export type Basis = z.infer<typeof basisSchema>;
type NutrientShape = Record<NutrientKey, z.ZodNullable<typeof nonNegative>>;
const values = Object.fromEntries(
  nutrientKeys.map((key) => [key, nonNegative.nullable()]),
) as NutrientShape;
export const nutrientValuesSchema = z.strictObject(values);
export type Nutrients = z.infer<typeof nutrientValuesSchema>;

function mapKeys<T>(transform: (key: NutrientKey) => T) {
  return Object.fromEntries(
    nutrientKeys.map((key) => [key, transform(key)]),
  ) as Record<NutrientKey, T>;
}

export const unknownNutrients = () => mapKeys(() => null) as Nutrients;

export type Amount = { grams: number | null; ml: number | null };

export function amountForBasis(amount: Amount, basis: Basis) {
  return basis === "per_100g" ? amount.grams : amount.ml;
}

export function scaleAmount(
  value: number | null,
  multiplier: number | null,
): number | null {
  if (value === null || multiplier === null || multiplier < 0) return null;
  const result = value * multiplier;
  return Number.isFinite(result) ? result : null;
}

export function scaleNutrients(
  nutrients: Nutrients,
  multiplier: number | null,
): Nutrients {
  return mapKeys((key) => scaleAmount(nutrients[key], multiplier));
}

export function scaleReference(
  nutrients: Nutrients,
  basis: Basis,
  amount: Amount,
): Nutrients {
  const consumed = amountForBasis(amount, basis);
  return scaleNutrients(nutrients, consumed === null ? null : consumed / 100);
}

export function summarizeNutrients(items: readonly Nutrients[]) {
  const coverage = mapKeys(
    (key) => items.filter((item) => item[key] !== null).length,
  );
  const totals = mapKeys((key) => {
    if (!coverage[key]) return null;
    const total = items.reduce((sum, item) => sum + (item[key] ?? 0), 0);
    return Number.isFinite(total) ? total : null;
  });
  return { totals, knownItemCounts: coverage, itemCount: items.length };
}

export function sodiumToSalt(sodiumMg: number | null) {
  return scaleAmount(sodiumMg, 0.0025);
}

export function recipeReference(
  ingredients: ReadonlyArray<{
    amount: Amount;
    basis: Basis;
    nutrients: Nutrients;
  }>,
  edibleYieldG: number | null,
): Nutrients {
  if (!edibleYieldG || edibleYieldG < 0 || !ingredients.length)
    return unknownNutrients();
  const sum = summarizeNutrients(
    ingredients.map((item) =>
      scaleReference(item.nutrients, item.basis, item.amount),
    ),
  );
  return mapKeys((key) =>
    sum.knownItemCounts[key] === ingredients.length
      ? scaleAmount(sum.totals[key], 100 / edibleYieldG)
      : null,
  );
}
