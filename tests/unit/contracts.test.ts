import { describe, expect, it } from "vitest";
import extraction from "../../fixtures/extract-output.json";
import extractInput from "../../fixtures/extract-input.json";
import research from "../../fixtures/research-output.json";
import portion from "../../fixtures/portion-output.json";
import weekly from "../../fixtures/weekly-output.json";
import {
  validateExtract,
  validatePortion,
  validateResearch,
  validateWeekly,
  type Input,
} from "../../src/ai/contracts";
import { nutrientKeys } from "../../src/domain/nutrition";

const input = { ...extractInput, locale: "fa" as const };
const researchInput: Input<"research"> = {
  food_name_fa: research.food_name_fa,
  food_name_en: research.food_name_en,
  variant: research.variant,
  preparation: "",
  brand: null,
  requested_nutrient_keys: nutrientKeys,
  known_reference: null,
  locale: "fa",
};
const portionInput: Input<"portion"> = {
  food_name: portion.food_name,
  variant: portion.variant,
  preparation: "",
  unit: portion.unit,
  quantity: 2,
  known_evidence: null,
  locale: "fa",
};
const weekInput: Input<"weekly"> = {
  period_id: weekly.period_id,
  locale: "fa",
  profile_reference: null,
  goal: null,
  local_statistics: null,
  evidence: [{ id: "day", facts: null }],
  food_patterns: null,
  supplement_totals: null,
  reported_symptoms: [],
  coverage: null,
  reference_versions: [],
};

describe("validated AI contracts", () => {
  it("preserves extraction identity, symptoms and the negation fixture", () => {
    const out = validateExtract(extraction, input);
    expect(out.entries[0]?.items).toHaveLength(2);
    expect(out.entries[0]?.symptoms).toHaveLength(1);
    expect(out.entries[1]?.items).toEqual([]);
    expect(() =>
      validateExtract({ ...extraction, extra: true }, input),
    ).toThrow("ai_extract_schema");
    expect(() => validateExtract(JSON.stringify(extraction), input)).toThrow(
      "ai_extract_schema",
    );
    expect(() =>
      validateExtract(
        {
          entries: extraction.entries.map((row) => ({
            ...row,
            entry_id: "wrong",
          })),
        },
        input,
      ),
    ).toThrow("ai_extract_identity");
  });

  it("rejects unsupported computed numbers and dishonest reference IDs in real mode", () => {
    expect(validateResearch(research, researchInput, [], true)).toEqual(
      research,
    );
    expect(() => validateResearch(research, researchInput, [], false)).toThrow(
      "ai_evidence",
    );
    const source = {
      url: "https://example.org/synthetic",
      title: "Fixture",
      accessed_date: "2026-11-01",
      basis: "per_100g",
      tool_evidence_id: "not-fetched",
      nutrient_keys: ["energy_kcal"],
    };
    expect(() =>
      validateResearch(
        { ...research, sources: [source] },
        researchInput,
        [],
        false,
      ),
    ).toThrow("ai_evidence");
    expect(() => validatePortion(portion, portionInput, [], false)).toThrow(
      "ai_evidence",
    );
    expect(validatePortion(portion, portionInput, [], true)).toEqual(portion);
    expect(() =>
      validatePortion({ ...portion, range_high: 25 }, portionInput, [], true),
    ).toThrow("ai_portion_range");
  });

  it("rejects weekly findings with missing or foreign evidence", () => {
    expect(validateWeekly(weekly, weekInput)).toEqual(weekly);
    expect(() =>
      validateWeekly({ ...weekly, period_id: "foreign" }, weekInput),
    ).toThrow("ai_weekly_schema");
    expect(() =>
      validateWeekly(
        { ...weekly, strengths: [{ finding: "test", evidence_ids: [] }] },
        weekInput,
      ),
    ).toThrow("ai_weekly_evidence");
    expect(() =>
      validateWeekly(
        {
          ...weekly,
          actions: [
            {
              suggestion: "test",
              rationale: "test",
              evidence_ids: ["foreign"],
            },
          ],
        },
        weekInput,
      ),
    ).toThrow("ai_weekly_evidence");
  });
});
