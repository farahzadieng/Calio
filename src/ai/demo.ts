import extractFixture from "../../fixtures/extract-output.json";
import fixtureInput from "../../fixtures/extract-input.json";
import portionFixture from "../../fixtures/portion-output.json";
import researchFixture from "../../fixtures/research-output.json";
import weeklyFixture from "../../fixtures/weekly-output.json";
import { unknownNutrients } from "../domain/nutrition";
import {
  AiFailure,
  type AiTransport,
  type Input,
  type Operation,
  type RequestContext,
} from "./contracts";

export type DemoFault =
  "offline" | "timeout" | "rate_limit" | "invalid" | "search_unavailable";

export class DemoTransport implements AiTransport {
  readonly mode = "demo";
  readonly model = "synthetic-v1";

  constructor(private readonly fault?: DemoFault) {}

  async request<Name extends Operation>(
    operation: Name,
    input: Input<Name>,
    context: RequestContext,
  ) {
    context.signal.throwIfAborted();
    if (this.fault === "offline") throw new AiFailure("ai_offline", true);
    if (this.fault === "timeout") throw new AiFailure("ai_timeout", true);
    if (this.fault === "rate_limit")
      throw new AiFailure("ai_rate_limit", true, 2000);
    if (
      this.fault === "search_unavailable" &&
      (operation === "research" ||
        operation === "portion" ||
        operation === "calories")
    ) {
      throw new AiFailure("ai_search_unavailable");
    }
    return {
      requestId: context.requestId,
      model: this.model,
      provider: "demo",
      evidence: [],
      usage: { inputTokens: null, outputTokens: null },
      output:
        this.fault === "invalid"
          ? { invalid: true }
          : synthesize(operation, input),
    };
  }
}

function synthesize<Name extends Operation>(
  operation: Name,
  input: Input<Name>,
) {
  switch (operation) {
    case "extract":
      return {
        entries: (input as Input<"extract">).entries.map((row) => {
          const index = fixtureInput.entries.findIndex(
            (fixture) => fixture.text === row.text,
          );
          const extracted = extractFixture.entries[index];
          if (!extracted) throw new AiFailure("demo_fixture_required");
          return {
            ...extracted,
            entry_id: row.entry_id,
            revision: row.revision,
            local_date: row.local_date,
          };
        }),
      };
    case "portion": {
      const { food_name, variant, unit } = input as Input<"portion">;
      const values =
        unit === portionFixture.unit
          ? portionFixture
          : {
              ...portionFixture,
              grams_per_unit: null,
              ml_per_unit: null,
              range_low: null,
              range_high: null,
              range_unit: null,
              status: "unresolved",
            };
      return { ...values, food_name, variant, unit };
    }
    case "research": {
      const { food_name_fa, food_name_en, variant } =
        input as Input<"research">;
      const values =
        food_name_en === "Olivieh"
          ? researchFixture
          : { ...researchFixture, nutrients: unknownNutrients() };
      return { ...values, food_name_fa, food_name_en, variant };
    }
    case "calories":
      throw new AiFailure("demo_fixture_required");
    case "weekly":
      return {
        ...weeklyFixture,
        period_id: (input as Input<"weekly">).period_id,
      };
  }
}
