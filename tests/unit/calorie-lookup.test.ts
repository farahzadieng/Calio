import { expect, it } from "vitest";
import {
  calorieTargetSchema,
  makeCopiedCaloriePrompt,
  parseCopiedCalorieAnswer,
} from "../../src/domain/calorie-lookup";
import {
  findIranianCalorieReference,
  iranianCalorieReferences,
  iranianReferenceFood,
  searchIranianCalorieReferences,
} from "../../src/domain/iranian-calories";
import { foodSchema } from "../../src/domain/library";

const food = calorieTargetSchema.parse({
  nameFa: "خوراک آزمایشی",
  nameEn: "",
  variant: "",
  preparation: "",
  brand: null,
  basis: "per_100g",
});
const result = {
  status: "known",
  kcalPer100: 123,
  basis: food.basis,
  source: {
    url: "https://nutrition.example/food",
    title: "Synthetic reference",
  },
};

it("validates pasted calorie JSON against the original food and basis", () => {
  expect(makeCopiedCaloriePrompt(food, "fa")).toContain(food.nameFa);
  const json = JSON.stringify({ food, result });
  expect(parseCopiedCalorieAnswer(json, food)).toEqual(result);
  expect(parseCopiedCalorieAnswer("```json\n" + json + "\n```", food)).toEqual(
    result,
  );
  for (const payload of [
    { food: { ...food, nameFa: "خوراک دیگری" }, result },
    { food, result: { ...result, basis: "per_100ml" } },
    { food, result: { ...result, kcalPer100: "123" } },
    { food, result: { ...result, kcalPer100: -1 } },
    {
      food,
      result: {
        ...result,
        source: { ...result.source, url: "javascript:alert(1)" },
      },
    },
    { food, result: { ...result, private_note: "synthetic" } },
  ])
    expect(() =>
      parseCopiedCalorieAnswer(JSON.stringify(payload), food),
    ).toThrow();
  expect(
    calorieTargetSchema.safeParse({ ...food, rawNote: "synthetic" }).success,
  ).toBe(false);
  expect(
    calorieTargetSchema.safeParse({
      ...food,
      nameFa: "https://personal.example",
    }).success,
  ).toBe(false);
});

it("uses sourced Iranian rows only for compatible food, preparation, brand and basis", () => {
  const sangak = { ...food, nameFa: "نان سنگك" };
  expect(findIranianCalorieReference(sangak)?.kcalPer100g).toBe(258);
  expect(
    findIranianCalorieReference({ ...sangak, variant: "کنجدی" }),
  ).toBeNull();
  expect(
    findIranianCalorieReference({ ...sangak, basis: "per_100ml" }),
  ).toBeNull();
  const rice = { ...food, nameFa: "قورمه سبزی با برنج" };
  expect(findIranianCalorieReference(rice)).toBeNull();
  expect(
    findIranianCalorieReference({ ...rice, brand: "Moby Dick House of Kabob" })
      ?.kcalPer100g,
  ).toBe(115);
  expect(searchIranianCalorieReferences("بربری")).toHaveLength(1);
  for (const row of iranianCalorieReferences) {
    const archived = foodSchema.parse(iranianReferenceFood(row));
    expect(archived.nutrients.energy_kcal).toBeGreaterThan(0);
    expect(archived.nutrients.protein_g).toBeNull();
    expect(archived.evidence[0]?.keys).toEqual(["energy_kcal"]);
  }
});
