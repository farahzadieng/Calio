import table from "../../data/iranian-calorie-references.json";
import type { CalorieTarget } from "./calorie-lookup";
import { normalizeFoodText, type Food } from "./library";
import { unknownNutrients } from "./nutrition";

type PublishedEntry = (typeof table.foods)[number];
type SourceKey = keyof typeof table.sources;

function energyPer100g(entry: PublishedEntry) {
  if ("servingKcal" in entry && entry.servingKcal !== undefined) {
    return Math.round((entry.servingKcal * 100) / entry.servingGrams);
  }
  return entry.kcalPer100g;
}

export const iranianCalorieReferences = table.foods.map((entry) => ({
  ...entry,
  kcalPer100g: energyPer100g(entry),
  publication: table.sources[entry.source as SourceKey],
}));

export type IranianCalorieReference = (typeof iranianCalorieReferences)[number];

function terms(row: Pick<PublishedEntry, "nameFa" | "nameEn" | "aliases">) {
  return [row.nameFa, row.nameEn, ...row.aliases].map(normalizeFoodText);
}

export function searchIranianCalorieReferences(query: string) {
  const search = normalizeFoodText(query);
  return iranianCalorieReferences.filter((row) =>
    terms(row).some((term) => term.includes(search)),
  );
}

const neutral = new Set([
  "",
  "unknown",
  "نامشخص",
  "نامعلوم",
  "معمولی",
  "سنتی",
  "خانگی",
  "traditional",
  "regular",
  "homemade",
]);
const cookingAliases: Record<string, readonly string[]> = {
  cooked: ["پخته", "پخته شده", "cooked"],
  fried: ["سرخ شده", "سرخ کرده", "fried", "pan fried", "pan-fried"],
  baked: ["تنوری", "پخته شده", "baked"],
  prepared: ["آماده", "prepared"],
};

export function findIranianCalorieReference(target: CalorieTarget) {
  if (target.basis !== "per_100g") {
    return null;
  }
  const brand = normalizeFoodText(target.brand ?? "");
  const names = [target.nameFa, target.nameEn]
    .map(normalizeFoodText)
    .filter(Boolean);
  const detail = [target.variant, target.preparation].map(normalizeFoodText);
  const matches = iranianCalorieReferences.filter((row) => {
    const rowBrand = normalizeFoodText(row.brand ?? "");
    if (rowBrand ? brand !== rowBrand : !neutral.has(brand)) return false;
    const rowTerms = terms(row);
    return (
      names.some((name) => rowTerms.includes(name)) &&
      detail.every(
        (part) =>
          neutral.has(part) ||
          rowTerms.includes(part) ||
          part === row.preparation ||
          (cookingAliases[row.preparation] ?? []).includes(part),
      )
    );
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function iranianReferenceFood(row: IranianCalorieReference): Food {
  return {
    id: row.id,
    nameFa: row.nameFa,
    nameEn: row.nameEn,
    variant: "",
    preparation: row.preparation,
    brand: row.brand ?? null,
    basis: "per_100g",
    nutrients: { ...unknownNutrients(), energy_kcal: row.kcalPer100g },
    addedSugarG: null,
    evidence: [
      {
        url: row.publication.url,
        title: row.publication.title,
        accessedDate: table.accessedDate,
        basis: "per_100g",
        evidenceId: row.source,
        keys: ["energy_kcal"],
      },
    ],
    assumptions: [
      row.brand ? "published_restaurant_label" : "published_recipe_or_sample",
    ],
    confidence: "medium",
    version: 1,
  };
}
