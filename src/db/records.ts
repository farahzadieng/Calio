import { z } from "zod";
import { localDate, timestamp } from "../domain/dates";
import {
  aliasSchema,
  confidence,
  foodSchema,
  httpUrl,
  portionSchema,
  version,
} from "../domain/library";
import {
  nonNegative,
  nutrientKeySchema,
  nutrientValuesSchema,
} from "../domain/nutrition";
import { profileSchema, settingsSchema, weightKg } from "../domain/profile";
import { healthDaySchema, healthImportSchema } from "../domain/health";

const id = z.uuid();
const timeOfDay = z.iso.time({ precision: -1 }).nullable();
const revision = z.number().int().positive();
const text = z.string().max(32_000);
const label = z.string().trim().min(1).max(250);
const saved = { id, createdAt: timestamp, updatedAt: timestamp };
const dated = { ...saved, localDate, time: timeOfDay };
const period = z
  .strictObject({
    id: z.string().min(1).max(150),
    start: localDate,
    end: localDate,
  })
  .refine(({ start, end }) => start <= end);

export const journalSchema = z.strictObject({
  ...dated,
  text: text.refine((value) => value.trim().length > 0),
  revision,
  status: z.enum(["pending", "processed", "needs_review"]),
});
export const draftSchema = z
  .strictObject({
    id: z.literal("journal").or(id),
    localDate,
    text,
    updatedAt: timestamp,
    revision: revision.optional(),
  })
  .refine((row) =>
    row.id === "journal"
      ? row.revision === undefined
      : row.revision !== undefined,
  );
const parsedSchema = z.strictObject({
  entryId: id,
  revision,
  localDate,
  promptVersion: label,
  model: label,
  output: z.json(),
  symptoms: z.array(text),
  unparsedText: z.array(text),
  createdAt: timestamp,
});
const itemLinkSchema = z.strictObject({
  entryId: id,
  itemId: label,
  revision,
});
const mealSchema = z.strictObject({
  ...itemLinkSchema.shape,
  localDate,
  nameFa: z.string().max(250),
  nameEn: z.string().max(250),
  originalQuantity: nonNegative.nullable(),
  originalUnit: label,
  grams: nonNegative.nullable(),
  ml: nonNegative.nullable(),
  foodId: id.nullable(),
  portionId: id.nullable(),
  foodSnapshot: foodSchema.nullable(),
  portionSnapshot: portionSchema.nullable(),
  nutrients: nutrientValuesSchema,
  addedSugarG: nonNegative.nullable(),
  excludedFromTotals: z.boolean(),
  confidence,
  assumptions: z.array(text),
  reviewReason: z.string().max(4000).nullable(),
  status: z.enum(["calculated", "unresolved", "needs_review"]),
});
const drinkSchema = z.strictObject({
  ...dated,
  kind: z.enum(["water", "coffee", "tea", "alcohol_free_beer", "other"]),
  title: label,
  strength: label.nullable(),
  amountMl: z.number().positive(),
  caffeineMg: nonNegative.nullable(),
  matchedMeal: itemLinkSchema.nullable(),
});
const supplementLabelUnit = z.enum(["g", "mg", "µg", "mL", "kcal", "IU"]);
const supplementProductSchema = z.strictObject({
  ...saved,
  name: label,
  servingUnit: label,
  labelEvidence: z.string().max(4000),
  composition: z.array(
    z.strictObject({
      key: nutrientKeySchema,
      amount: nonNegative.nullable(),
      unit: supplementLabelUnit,
    }),
  ),
  otherIngredients: z
    .array(
      z.strictObject({
        name: label,
        amount: nonNegative.nullable(),
        unit: supplementLabelUnit,
      }),
    )
    .optional(),
  version,
});
const supplementLogSchema = z.strictObject({
  ...dated,
  productId: id,
  productSnapshot: supplementProductSchema,
  servings: z.number().positive().nullable(),
  matchedMeal: itemLinkSchema.nullable(),
});
const weightLogSchema = z.strictObject({ ...dated, kg: weightKg });
const referenceSchema = z
  .strictObject({
    id: label,
    key: nutrientKeySchema,
    kind: z.enum(["RDA", "AI", "UL", "limit"]),
    minAge: z.number().int().nonnegative(),
    maxAge: z.number().int().nonnegative(),
    physiology: z.enum(["female", "male", "any"]),
    scope: z.enum(["total", "supplement"]),
    amount: nonNegative,
    unit: label,
    source: httpUrl,
    version: label,
  })
  .refine((row) => row.minAge <= row.maxAge);

const status = z.enum([
  "pending",
  "extracting",
  "matching",
  "researching",
  "validating",
  "calculating",
  "awaiting_health",
  "reporting",
  "ready",
  "offline",
  "retryable",
  "failed",
  "needs_review",
  "stale",
  "processed",
]);
const jobSchema = z.strictObject({
  id: z.string().min(1).max(150),
  period: period.nullable(),
  inputHash: z.string().regex(/^[a-f\d]{64}$/),
  stage: status,
  attempt: z.number().int().nonnegative(),
  leaseOwner: id.nullable(),
  leaseUntil: timestamp.nullable(),
  retryAt: timestamp.nullable(),
  error: z.string().max(120).nullable(),
  restored: z.boolean(),
  updatedAt: timestamp,
});
const reportSchema = z.strictObject({
  id: z.string().min(1).max(150),
  period,
  inputHash: z.string().regex(/^[a-f\d]{64}$/),
  evidenceIds: z.array(label),
  healthDays: z.number().int().nonnegative(),
  loggedDays: z.number().int().nonnegative(),
  output: z.json(),
  promptVersion: label,
  status: z.enum(["ready", "stale"]),
  createdAt: timestamp,
});
const messageSchema = z.strictObject({
  id: label,
  kind: label,
  period: period.nullable(),
  test: z.boolean(),
  severity: z.enum(["success", "info", "warning", "error"]),
  seen: z.boolean(),
  createdAt: timestamp,
});
const diagnosticSchema = z.strictObject({
  id,
  code: z.string().regex(/^[a-z0-9_-]{1,120}$/),
  test: z.boolean(),
  outcome: z.enum(["success", "failed", "blocked"]),
  createdAt: timestamp,
});
const apiUsageSchema = z.strictObject({
  id,
  provider: label,
  model: label,
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  durationMs: nonNegative,
  requestId: label,
  status: z.enum(["success", "failed"]),
  createdAt: timestamp,
});

export const records = {
  profile: profileSchema,
  settings: settingsSchema,
  journal_entries: journalSchema,
  journal_draft: draftSchema,
  parsed_entries: parsedSchema,
  meal_items: mealSchema,
  foods: foodSchema,
  aliases: aliasSchema,
  portions: portionSchema,
  drinks: drinkSchema,
  supplement_products: supplementProductSchema,
  supplement_logs: supplementLogSchema,
  weight_logs: weightLogSchema,
  nutrient_references: referenceSchema,
  health_daily: healthDaySchema,
  health_imports: healthImportSchema,
  processing_queue: jobSchema,
  ai_reports: reportSchema,
  api_usage: apiUsageSchema,
  messages: messageSchema,
  diagnostics: diagnosticSchema,
} as const;

export type TableName = keyof typeof records;
export type Row<T extends TableName> = z.infer<(typeof records)[T]>;
export const tableNames = Object.keys(records) as TableName[];
export type DiaryNote = Row<"journal_entries">;
export type MealItem = Row<"meal_items">;
export type Drink = Row<"drinks">;
export type SupplementProduct = Row<"supplement_products">;
export type SupplementLog = Row<"supplement_logs">;
export type Job = Row<"processing_queue">;
export type Period = z.infer<typeof period>;
