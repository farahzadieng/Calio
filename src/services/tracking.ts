import type { CalioDatabase } from "../db/database";
import {
  records,
  type Drink,
  type Row,
  type SupplementLog,
  type SupplementProduct,
} from "../db/records";
import {
  profileSchema,
  settingsSchema,
  type Profile,
  type Settings,
} from "../domain/profile";
import { localDate } from "../domain/dates";
import { invalidateDates } from "./journal";

type ProfileFields = Omit<Profile, "id" | "createdAt" | "updatedAt">;
type SettingsFields = Omit<Settings, "id">;
type EventInput<T> = Omit<T, "id" | "createdAt" | "updatedAt">;

export async function saveProfile(
  db: CalioDatabase,
  profile: ProfileFields,
  settings: SettingsFields,
  localDateForWeight: string,
  now = new Date(),
) {
  const at = now.toISOString();
  return db.transaction(
    "rw",
    [db.profile, db.settings, db.weight_logs],
    async () => {
      const existing = await db.profile.get("profile");
      const validated = profileSchema.parse({
        ...profile,
        id: "profile",
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      });
      await db.profile.put(validated);
      await db.settings.put(
        settingsSchema.parse({ ...settings, id: "settings" }),
      );
      if (!existing) {
        await db.weight_logs.add(
          records.weight_logs.parse({
            id: crypto.randomUUID(),
            createdAt: at,
            updatedAt: at,
            localDate: localDateForWeight,
            time: null,
            kg: validated.weightKg,
          }),
        );
      }
      return validated;
    },
  );
}

export async function saveDrink(
  db: CalioDatabase,
  input: EventInput<Drink>,
  id?: string,
  now = new Date(),
) {
  return db.transaction(
    "rw",
    [
      db.drinks,
      db.meal_items,
      db.supplement_logs,
      db.ai_reports,
      db.processing_queue,
      db.messages,
    ],
    async () => {
      const old = id ? await db.drinks.get(id) : undefined;
      if (id && !old) throw new Error("drink_missing");
      const row = records.drinks.parse({
        ...input,
        id: old?.id ?? crypto.randomUUID(),
        createdAt: old?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      });
      await verifyMealLink(db, row, row.id, "drink");
      await db.drinks.put(row);
      await invalidateDates(
        db,
        old ? [old.localDate, row.localDate] : [row.localDate],
      );
      return row;
    },
  );
}

type SupplementProductInput = Omit<EventInput<SupplementProduct>, "version">;
type SupplementLogInput = Omit<EventInput<SupplementLog>, "productSnapshot">;

const supplementLogTables = (db: CalioDatabase) => [
  db.supplement_logs,
  db.supplement_products,
  db.drinks,
  db.meal_items,
  db.ai_reports,
  db.processing_queue,
  db.messages,
];

export async function saveSupplementProduct(
  db: CalioDatabase,
  input: SupplementProductInput,
  id?: string,
  now = new Date(),
) {
  return db.transaction("rw", db.supplement_products, async () => {
    const old = id ? await db.supplement_products.get(id) : undefined;
    if (id && !old) throw new Error("supplement_product_missing");
    const product = records.supplement_products.parse({
      ...input,
      id: old?.id ?? crypto.randomUUID(),
      createdAt: old?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      version: (old?.version ?? 0) + 1,
    });
    if (
      new Set(product.composition.map(({ key }) => key)).size !==
      product.composition.length
    ) {
      throw new Error("supplement_duplicate_nutrient");
    }
    await db.supplement_products.put(product);
    return product;
  });
}

export async function saveSupplementLog(
  db: CalioDatabase,
  input: SupplementLogInput,
  id?: string,
  now = new Date(),
) {
  return db.transaction("rw", supplementLogTables(db), async () => {
    const old = id ? await db.supplement_logs.get(id) : undefined;
    if (id && !old) throw new Error("supplement_log_missing");
    const product =
      old?.productId === input.productId
        ? old.productSnapshot
        : await db.supplement_products.get(input.productId);
    if (!product) throw new Error("supplement_product_missing");
    const log = records.supplement_logs.parse({
      ...input,
      id: old?.id ?? crypto.randomUUID(),
      createdAt: old?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      productSnapshot: product,
    });
    await verifyMealLink(db, log, log.id, "supplement");
    await db.supplement_logs.put(log);
    await invalidateDates(
      db,
      old ? [old.localDate, log.localDate] : [log.localDate],
    );
    return log;
  });
}

export function saveSupplementWithServing(
  db: CalioDatabase,
  productInput: SupplementProductInput,
  serving: Pick<SupplementLogInput, "localDate" | "servings">,
  now = new Date(),
) {
  return db.transaction("rw", supplementLogTables(db), async () => {
    const product = await saveSupplementProduct(
      db,
      productInput,
      undefined,
      now,
    );
    return saveSupplementLog(
      db,
      { ...serving, productId: product.id, time: null, matchedMeal: null },
      undefined,
      now,
    );
  });
}

async function verifyMealLink(
  db: CalioDatabase,
  event: Pick<Drink, "matchedMeal" | "localDate">,
  id: string,
  kind: "drink" | "supplement",
) {
  if (!event.matchedMeal) return;
  const { entryId, itemId, revision } = event.matchedMeal;
  const meal = await db.meal_items.get([entryId, revision, itemId]);
  if (
    meal?.localDate !== event.localDate ||
    meal.excludedFromTotals !== (kind === "supplement")
  ) {
    throw new Error("tracking_meal_link");
  }
  const sameLink = (row: Drink | SupplementLog) =>
    row.id !== id &&
    row.matchedMeal?.entryId === entryId &&
    row.matchedMeal.revision === revision &&
    row.matchedMeal.itemId === itemId;
  if (
    (await db.drinks.filter(sameLink).count()) ||
    (await db.supplement_logs.filter(sameLink).count())
  ) {
    throw new Error("tracking_meal_link_duplicate");
  }
}

export function deleteEvent(
  db: CalioDatabase,
  table: "drinks" | "supplement_logs" | "weight_logs",
  id: string,
) {
  return db.transaction(
    "rw",
    [db[table], db.ai_reports, db.processing_queue, db.messages],
    async () => {
      const row = await db[table].get(id);
      if (!row) return;
      await db[table].delete(id);
      if (table !== "weight_logs") await invalidateDates(db, [row.localDate]);
    },
  );
}

export async function saveWeight(
  db: CalioDatabase,
  input: EventInput<Row<"weight_logs">>,
  now = new Date(),
) {
  const at = now.toISOString();
  const row = records.weight_logs.parse({
    ...input,
    id: crypto.randomUUID(),
    createdAt: at,
    updatedAt: at,
  });
  await db.weight_logs.add(row);
  return row;
}

export function weightTimeline(db: CalioDatabase, start: string, end: string) {
  return db.weight_logs
    .where("localDate")
    .between(localDate.parse(start), localDate.parse(end), true, true)
    .toArray();
}
