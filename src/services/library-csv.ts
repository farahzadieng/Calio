import Papa from "papaparse";
import { z } from "zod";
import type { CalioDatabase } from "../db/database";
import {
  aliasSchema,
  foodEvidenceSchema,
  foodSchema,
  portionSchema,
  type Food,
} from "../domain/library";
import { nutrientKeys, nutrientValuesSchema } from "../domain/nutrition";
import {
  BackupError,
  libraryFormat,
  previewRestore,
  serializeLibrary,
} from "./backup";

const csvHeaders = [
  "food_id",
  "name_fa",
  "name_en",
  "variant",
  "preparation",
  "brand",
  "basis",
  ...nutrientKeys,
  "added_sugar_g",
  "evidence_json",
  "confidence",
  "version",
];

const metadataSchema = z.strictObject({
  type: z.literal("calio.csv.evidence.v1"),
  mode: z.enum(["real", "demo"]),
  evidence: z.array(foodEvidenceSchema),
  aliases: z.array(aliasSchema),
  portions: z.array(portionSchema),
  assumptions: z.array(z.string()),
});

function protect(value: string) {
  return /^[\t\r\n'=+@-]|^\s+[=+@-]/.test(value) ? `'${value}` : value;
}

function readNumber(value: string) {
  if (value === "") return null;
  if (!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))
    throw new BackupError("csv_number");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new BackupError("csv_number");
  return parsed;
}

export async function exportLibraryCsv(db: CalioDatabase): Promise<string> {
  const rows = await db.transaction(
    "r",
    [db.foods, db.aliases, db.portions],
    async () => {
      const [foods, aliases, portions] = await Promise.all([
        db.foods.toArray(),
        db.aliases.toArray(),
        db.portions.toArray(),
      ]);
      return foods.map((food) => {
        const metadata = JSON.stringify(
          metadataSchema.parse({
            type: "calio.csv.evidence.v1",
            mode: db.mode,
            evidence: food.evidence,
            aliases: aliases.filter(({ foodId }) => foodId === food.id),
            portions: portions.filter(({ foodId }) => foodId === food.id),
            assumptions: food.assumptions,
          }),
        );
        return [
          food.id,
          food.nameFa,
          food.nameEn,
          food.variant,
          food.preparation,
          food.brand,
          food.basis,
          ...nutrientKeys.map((key) => food.nutrients[key]),
          food.addedSugarG,
          metadata,
          food.confidence,
          food.version,
        ].map((value) => (typeof value === "string" ? protect(value) : value));
      });
    },
  );
  return "\ufeff" + Papa.unparse([csvHeaders, ...rows]);
}

export async function previewLibraryCsv(
  db: CalioDatabase,
  source: string,
  method: "merge" | "replace",
) {
  if (source.length > 32 * 1024 * 1024) throw new BackupError("backup_size");
  const parsed = Papa.parse<string[]>(source.replace(/^\ufeff/, ""), {
    skipEmptyLines: true,
  });
  const [header, ...rows] = parsed.data;
  if (
    parsed.errors.length ||
    !header ||
    header.length !== csvHeaders.length ||
    new Set(header).size !== csvHeaders.length ||
    !csvHeaders.every((value) => header.includes(value))
  ) {
    throw new BackupError("csv_header");
  }
  const data: Parameters<typeof serializeLibrary>[1] = {
    foods: [],
    aliases: [],
    portions: [],
  };
  for (const row of rows) {
    if (row.length !== header.length) throw new BackupError("csv_columns");
    const read = (name: string) => row[header.indexOf(name)] ?? "";
    const evidenceJson = read("evidence_json");
    let metadata: unknown = [];
    try {
      if (evidenceJson) metadata = JSON.parse(evidenceJson);
    } catch {
      throw new BackupError("csv_evidence");
    }
    const exported = metadataSchema.safeParse(metadata);
    if (exported.success && exported.data.mode !== db.mode)
      throw new BackupError("backup_mode");
    const readText = (name: string) => {
      const raw = read(name);
      return exported.success && raw.startsWith("'") ? raw.slice(1) : raw;
    };
    const nutrients = nutrientValuesSchema.parse(
      Object.fromEntries(
        nutrientKeys.map((key) => [key, readNumber(read(key))]),
      ),
    );
    const evidence = exported.success
      ? exported.data.evidence
      : z.array(foodEvidenceSchema).parse(metadata);
    const food: Food = foodSchema.parse({
      id: read("food_id"),
      nameFa: readText("name_fa"),
      nameEn: readText("name_en"),
      variant: readText("variant"),
      preparation: readText("preparation"),
      brand: readText("brand") || null,
      basis: read("basis"),
      nutrients,
      addedSugarG: readNumber(read("added_sugar_g")),
      confidence: read("confidence"),
      version: readNumber(read("version")),
      evidence,
      assumptions: exported.success ? exported.data.assumptions : [],
    });
    data.foods.push(food);
    if (exported.success) {
      data.aliases.push(...exported.data.aliases);
      data.portions.push(...exported.data.portions);
    }
  }
  return previewRestore(
    db,
    serializeLibrary(db.mode, data),
    libraryFormat,
    method,
  );
}
