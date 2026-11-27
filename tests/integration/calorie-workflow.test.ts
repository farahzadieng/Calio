import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import {
  type AiTransport,
  type Input,
  type Output,
} from "../../src/ai/contracts";
import { CalioDatabase } from "../../src/db/database";
import {
  type CalorieAnswer,
  type CalorieTarget,
} from "../../src/domain/calorie-lookup";
import { unknownNutrients } from "../../src/domain/nutrition";
import {
  lookupCalorieFood,
  applyCalorieReference,
} from "../../src/services/calorie-lookup";
import { processNotes } from "../../src/services/food-processing";
import { saveNote } from "../../src/services/journal";
import { addSyntheticProfile } from "./synthetic";

const target: CalorieTarget = {
  nameFa: "خوراک آزمایشی",
  nameEn: "",
  variant: "",
  preparation: "cooked",
  brand: null,
  basis: "per_100g",
};
const source = {
  url: "https://nutrition.example/test",
  title: "Synthetic label",
};
const output: CalorieAnswer = {
  status: "known",
  kcalPer100: 123,
  basis: target.basis,
  source,
};

it("keeps the offline table local and caches Sonar calories for a measured item", async () => {
  const db = new CalioDatabase("real");
  const demo = new CalioDatabase("demo");
  const request = vi.fn<AiTransport["request"]>(
    async (_operation, _input, context) => ({
      requestId: context.requestId,
      model: "perplexity/sonar",
      provider: "IranRouter",
      output,
      evidence: [
        {
          ...source,
          id: "sonar-1",
          accessedDate: "2026-11-26",
          basis: "per_100g",
          supportedNutrients: ["energy_kcal"],
          supportsPortion: false,
          supportsAddedSugar: false,
          supportsRecipeYield: false,
        },
      ],
      usage: { inputTokens: 90, outputTokens: 40 },
    }),
  );
  const transport: AiTransport = {
    model: "openai/gpt-6-luna",
    mode: "real",
    request,
  };
  try {
    await addSyntheticProfile(db);
    const bread = { ...target, nameFa: "سنگک", preparation: "baked" };
    expect(
      (await lookupCalorieFood(db, transport, bread))?.nutrients.energy_kcal,
    ).toBe(258);
    expect(await demo.foods.count()).toBe(0);
    await expect(lookupCalorieFood(db, transport, target)).rejects.toThrow(
      "ai_consent_required",
    );
    expect(request).not.toHaveBeenCalled();
    await db.settings.update("settings", {
      aiConsentAt: "2026-11-26T10:00:00Z",
      calorieLookupMode: "api",
    });
    const [reference, concurrent] = await Promise.all([
      lookupCalorieFood(db, transport, target),
      lookupCalorieFood(db, transport, target),
    ]);
    expect(concurrent?.id).toBe(reference?.id);
    expect((await lookupCalorieFood(db, transport, target))?.id).toBe(
      reference?.id,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "calories",
      target,
      expect.any(Object),
    );
    if (!reference) throw new Error("fixture expected a reference");
    const note = await saveNote(db, {
      localDate: "2026-11-26",
      text: "یادداشت ساختگی",
      time: null,
    });
    const item = {
      entryId: note.id,
      itemId: "synthetic-item",
      revision: note.revision,
      localDate: note.localDate,
      nameFa: target.nameFa,
      nameEn: target.nameEn,
      originalQuantity: 50,
      originalUnit: "g",
      grams: 50,
      ml: null,
      foodId: null,
      portionId: null,
      foodSnapshot: null,
      portionSnapshot: null,
      nutrients: unknownNutrients(),
      addedSugarG: null,
      excludedFromTotals: false,
      confidence: "low" as const,
      assumptions: [],
      reviewReason: null,
      status: "unresolved" as const,
    };
    await db.meal_items.add(item);
    expect(await applyCalorieReference(db, item, reference)).toBe(true);
    expect(
      await db.meal_items.get([note.id, note.revision, item.itemId]),
    ).toMatchObject({
      foodId: reference.id,
      nutrients: { energy_kcal: 61.5, protein_g: null },
      status: "calculated",
    });
  } finally {
    await Promise.all([db.delete(), demo.delete()]);
  }
});

it("calculates customary servings and fractions in a batch, reuses references, and rejects a kilogram of breakfast cheese", async () => {
  const db = new CalioDatabase("real");
  function item(
    id: string,
    nameFa: string,
    nameEn: string,
    quantity: number,
    unit: string,
  ): Output<"extract">["entries"][number]["items"][number] {
    return {
      item_id: id,
      name_fa: nameFa,
      name_en: nameEn,
      quantity,
      unit,
      variant: "",
      preparation: "",
      brand: null,
      assumptions: [],
      confidence: "medium",
      requires_review: false,
      review_reason: null,
    };
  }
  const bread = (quantity: number, unit: string) =>
    item("bread", "نان تافتون", "Taftoon bread", quantity, unit);
  const cheese = (quantity: number, unit: string) =>
    item("cheese", "پنیر", "cheese", quantity, unit);
  const basil = item("basil", "ریحون", "basil", 1, "handful");
  const byDate = new Map([
    ["2026-11-25", [bread(0.5, "piece"), cheese(2, "قالب"), basil]],
    ["2026-11-26", [bread(20, "g"), cheese(1, "block"), basil]],
    ["2026-11-27", [bread(1, "عدد"), cheese(1, "matchbox")]],
  ]);
  const requests: Input<"calories">[] = [];
  const transport: AiTransport = {
    mode: "real",
    model: "synthetic/extract",
    async request(operation, input, { requestId }) {
      const usage = { inputTokens: 10, outputTokens: 10 };
      if (operation === "extract") {
        return {
          requestId,
          model: this.model,
          provider: "fixture",
          evidence: [],
          usage,
          output: {
            entries: (input as Input<"extract">).entries.map(
              ({ entry_id, revision, local_date }) => ({
                entry_id,
                revision,
                local_date,
                symptoms: [],
                unparsed_text: [],
                items: byDate.get(local_date),
              }),
            ),
          },
        };
      }
      expect(operation).toBe("calories");
      const search = input as Input<"calories">;
      requests.push(search);
      expect(search).not.toHaveProperty("text");
      const breadSearch = search.nameEn === "Taftoon bread";
      if (breadSearch) expect(search.portionOnly).toBe(true);
      const block = search.portionUnit === "block";
      return {
        requestId,
        model: "perplexity/sonar",
        provider: "fixture",
        usage,
        output: {
          status: "unknown",
          kcalPer100: null,
          basis: "per_100g",
          source: null,
          serving: {
            unit: search.portionUnit,
            kcalPerUnit:
              breadSearch || search.portionUnit === "matchbox"
                ? null
                : block
                  ? 80
                  : 5,
            amountPerUnit: breadSearch
              ? 75
              : search.portionUnit === "matchbox"
                ? 1000
                : null,
            source,
          },
        },
        evidence: [true].map((supportsPortion) => ({
          ...source,
          id: supportsPortion ? "portion" : "density",
          basis: "per_100g",
          accessedDate: "2026-11-26",
          supportedNutrients: ["energy_kcal"],
          supportsPortion,
          supportsAddedSugar: false,
          supportsRecipeYield: false,
        })),
      };
    },
  };
  try {
    await addSyntheticProfile(db);
    await db.settings.update("settings", {
      aiConsentAt: "2026-11-26T10:00:00Z",
    });
    const notes = await Promise.all(
      [...byDate.keys()].map((localDate) =>
        saveNote(db, { localDate, text: "یک یادداشت آزمایشی", time: null }),
      ),
    );
    const results = await processNotes(db, transport, {
      locale: "fa",
      notes,
      explicit: true,
    });
    expect(results.map(({ status }) => status)).toEqual([
      "processed",
      "processed",
      "processed",
    ]);
    async function energies(note: (typeof notes)[number]) {
      const meals = await db.meal_items
        .where("entryId")
        .equals(note.id)
        .toArray();
      return Object.fromEntries(
        meals.map((meal) => [meal.itemId, meal.nutrients.energy_kcal]),
      );
    }
    const [first, second, third] = notes;
    expect(await energies(first!)).toEqual({
      bread: 104.625,
      cheese: 160,
      basil: 5,
    });
    expect(await energies(second!)).toEqual({
      bread: expect.closeTo(55.8),
      cheese: 80,
      basil: 5,
    });
    expect(await energies(third!)).toEqual({ bread: 209.25, cheese: null });
    expect(requests.map(({ portionUnit }) => portionUnit).sort()).toEqual([
      "block",
      "handful",
      "matchbox",
      "piece",
    ]);
    expect(await db.portions.count()).toBe(3);
    expect(
      (await db.foods.toArray()).map(({ nameEn }) => nameEn).sort(),
    ).toEqual(["Taftoon bread", "basil", "cheese"]);
  } finally {
    await db.delete();
  }
});
