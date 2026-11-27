import Dexie, { type EntityTable } from "dexie";
import type { AiSettingsUpdate } from "../ai/configuration";
import type { Row } from "./records";

export type DatabaseMode = "real" | "demo";
export const databaseNames = Object.freeze({
  real: "calio-real",
  demo: "calio-demo",
});

// Device-only credentials are excluded from the versioned backup format.
type AiConnectionRecord = Omit<AiSettingsUpdate, "apiKey"> & {
  id: "connection";
  apiKey: string;
  revision: string;
};

export class CalioDatabase extends Dexie {
  declare ai_connection: EntityTable<AiConnectionRecord, "id">;
  declare profile: EntityTable<Row<"profile">, "id">;
  declare settings: EntityTable<Row<"settings">, "id">;
  declare journal_entries: EntityTable<Row<"journal_entries">, "id">;
  declare journal_draft: EntityTable<Row<"journal_draft">, "id">;
  declare parsed_entries: Dexie.Table<Row<"parsed_entries">, [string, number]>;
  declare meal_items: Dexie.Table<Row<"meal_items">, [string, number, string]>;
  declare foods: EntityTable<Row<"foods">, "id">;
  declare aliases: EntityTable<Row<"aliases">, "id">;
  declare portions: EntityTable<Row<"portions">, "id">;
  declare drinks: EntityTable<Row<"drinks">, "id">;
  declare supplement_products: EntityTable<Row<"supplement_products">, "id">;
  declare supplement_logs: EntityTable<Row<"supplement_logs">, "id">;
  declare weight_logs: EntityTable<Row<"weight_logs">, "id">;
  declare nutrient_references: EntityTable<Row<"nutrient_references">, "id">;
  declare health_daily: EntityTable<Row<"health_daily">, "date">;
  declare health_imports: EntityTable<Row<"health_imports">, "id">;
  declare processing_queue: EntityTable<Row<"processing_queue">, "id">;
  declare ai_reports: EntityTable<Row<"ai_reports">, "id">;
  declare api_usage: EntityTable<Row<"api_usage">, "id">;
  declare messages: EntityTable<Row<"messages">, "id">;
  declare diagnostics: EntityTable<Row<"diagnostics">, "id">;

  constructor(
    readonly mode: DatabaseMode,
    isolatedDemo?: string,
  ) {
    super(
      isolatedDemo && mode === "demo"
        ? `${databaseNames.demo}-${isolatedDemo}`
        : databaseNames[mode],
    );
    if (
      isolatedDemo &&
      (mode !== "demo" || !/^[a-z0-9-]{1,70}$/.test(isolatedDemo))
    ) {
      throw new Error("calio_invalid_demo_namespace");
    }
    this.version(1).stores({
      profile: "id",
      settings: "id",
      journal_entries: "id,localDate,status",
      journal_draft: "id",
      parsed_entries: "[entryId+revision],entryId,localDate",
      meal_items: "[entryId+revision+itemId],entryId,localDate,foodId",
      foods: "id,nameFa,nameEn",
      aliases: "id,foodId,name",
      portions: "id,foodId,&[foodId+variant+unit]",
      drinks: "id,localDate",
      supplement_products: "id,name",
      supplement_logs: "id,localDate,productId",
      weight_logs: "id,localDate",
      nutrient_references: "id,key",
      health_daily: "date",
      health_imports: "id,&fingerprint,importedAt",
      processing_queue: "id,stage,updatedAt",
      ai_reports: "id,status",
      api_usage: "id,createdAt",
      messages: "id,createdAt,kind",
      diagnostics: "id,createdAt",
    });
    this.version(2).stores({ ai_connection: "id" });
  }
}
