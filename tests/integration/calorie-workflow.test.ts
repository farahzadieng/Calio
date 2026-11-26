import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { type AiTransport } from "../../src/ai/contracts";
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
