import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import fixture from "../../fixtures/extract-input.json";
import research from "../../fixtures/research-output.json";
import { readAiSettings, saveAiSettings } from "../../src/ai/browser";
import { DemoTransport } from "../../src/ai/demo";
import { type AiTransport } from "../../src/ai/contracts";
import { CalioDatabase } from "../../src/db/database";
import { backupFormatForTest, addSyntheticProfile } from "./synthetic";
import {
  exportBackup,
  fullFormat,
  libraryFormat,
  previewRestore,
} from "../../src/services/backup";
import { importHealthText } from "../../src/services/health-import";
import {
  exportLibraryCsv,
  previewLibraryCsv,
} from "../../src/services/library-csv";
import { processNotes } from "../../src/services/food-processing";
import { deleteNote, persistDraft, saveNote } from "../../src/services/journal";
import { processForegroundWeeks } from "../../src/services/weekly";
import { prepareMonthlyConsultation } from "../../src/services/monthly";
import { periodSnapshot } from "../../src/services/insights";
import {
  saveDrink,
  saveSupplementLog,
  saveSupplementProduct,
  saveSupplementWithServing,
} from "../../src/services/tracking";
import {
  recordDiagnostic,
  redactedDiagnostics,
  testMessage,
} from "../../src/services/diagnostics";
import { measuredExpenditure } from "../../src/domain/health";

let demo: CalioDatabase;
let real: CalioDatabase;
let secondary: CalioDatabase;
const today = new Date("2026-11-08T14:00:00Z");
const validHealth = readFileSync(
  new URL("../../fixtures/health-valid.txt", import.meta.url),
  "utf8",
);
const invalidHealth = readFileSync(
  new URL("../../fixtures/health-invalid.txt", import.meta.url),
  "utf8",
);
const healthPolicy = {
  timeZone: "Asia/Tehran",
  minimumRestingKcal: 300,
  missingToken: null,
};
const weekPolicy = {
  firstStart: "2026-11-01",
  timeZone: "Asia/Tehran",
  minimumFreshDays: 2,
};
const period = { id: "2026-11-01", start: "2026-11-01", end: "2026-11-07" };
const foreground = {
  visible: true,
  online: true,
  locale: "fa" as const,
  now: today,
  policy: weekPolicy,
};

beforeEach(() => {
  demo = new CalioDatabase("demo");
  real = new CalioDatabase("real");
  secondary = new CalioDatabase("demo");
});

afterEach(async () => {
  secondary.close();
  await Promise.all([demo.delete(), real.delete()]);
});

function addFixtureNotes(db: CalioDatabase) {
  return Promise.all(
    fixture.entries.map((input) =>
      saveNote(
        db,
        { localDate: input.local_date, text: input.text, time: null },
        undefined,
        today,
      ),
    ),
  );
}

it("stores the real API key separately from backups and requires a new key for a new provider", async () => {
  await addSyntheticProfile(real);
  const config = {
    baseUrl: "https://provider.example/v1",
    model: "synthetic/analysis",
    calorieModel: "synthetic/search",
  };
  const key = "synthetic-device-only";
  await saveAiSettings(real, { ...config, apiKey: key });
  expect(await readAiSettings(real)).toEqual(config);
  const backup = JSON.stringify(await exportBackup(real, fullFormat));
  expect(backup).not.toContain(key);
  expect(backup).not.toContain("ai_connection");
  await real.settings.update("settings", { aiConsentAt: today.toISOString() });
  await saveAiSettings(real, { ...config, model: "synthetic/replacement" });
  expect((await real.ai_connection.get("connection"))?.apiKey).toBe(key);
  expect((await real.settings.get("settings"))?.aiConsentAt).toBe(
    today.toISOString(),
  );
  const newProvider = { ...config, baseUrl: "https://second.example/v1" };
  await expect(saveAiSettings(real, newProvider)).rejects.toThrow(
    "ai_key_required",
  );
  expect((await real.settings.get("settings"))?.aiConsentAt).toBe(
    today.toISOString(),
  );
  await saveAiSettings(real, { ...newProvider, apiKey: "synthetic-other" });
  expect((await real.settings.get("settings"))?.aiConsentAt).toBeNull();
  await expect(
    saveAiSettings(demo, { ...config, apiKey: key }),
  ).rejects.toThrow("ai_mode_mismatch");
});

describe("local profile and journal", () => {
  it("opens empty namespaces and keeps a Persian draft over reload and optimistic edits", async () => {
    expect(await real.foods.count()).toBe(0);
    const profile = await addSyntheticProfile(demo);
    expect(profile.firstName).toBe("نمونه");
    expect(await demo.weight_logs.count()).toBe(1);
    expect(await real.profile.count()).toBe(0);
    await persistDraft(demo, { localDate: "2026-11-02", text: "چای ۲ لیوان" });
    expect(await secondary.journal_draft.get("journal")).toMatchObject({
      text: "چای ۲ لیوان",
    });
    const note = await saveNote(demo, {
      localDate: "2026-11-02",
      text: "چای ۲ لیوان",
      time: "11:25",
    });
    expect(await secondary.journal_draft.get("journal")).toBeUndefined();
    const edited = await saveNote(
      secondary,
      { localDate: "2026-10-30", text: "چای ۱ لیوان", time: null },
      note,
    );
    expect(edited.revision).toBe(2);
    await expect(saveNote(demo, note, note)).rejects.toThrow(
      "journal_revision_conflict",
    );
    await deleteNote(demo, edited);
    expect(await demo.journal_entries.count()).toBe(0);
    expect(await demo.api_usage.count()).toBe(0);
  });

  it("performs schema and dose validation without mutating the other namespace", async () => {
    const product = await saveSupplementProduct(demo, {
      name: "آزمایشی",
      servingUnit: "قرص",
      labelEvidence: "synthetic-label",
      composition: [{ key: "vitamin_d_ug", amount: 400, unit: "IU" }],
    });
    await saveSupplementLog(demo, {
      localDate: period.start,
      time: null,
      productId: product.id,
      servings: 2,
      matchedMeal: null,
    });
    await saveSupplementLog(demo, {
      localDate: period.end,
      time: null,
      productId: product.id,
      servings: null,
      matchedMeal: null,
    });
    const coffee = await saveDrink(demo, {
      localDate: period.start,
      time: "08:00",
      kind: "coffee",
      title: "قهوه",
      strength: "medium",
      amountMl: 120,
      caffeineMg: null,
      matchedMeal: null,
    });
    await saveDrink(
      demo,
      {
        localDate: period.start,
        time: coffee.time,
        kind: coffee.kind,
        title: coffee.title,
        strength: coffee.strength,
        amountMl: 160,
        caffeineMg: null,
        matchedMeal: null,
      },
      coffee.id,
    );
    await saveDrink(demo, {
      localDate: period.start,
      time: "09:00",
      kind: "water",
      title: "آب",
      amountMl: 200,
      caffeineMg: null,
      strength: null,
      matchedMeal: null,
    });
    await saveSupplementProduct(
      demo,
      {
        name: product.name,
        servingUnit: product.servingUnit,
        labelEvidence: product.labelEvidence,
        composition: [{ key: "vitamin_d_ug", amount: 800, unit: "IU" }],
      },
      product.id,
    );
    const summary = await periodSnapshot(demo, period);
    expect(summary.days[0]).toMatchObject({
      drinkVolumeMl: 360,
      drinks: { knownItemCounts: { caffeine_mg: 1 } },
      supplements: { totals: { vitamin_d_ug: 20 } },
    });
    expect(summary.days.at(-1)?.supplements.totals.vitamin_d_ug).toBeNull();
    expect(await real.supplement_logs.count()).toBe(0);
  });
});

describe("Health imports, food processing and weekly pipeline", () => {
  it("rolls back malformed imports, preserves valid data and handles replay and correction", async () => {
    await expect(
      importHealthText(demo, invalidHealth, healthPolicy, today),
    ).rejects.toThrow("health_length");
    expect(await demo.health_daily.count()).toBe(0);
    await importHealthText(demo, validHealth, healthPolicy, today);
    expect(
      (await importHealthText(secondary, validHealth, healthPolicy, today))
        .duplicate,
    ).toBe(true);
    expect(await demo.health_imports.count()).toBe(1);
    await importHealthText(
      demo,
      validHealth.replace("1500", "0").replace("1550.5", "1650"),
      healthPolicy,
      today,
    );
    expect(measuredExpenditure(await demo.health_daily.get("2026-11-01"))).toBe(
      1800,
    );
    expect(measuredExpenditure(await demo.health_daily.get("2026-11-03"))).toBe(
      1900.25,
    );
    expect(
      measuredExpenditure(await demo.health_daily.get("2026-11-02")),
    ).toBeNull();
    expect(await real.health_daily.count()).toBe(0);
  });

  it("processes mock notes, persists 39 values and blocks crossover and permanent retries", async () => {
    const notes = await addFixtureNotes(demo);
    const mock = new DemoTransport();
    await expect(
      processNotes(real, mock, { locale: "fa", explicit: true, notes }),
    ).rejects.toThrow("ai_mode_mismatch");
    const result = await processNotes(demo, mock, {
      locale: "fa",
      explicit: true,
      notes,
    });
    expect(result.map(({ status }) => status)).toEqual([
      "processed",
      "processed",
    ]);
    expect(await demo.parsed_entries.count()).toBe(2);
    expect(await demo.meal_items.count()).toBe(2);
    expect(
      (
        await demo.meal_items.where("entryId").equals(notes[0]!.id).toArray()
      )[0],
    ).toMatchObject({
      grams: 60,
      nutrients: { energy_kcal: 150, sodium_mg: 270 },
    });
    expect(await demo.ai_reports.count()).toBe(0);
    expect(
      await processNotes(demo, mock, { locale: "fa", explicit: true, notes }),
    ).toEqual([]);
    const note = await saveNote(demo, {
      text: fixture.entries[0]!.text,
      localDate: "2026-11-05",
      time: null,
    });
    const invalid = new DemoTransport("invalid");
    const spy = vi.spyOn(invalid, "request");
    expect(
      (
        await processNotes(demo, invalid, {
          locale: "fa",
          explicit: true,
          notes: [note],
        })
      )[0]?.error,
    ).toBe("ai_extract_schema");
    expect(
      await processNotes(secondary, invalid, {
        locale: "fa",
        explicit: false,
        notes: [note],
      }),
    ).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not charge to research an exact food/portion or fabricate a different variant", async () => {
    const left = {
      id: crypto.randomUUID(),
      nameFa: "سالاد الویه",
      nameEn: "Olivieh",
      variant: "unknown",
      preparation: "unknown",
      basis: "per_100g" as const,
      brand: null,
      nutrients: research.nutrients,
      addedSugarG: null,
      evidence: [],
      assumptions: [],
      confidence: "low" as const,
      version: 1,
    };
    await demo.foods.bulkAdd([
      left,
      { ...left, id: crypto.randomUUID(), variant: "another-variant" },
    ]);
    await demo.portions.add({
      id: crypto.randomUUID(),
      foodId: left.id,
      variant: left.variant,
      unit: "bite",
      gramsPerUnit: 30,
      mlPerUnit: null,
      range: null,
      evidence: [],
      assumptions: [],
      confidence: "low",
      version: 1,
    });
    const mock = new DemoTransport();
    const calls = vi.spyOn(mock, "request");
    await processNotes(demo, mock, {
      locale: "fa",
      explicit: true,
      notes: await addFixtureNotes(demo),
    });
    expect(calls.mock.calls.map(([op]) => op)).toEqual(["extract", "research"]);
    expect(
      (await demo.meal_items.toArray()).find(
        ({ nameEn }) => nameEn === "Olivieh",
      )?.foodId,
    ).toBe(left.id);
  });

  it("waits for fresh coverage, deduplicates across tabs and invalidates an issued report after edit", async () => {
    const notes = await addFixtureNotes(demo);
    const transport = new DemoTransport();
    const spy = vi.spyOn(transport, "request");
    await importHealthText(
      demo,
      validHealth,
      healthPolicy,
      new Date("2026-11-05T00:00:00Z"),
    );
    expect(
      await processForegroundWeeks(demo, transport, {
        ...foreground,
        now: new Date("2026-11-06T01:00:00Z"),
      }),
    ).toEqual([]);
    expect(
      await processForegroundWeeks(demo, transport, {
        ...foreground,
        online: false,
      }),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(
      (await processForegroundWeeks(demo, transport, foreground))[0]?.state,
    ).toBe("awaiting_health");
    expect(await demo.ai_reports.count()).toBe(0);
    await importHealthText(
      demo,
      validHealth.replace("1500", "1501"),
      healthPolicy,
      today,
    );
    await Promise.all([
      processForegroundWeeks(demo, transport, foreground),
      processForegroundWeeks(secondary, transport, foreground),
    ]);
    expect(spy.mock.calls.filter(([name]) => name === "weekly")).toHaveLength(
      1,
    );
    expect((await demo.ai_reports.get(period.id))?.status).toBe("ready");
    expect(
      await demo.messages.where("kind").equals("weekly_ready").count(),
    ).toBe(1);
    await saveNote(
      demo,
      { ...notes[0]!, text: "ویرایش بعد از گزارش" },
      notes[0],
    );
    expect((await demo.ai_reports.get(period.id))?.status).toBe("stale");
    expect(
      await demo.messages.where("kind").equals("weekly_ready").count(),
    ).toBe(0);
    expect(
      (await processForegroundWeeks(demo, transport, foreground))[0]?.state,
    ).toBe("stale");
  });

  it("blocks consent-off requests and leaves retryable failures resumable", async () => {
    const realNotes = await addFixtureNotes(real);
    const forbidden: AiTransport = {
      mode: "real",
      model: "test",
      request: vi.fn(),
    };
    await expect(
      processNotes(real, forbidden, {
        locale: "fa",
        explicit: true,
        notes: realNotes,
      }),
    ).rejects.toThrow("ai_consent_required");
    expect(forbidden.request).not.toHaveBeenCalled();
    const notes = await addFixtureNotes(demo);
    const failed = await processNotes(demo, new DemoTransport("timeout"), {
      locale: "fa",
      explicit: true,
      notes,
    });
    expect(failed.map(({ error }) => error)).toEqual([
      "ai_timeout",
      "ai_timeout",
    ]);
    expect(
      (await demo.processing_queue.toArray()).every(
        ({ stage }) => stage === "retryable",
      ),
    ).toBe(true);
    const resumed = await processNotes(secondary, new DemoTransport(), {
      locale: "fa",
      explicit: true,
      notes,
    });
    expect(resumed.map(({ status }) => status)).toEqual([
      "processed",
      "processed",
    ]);
  });
});

describe("restore, consultation and diagnostics", () => {
  it("previews atomic same-mode backups and prevents corrupted or future merges", async () => {
    await addSyntheticProfile(demo);
    await addFixtureNotes(demo);
    const output = await exportBackup(demo, fullFormat, today);
    const result = JSON.parse(output);
    expect(Object.keys(result.data)).toEqual(backupFormatForTest);
    await expect(
      previewRestore(real, output, fullFormat, "merge"),
    ).rejects.toThrow("backup_mode");
    await expect(
      previewRestore(demo, "{", fullFormat, "merge"),
    ).rejects.toThrow("backup_json");
    await expect(
      previewRestore(
        demo,
        JSON.stringify({ ...result, schemaVersion: 200 }),
        fullFormat,
        "merge",
      ),
    ).rejects.toThrow("backup_header");
    await expect(
      previewRestore(
        demo,
        output.replace('"journal_entries"', '"__proto__"'),
        fullFormat,
        "merge",
      ),
    ).rejects.toThrow("backup_unsafe_key");
    const preview = await previewRestore(demo, output, fullFormat, "replace");
    expect(preview.preRestoreBackup).toContain("calio.full-backup");
    await expect(preview.commit()).rejects.toThrow(
      "backup_replace_confirmation",
    );
    await deleteNote(demo, (await demo.journal_entries.toArray())[0]!);
    await expect(
      preview.commit({ confirmReplace: true, snapshotSaved: true }),
    ).rejects.toThrow("backup_preview_stale");
    await (await previewRestore(demo, output, fullFormat, "merge")).commit();
    expect(await demo.journal_entries.count()).toBe(2);
  });

  it("round-trips the CSV library including formula-safe literal text and evidence metadata", async () => {
    const [note] = await addFixtureNotes(demo);
    await processNotes(demo, new DemoTransport(), {
      explicit: true,
      locale: "fa",
      notes: [note!],
    });
    const original = (await demo.foods.toArray())[0]!;
    await demo.foods.update(original.id, { nameEn: "=demo a,p\nline" });
    const alias = {
      id: crypto.randomUUID(),
      foodId: original.id,
      name: "@alias",
    };
    await demo.aliases.add(alias);
    const csv = await exportLibraryCsv(demo);
    expect(csv).toContain("'=demo a,p");
    await expect(previewLibraryCsv(real, csv, "merge")).rejects.toThrow(
      "backup_mode",
    );
    const json = await exportBackup(demo, libraryFormat, today);
    await demo.transaction(
      "rw",
      [demo.foods, demo.aliases, demo.portions],
      async () => {
        await demo.aliases.clear();
        await demo.portions.clear();
        await demo.foods.clear();
      },
    );
    await (await previewLibraryCsv(demo, csv, "merge")).commit();
    expect(await demo.foods.get(original.id)).toMatchObject({
      nameEn: "=demo a,p\nline",
    });
    expect(await demo.aliases.get(alias.id)).toEqual(alias);
    expect(await demo.portions.count()).toBe(1);
    expect(
      (await previewRestore(demo, json, libraryFormat, "merge")).conflicts,
    ).toEqual([]);
    expect(await demo.journal_entries.count()).toBe(2);
  });

  it("builds a consultation prompt locally with missing data and no first name", async () => {
    await addSyntheticProfile(demo);
    const prepared = await prepareMonthlyConsultation(demo, period, {
      locale: "fa",
      timeZone: "Asia/Tehran",
      includeReferenceDemographics: false,
      policy: {
        coefficient: 7700,
        modelName: "synthetic",
        modelVersion: "fixture-v1",
        caveat: "synthetic only",
        minimumPairedDayRatio: 0.5,
        discrepancyThresholdKg: 0.5,
      },
    });
    expect(prepared.comparison.offerPrompt).toBe(true);
    expect(prepared.payload.estimated_delta_kg).toBeNull();
    expect(prepared.payload.age).toBeNull();
    expect(prepared.prompt).toContain("Respond in Persian");
    expect(prepared.prompt).not.toContain("نمونه");
    expect(await demo.api_usage.count()).toBe(0);
  });

  it("isolates marked test messages and exposes only redacted diagnostics", async () => {
    await expect(testMessage(real, "info")).rejects.toThrow(
      "test_mode_required",
    );
    await testMessage(demo, "info");
    await testMessage(demo, "info");
    await recordDiagnostic(
      demo,
      { code: "ai_invalid", outcome: "failed", test: true },
      today,
    );
    expect(await demo.messages.toArray()).toMatchObject([
      { test: true, kind: "test_message" },
    ]);
    expect(await redactedDiagnostics(demo)).toEqual([
      {
        code: "ai_invalid",
        outcome: "failed",
        test: true,
        createdAt: today.toISOString(),
      },
    ]);
    expect(await real.diagnostics.count()).toBe(0);
  });
});

it("atomically defines and logs a compound supplement, preserving named blends and converting known mass units", async () => {
  const input = {
    name: "Synthetic compound tablet",
    servingUnit: "tablet",
    labelEvidence: "synthetic-label",
    composition: [{ key: "vitamin_c_mg", amount: 0.2, unit: "g" }],
    otherIngredients: [{ name: "B complex blend", amount: 10, unit: "mg" }],
  } as const;
  const product = {
    ...input,
    composition: [...input.composition],
    otherIngredients: [...input.otherIngredients],
  };
  await expect(
    saveSupplementWithServing(demo, product, {
      localDate: "2026-11-04",
      servings: -1,
    }),
  ).rejects.toThrow();
  expect(await demo.supplement_products.count()).toBe(0);
  expect(await demo.supplement_logs.count()).toBe(0);
  const log = await saveSupplementWithServing(
    demo,
    product,
    {
      localDate: "2026-11-04",
      servings: 2,
    },
    today,
  );
  expect(log.productSnapshot.otherIngredients).toEqual(input.otherIngredients);
  expect(await demo.supplement_products.count()).toBe(1);
  expect(await demo.supplement_logs.count()).toBe(1);
  expect(await real.supplement_logs.count()).toBe(0);
  const day = (
    await periodSnapshot(demo, {
      id: "2026-11-04",
      start: "2026-11-04",
      end: "2026-11-04",
    })
  ).days[0];
  expect(day?.supplements.totals).toMatchObject({
    vitamin_c_mg: 400,
    thiamin_b1_mg: null,
  });
  const exported = await exportBackup(demo, fullFormat);
  const backup = JSON.parse(exported);
  expect(
    backup.data.supplement_logs[0].productSnapshot.otherIngredients,
  ).toEqual(input.otherIngredients);
  const restored = new CalioDatabase("demo", "supplement-restore");
  try {
    await (
      await previewRestore(restored, exported, fullFormat, "merge")
    ).commit();
    expect(
      (await restored.supplement_logs.get(log.id))?.productSnapshot
        .otherIngredients,
    ).toEqual(input.otherIngredients);
  } finally {
    await restored.delete();
  }
});
