import {
  alignedWeekStart,
  calendarMonth,
} from "../../src/domain/calendar-periods";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import monthly from "../../fixtures/monthly-input.json";
import research from "../../fixtures/research-output.json";
import {
  dateInTimeZone,
  formatDate,
  normalizeDigits,
  parseDecimal,
  shiftDate,
} from "../../src/domain/dates";
import {
  HealthParseError,
  parseHealthText,
  healthDayFromRow,
  measuredExpenditure,
} from "../../src/domain/health";
import { compareWeight, dailyInsight } from "../../src/domain/insights";
import { estimateEnergy, profileSchema } from "../../src/domain/profile";
import {
  nutrientKeys,
  recipeReference,
  scaleReference,
  sodiumToSalt,
  summarizeNutrients,
  unknownNutrients,
} from "../../src/domain/nutrition";
import { completedWeeks } from "../../src/domain/periods";
import { resolveAmount } from "../../src/domain/library";

const valid = readFileSync(
  new URL("../../fixtures/health-valid.txt", import.meta.url),
  "utf8",
);
const invalid = readFileSync(
  new URL("../../fixtures/health-invalid.txt", import.meta.url),
  "utf8",
);

describe("date, locale and profile", () => {
  it("preserves diary dates independently of calendars and time zones", () => {
    expect(normalizeDigits("۱۲٣٤۵")).toBe("12345");
    expect(parseDecimal("۱۲٫۵")).toBe(12.5);
    expect(parseDecimal("۱۲٫")).toBe(12);
    expect(parseDecimal("1e100")).toBeNull();
    expect(
      dateInTimeZone(new Date("2026-11-26T21:00:00Z"), "Asia/Tehran"),
    ).toBe("2026-11-27");
    expect(
      dateInTimeZone(new Date("2026-11-01T04:30:00Z"), "America/New_York"),
    ).toBe("2026-11-01");
    expect(
      dateInTimeZone(new Date("2026-11-01T03:30:00Z"), "America/New_York"),
    ).toBe("2026-10-31");
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDate("2024-02-29", 1)).toBe("2024-03-01");
    expect(formatDate("2024-03-20", "en", "persian")).toMatch(
      /Farvardin.*1403/,
    );
    expect(formatDate("2024-03-20", "fa", "persian")).toContain("فروردین");
    expect(formatDate("2024-03-20", "en", "gregory")).toContain("March");
    expect(formatDate("2024-03-20", "fa", "gregory")).toContain("مارس");
  });

  it("computes the documented estimate only for an eligible adult reference", () => {
    const base = profileSchema.parse({
      id: "profile",
      firstName: "Fixture",
      age: 30,
      heightCm: 170,
      weightKg: 70,
      activity: "light",
      goal: "understand",
      physiology: "female",
      useWellnessEstimates: true,
      createdAt: "2026-11-10T00:00:00Z",
      updatedAt: "2026-11-10T00:00:00Z",
    });
    expect(estimateEnergy(base)).toMatchObject({
      restingKcal: 1451.5,
      dailyKcal: 1995.8125,
    });
    expect(estimateEnergy({ ...base, physiology: null })).toBeNull();
    expect(estimateEnergy({ ...base, useWellnessEstimates: false })).toBeNull();
    expect(profileSchema.safeParse({ ...base, age: 17 }).success).toBe(false);
  });
});

describe("Health", () => {
  it("preserves valid zero steps and flags suspect or current-day energy", () => {
    const rows = parseHealthText(valid.replaceAll("\n", "\r\n"));
    expect(rows).toHaveLength(3);
    const assignment = {
      importedAt: "2026-11-03T12:00:00Z",
      importId: crypto.randomUUID(),
      today: "2026-11-03",
      minimumRestingKcal: 300,
    };
    const [a, b, c] = rows.map((row) => healthDayFromRow(row, assignment));
    expect(measuredExpenditure(a)).toBe(1800);
    expect(b?.restingKcal).toMatchObject({ value: 0, status: "suspicious" });
    expect(measuredExpenditure(b)).toBeNull();
    expect(c?.restingKcal.status).toBe("partial");
    expect(measuredExpenditure(c)).toBeNull();
    const row = rows[0]!;
    expect(
      healthDayFromRow({ ...row, steps: 0, distanceKm: 0 }, assignment).steps,
    ).toMatchObject({ value: 0, status: "valid" });
  });

  it.each([
    invalid,
    valid + " \nUnknown:{1}",
    valid.replace("5000", "5.25"),
    valid.replace("5000", "-5"),
    valid.replace("1500", "Infinity"),
    valid.replace("1500", "NaN"),
    valid.replace("2026-11-02", "2026-11-01"),
    valid.replace("2026-11-02", "2026-02-29"),
    valid.replace("Active_Energy", "Resting_Energy"),
    valid.replace("Steps:", "Steps="),
    valid.replace("1500", ""),
  ])("rejects malformed Health payload %#", (source) => {
    expect(() => parseHealthText(source)).toThrow(HealthParseError);
  });

  it("only accepts a missing token through explicit configuration", () => {
    const source = valid.replace("1500", "MISSING");
    expect(() => parseHealthText(source)).toThrow(HealthParseError);
    expect(parseHealthText(source, "MISSING")[0]?.restingKcal).toBeNull();
  });
});

describe("nutrition", () => {
  it("scales all 39 keys, preserves true zero and uses matched units", () => {
    expect(Object.keys(unknownNutrients())).toHaveLength(39);
    expect(new Set(nutrientKeys)).toHaveLength(39);
    const nutrients = {
      ...research.nutrients,
      added_sugar_g: undefined,
      dietary_sugar_g: 0,
    };
    const scaled = scaleReference(nutrients, "per_100g", {
      grams: 60,
      ml: null,
    });
    expect(scaled).toMatchObject({
      energy_kcal: 150,
      dietary_sugar_g: 0,
      sodium_mg: 270,
      vitamin_c_mg: null,
    });
    expect(Object.keys(scaled)).toHaveLength(39);
    expect(sodiumToSalt(scaled.sodium_mg)).toBeCloseTo(0.675);
    expect(summarizeNutrients([unknownNutrients(), scaled])).toMatchObject({
      totals: { energy_kcal: 150, dietary_sugar_g: 0, vitamin_c_mg: null },
      knownItemCounts: { energy_kcal: 1, dietary_sugar_g: 1, vitamin_c_mg: 0 },
      itemCount: 2,
    });
    expect(
      scaleReference(nutrients, "per_100ml", { grams: 60, ml: null })
        .energy_kcal,
    ).toBeNull();
    expect(
      scaleReference(nutrients, "per_100ml", { grams: null, ml: 80 })
        .energy_kcal,
    ).toBe(200);
    expect(resolveAmount(1, "glass", null)).toEqual({ grams: null, ml: null });
    expect(resolveAmount(0.5, "کیلوگرم", null)).toEqual({
      grams: 500,
      ml: null,
    });
  });

  it("computes recipe values using edible yield and leaves incomplete fields null", () => {
    const ingredients = [
      {
        amount: { grams: 100, ml: null },
        basis: "per_100g" as const,
        nutrients: research.nutrients,
      },
      {
        amount: { grams: null, ml: 100 },
        basis: "per_100ml" as const,
        nutrients: { ...research.nutrients, sodium_mg: null },
      },
    ];
    expect(recipeReference(ingredients, 250)).toMatchObject({
      energy_kcal: 200,
      sodium_mg: null,
    });
    expect(recipeReference(ingredients, null)).toEqual(unknownNutrients());
  });
});

describe("report arithmetic", () => {
  it("aligns reporting weeks and months with the owner-selected reporting languages", () => {
    expect(alignedWeekStart("2026-11-25", "fa")).toBe("2026-11-21");
    expect(alignedWeekStart("2026-11-25", "en")).toBe("2026-11-23");
    expect(calendarMonth("2024-03-21", "fa")).toMatchObject({
      start: "2024-03-20",
      end: "2024-04-19",
    });
    expect(calendarMonth("2024-03-21", "en", -1)).toMatchObject({
      start: "2024-02-01",
      end: "2024-02-29",
    });
  });

  it("runs only with a completed anchored window and returns missed weeks in order", () => {
    const policy = {
      firstStart: "2026-11-01",
      timeZone: "Asia/Tehran",
      minimumFreshDays: 3,
    };
    expect(completedWeeks(policy, new Date("2026-11-07T20:29:59Z"))).toEqual(
      [],
    );
    expect(
      completedWeeks(policy, new Date("2026-11-07T20:30:00Z")),
    ).toHaveLength(1);
    expect(
      completedWeeks(policy, new Date("2026-11-15T00:00:00Z")).map(
        ({ id, end }) => [id, end],
      ),
    ).toEqual([
      ["2026-11-01", "2026-11-07"],
      ["2026-11-08", "2026-11-14"],
    ]);
  });

  it("calculates signed difference on paired days and respects minimum coverage", () => {
    const blank = dailyInsight({
      date: "2026-11-01",
      noteCount: 0,
      parsedNoteCount: 0,
      meals: [],
      drinks: [],
      supplements: [],
      health: undefined,
    });
    const days = Array.from({ length: monthly.paired_days }, (_, index) => ({
      ...blank,
      date: shiftDate(monthly.period_start, index),
      intake: monthly.intake_kcal / monthly.paired_days,
      expenditure: monthly.expenditure_kcal / monthly.paired_days,
      balance:
        (monthly.intake_kcal - monthly.expenditure_kcal) / monthly.paired_days,
    }));
    const input = {
      days,
      startingKg: 70,
      endingKg: 69.8,
      policy: {
        coefficient: monthly.coefficient,
        minimumPairedDayRatio: 1,
        discrepancyThresholdKg: 0.5,
      },
    };
    const result = compareWeight(input);
    expect(result.estimatedDeltaKg).toBeCloseTo(monthly.expected_delta_kg);
    expect(result.actualDeltaKg).toBeCloseTo(monthly.actual_delta_kg);
    expect(result.discrepancyKg).toBeCloseTo(monthly.discrepancy_kg);
    expect(result.offerPrompt).toBe(true);
    expect(
      compareWeight({ ...input, days: [...days.slice(1), blank] })
        .estimatedDeltaKg,
    ).toBeNull();
    expect(
      compareWeight({ ...input, endingKg: null }).actualDeltaKg,
    ).toBeNull();
  });
});
