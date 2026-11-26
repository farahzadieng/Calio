import type { CalioDatabase } from "../db/database";
import { records, type MealItem } from "../db/records";
import {
  amountForBasis,
  scaleAmount,
  scaleReference,
} from "../domain/nutrition";
import { invalidateDates } from "./journal";

export async function correctFoodAmount(
  db: CalioDatabase,
  item: Pick<MealItem, "entryId" | "revision" | "itemId">,
  input: { foodId: string; grams: number | null; ml: number | null },
) {
  return db.transaction(
    "rw",
    [
      db.meal_items,
      db.foods,
      db.journal_entries,
      db.ai_reports,
      db.processing_queue,
      db.messages,
    ],
    async () => {
      const previous = await db.meal_items.get([
        item.entryId,
        item.revision,
        item.itemId,
      ]);
      const note = await db.journal_entries.get(item.entryId);
      const food = await db.foods.get(input.foodId);
      if (
        !previous ||
        !food ||
        note?.revision !== item.revision ||
        previous.excludedFromTotals
      ) {
        throw new Error("meal_correction_stale");
      }
      const consumed = amountForBasis(input, food.basis);
      if (consumed === null || !Number.isFinite(consumed) || consumed <= 0)
        throw new Error("meal_correction_amount");
      const replacement = records.meal_items.parse({
        ...previous,
        foodId: food.id,
        foodSnapshot: food,
        portionId: null,
        portionSnapshot: null,
        grams: input.grams,
        ml: input.ml,
        nutrients: scaleReference(food.nutrients, food.basis, input),
        addedSugarG: scaleAmount(food.addedSugarG, consumed / 100),
        confidence: food.confidence,
        status: "calculated",
        reviewReason: null,
      });
      await db.meal_items.put(replacement);
      const remainingReview = await db.meal_items
        .where("entryId")
        .equals(item.entryId)
        .filter(({ status }) => status === "needs_review")
        .count();
      await db.journal_entries.update(note.id, {
        status: remainingReview ? "needs_review" : "processed",
      });
      await invalidateDates(db, [replacement.localDate]);
    },
  );
}
