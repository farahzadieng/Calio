import { z } from "zod";
import type { Table } from "dexie";
import {
  schemaVersion,
  type CalioDatabase,
  type DatabaseMode,
} from "../db/database";
import { records, tableNames, type Row, type TableName } from "../db/records";
import { timestamp } from "../domain/dates";
import { normalizeFoodText } from "../domain/library";

export const fullFormat = "calio.full-backup";
export const libraryFormat = "calio.food-library";
type Format = typeof fullFormat | typeof libraryFormat;
type Data = { [Name in TableName]?: Row<Name>[] };
type Method = "merge" | "replace";
type RecordRow = Row<TableName>;
type Backup = {
  format: Format;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  mode: DatabaseMode;
  data: Data;
};

const libraryTables = ["foods", "aliases", "portions"] as const;
const maxBackupLength = 32 * 1024 * 1024;
const maxRows = 100_000;
const appVersion = "0.1.0";

const header = z.strictObject({
  format: z.enum([fullFormat, libraryFormat]),
  schemaVersion: z.literal(schemaVersion),
  exportedAt: timestamp,
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  mode: z.enum(["demo", "real"]),
  data: z.record(z.string(), z.unknown()),
});

export class BackupError extends Error {
  constructor(
    readonly code: string,
    readonly table?: TableName,
  ) {
    super(code);
  }
}

function namesFor(format: Format) {
  return format === fullFormat ? tableNames : libraryTables;
}

function rowsFor<Name extends TableName>(data: Data, name: Name): Row<Name>[] {
  return data[name] ?? [];
}

function setRows<Name extends TableName>(
  data: Data,
  name: Name,
  rows: Row<Name>[],
) {
  Object.assign(data, { [name]: rows });
}

function tableFor<Name extends TableName>(
  db: CalioDatabase,
  name: Name,
): Table<Row<Name>> {
  return db.table(name);
}

function rowKey(row: RecordRow) {
  if ("id" in row) return row.id;
  if ("itemId" in row)
    return JSON.stringify([row.entryId, row.revision, row.itemId]);
  if ("entryId" in row) return JSON.stringify([row.entryId, row.revision]);
  return row.date;
}

function sameRow(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (
    !first ||
    !second ||
    typeof first !== "object" ||
    typeof second !== "object" ||
    Array.isArray(first) !== Array.isArray(second)
  )
    return false;
  const entries = Object.entries(first);
  return (
    entries.length === Object.keys(second).length &&
    entries.every(
      ([key, value]) =>
        Object.hasOwn(second, key) && sameRow(value, Reflect.get(second, key)),
    )
  );
}

function requiredReference(ok: boolean, table: TableName) {
  if (!ok) throw new BackupError("backup_reference", table);
}

function verifyReferences(data: Data) {
  const foods = new Set(rowsFor(data, "foods").map(({ id }) => id));
  const products = new Set(
    rowsFor(data, "supplement_products").map(({ id }) => id),
  );
  const imports = new Set(rowsFor(data, "health_imports").map(({ id }) => id));
  const entries = new Map(
    rowsFor(data, "journal_entries").map((entry) => [entry.id, entry]),
  );
  const mealItems = rowsFor(data, "meal_items");
  const mealIds = new Map(mealItems.map((item) => [rowKey(item), item]));
  const parsedIds = new Set(rowsFor(data, "parsed_entries").map(rowKey));
  for (const row of rowsFor(data, "aliases"))
    requiredReference(foods.has(row.foodId), "aliases");
  for (const row of rowsFor(data, "portions"))
    requiredReference(foods.has(row.foodId), "portions");
  for (const row of rowsFor(data, "parsed_entries")) {
    const entry = entries.get(row.entryId);
    requiredReference(
      entry?.revision === row.revision && entry.localDate === row.localDate,
      "parsed_entries",
    );
  }
  for (const row of mealItems) {
    const entry = entries.get(row.entryId);
    const hasParsed = parsedIds.has(
      JSON.stringify([row.entryId, row.revision]),
    );
    requiredReference(
      hasParsed &&
        entry?.revision === row.revision &&
        entry.localDate === row.localDate,
      "meal_items",
    );
    // Snapshot IDs survive library deletion by design.
    requiredReference(
      row.foodSnapshot?.id === (row.foodId ?? undefined) &&
        row.portionSnapshot?.id === (row.portionId ?? undefined),
      "meal_items",
    );
  }
  for (const row of rowsFor(data, "supplement_logs")) {
    requiredReference(
      products.has(row.productId) && row.productSnapshot.id === row.productId,
      "supplement_logs",
    );
  }
  for (const row of [
    ...rowsFor(data, "drinks"),
    ...rowsFor(data, "supplement_logs"),
  ]) {
    if (!row.matchedMeal) continue;
    const { entryId, revision, itemId } = row.matchedMeal;
    const meal = mealIds.get(JSON.stringify([entryId, revision, itemId]));
    requiredReference(meal?.localDate === row.localDate, "meal_items");
  }
  for (const row of rowsFor(data, "health_daily")) {
    for (const field of [
      row.restingKcal,
      row.activeKcal,
      row.steps,
      row.distanceKm,
    ]) {
      requiredReference(imports.has(field.importId), "health_daily");
    }
  }
  const unique = (name: TableName, keys: string[]) => {
    if (new Set(keys).size !== keys.length)
      throw new BackupError("backup_duplicate", name);
  };
  unique(
    "portions",
    rowsFor(data, "portions").map(({ foodId, variant, unit }) =>
      JSON.stringify([
        foodId,
        normalizeFoodText(variant),
        normalizeFoodText(unit),
      ]),
    ),
  );
  unique(
    "health_imports",
    rowsFor(data, "health_imports").map(({ fingerprint }) => fingerprint),
  );
}

function validateTextTree(value: unknown) {
  const queue: unknown[] = [value];
  while (queue.length) {
    const node = queue.pop();
    if (
      typeof node === "string" &&
      [0, 8, 11, 12].some((code) => node.includes(String.fromCharCode(code)))
    ) {
      throw new BackupError("backup_unsafe_text");
    }
    if (!node || typeof node !== "object") continue;
    for (const [key, nested] of Object.entries(node)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new BackupError("backup_unsafe_key");
      }
      queue.push(nested);
    }
  }
}

function parseRows<Name extends TableName>(
  data: Data,
  name: Name,
  payload: unknown,
) {
  if (!Array.isArray(payload) || payload.length > maxRows)
    throw new BackupError("backup_rows", name);
  const result = z.array(records[name]).safeParse(payload);
  if (!result.success) throw new BackupError("backup_rows", name);
  const rows = result.data as Row<Name>[];
  const keys = rows.map(rowKey);
  if (new Set(keys).size !== keys.length)
    throw new BackupError("backup_duplicate", name);
  setRows(data, name, rows);
}

function parseBackup(
  source: string,
  format: Format,
  mode: DatabaseMode,
): Backup {
  if (source.length > maxBackupLength) throw new BackupError("backup_size");
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new BackupError("backup_json");
  }
  validateTextTree(raw);
  const validated = header.safeParse(raw);
  if (!validated.success) throw new BackupError("backup_header");
  const parsed = validated.data;
  if (parsed.format !== format) throw new BackupError("backup_format");
  if (parsed.mode !== mode) throw new BackupError("backup_mode");
  const names: readonly TableName[] = namesFor(format);
  if (Object.keys(parsed.data).length !== names.length)
    throw new BackupError("backup_tables");
  const data: Data = {};
  for (const name of names) parseRows(data, name, parsed.data[name]);
  verifyReferences(data);
  return { ...parsed, data };
}

async function snapshot(db: CalioDatabase, names: readonly TableName[]) {
  const data: Data = {};
  await Promise.all(
    names.map(async (name) => {
      setRows(data, name, await tableFor(db, name).toArray());
    }),
  );
  return data;
}

function envelope(
  db: CalioDatabase,
  format: Format,
  data: Data,
  now: Date,
): Backup {
  return {
    format,
    schemaVersion,
    exportedAt: now.toISOString(),
    appVersion,
    mode: db.mode,
    data,
  };
}

export function serializeLibrary(
  mode: DatabaseMode,
  data: Required<Pick<Data, "foods" | "aliases" | "portions">>,
  now = new Date(),
) {
  return JSON.stringify({
    format: libraryFormat,
    schemaVersion,
    exportedAt: now.toISOString(),
    appVersion,
    mode,
    data,
  });
}

export async function exportBackup(
  db: CalioDatabase,
  format: Format,
  now = new Date(),
) {
  const names = namesFor(format);
  return db.transaction(
    "r",
    names.map((name) => tableFor(db, name)),
    async () =>
      JSON.stringify(
        envelope(db, format, await snapshot(db, names), now),
        null,
        2,
      ),
  );
}

function mergedRows<Name extends TableName>(
  name: Name,
  current: Data,
  incoming: Data,
  method: Method,
  conflicts: Set<TableName>,
) {
  if (method === "replace") return rowsFor(incoming, name);
  const indexed = new Map(
    rowsFor(current, name).map((row) => [rowKey(row), row]),
  );
  for (const row of rowsFor(incoming, name)) {
    const key = rowKey(row);
    const existing = indexed.get(key);
    if (!existing) indexed.set(key, row);
    else if (!sameRow(existing, row)) conflicts.add(name);
  }
  return [...indexed.values()];
}

function prepareImport(
  incoming: Backup,
  before: Data,
  method: Method,
  names: readonly TableName[],
) {
  const conflicts = new Set<TableName>();
  const after: Data = {};
  for (const name of names)
    setRows(
      after,
      name,
      mergedRows(name, before, incoming.data, method, conflicts),
    );
  verifyReferences(after);
  if (incoming.format === fullFormat && !sameRow(after, before)) {
    // Imported jobs are evidence of previous work. They require a new explicit request.
    setRows(
      after,
      "processing_queue",
      rowsFor(after, "processing_queue").map((job) => ({
        ...job,
        stage: "stale",
        restored: true,
        leaseOwner: null,
        leaseUntil: null,
        retryAt: null,
      })),
    );
    setRows(
      after,
      "ai_reports",
      rowsFor(after, "ai_reports").map((row) => ({ ...row, status: "stale" })),
    );
    setRows(
      after,
      "messages",
      rowsFor(after, "messages").filter((row) => row.kind !== "weekly_ready"),
    );
    const existingConsent =
      method === "merge"
        ? (rowsFor(before, "settings")[0]?.aiConsentAt ?? null)
        : null;
    setRows(
      after,
      "settings",
      rowsFor(after, "settings").map((row) => ({
        ...row,
        aiConsentAt: existingConsent,
      })),
    );
  }
  return { after, conflicts: [...conflicts] };
}

export async function previewRestore(
  db: CalioDatabase,
  source: string,
  format: Format,
  method: Method,
  now = new Date(),
) {
  const incoming = parseBackup(source, format, db.mode);
  const names = namesFor(format);
  const tables = names.map((name) => tableFor(db, name));
  const before = await db.transaction("r", tables, () => snapshot(db, names));
  const preRestoreBackup =
    method === "replace"
      ? JSON.stringify(envelope(db, format, before, now), null, 2)
      : null;
  const { after, conflicts } = prepareImport(incoming, before, method, names);
  const counts = names.map((name) => ({
    table: name,
    existing: rowsFor(before, name).length,
    imported: rowsFor(incoming.data, name).length,
    result: rowsFor(after, name).length,
  }));
  return {
    conflicts,
    counts,
    preRestoreBackup,
    commit: async (
      options: { confirmReplace?: boolean; snapshotSaved?: boolean } = {},
    ) => {
      if (
        method === "replace" &&
        (!options.confirmReplace || !options.snapshotSaved)
      ) {
        throw new BackupError("backup_replace_confirmation");
      }
      return db.transaction("rw", tables, async () => {
        const current = await snapshot(db, names);
        if (!sameRow(current, before))
          throw new BackupError("backup_preview_stale");
        for (const name of names) {
          if (sameRow(rowsFor(current, name), rowsFor(after, name))) continue;
          await tableFor(db, name).clear();
          await tableFor(db, name).bulkAdd(rowsFor(after, name));
        }
      });
    },
  };
}
