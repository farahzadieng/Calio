import { z } from "zod";
import { defaultAiProvider } from "./configuration";
import {
  automaticCaloriePrompt,
  calorieSearchModel,
  citationUrl,
  parseCalorieAnswer,
  type CalorieSearch,
} from "../domain/calorie-lookup";
import {
  AiFailure,
  validateExtract,
  validatePortion,
  validateResearch,
  validateWeekly,
  type Input,
  type Operation,
  type ToolEvidence,
} from "./contracts";

const providerOutput = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
          annotations: z.unknown().optional(),
        }),
      }),
    )
    .min(1),
  citations: z.array(z.string()).optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

type SearchResult = {
  evidence: ToolEvidence[];
  records: z.infer<ReturnType<typeof z.json>>;
};
export type SearchConnector = (
  operation: "research" | "portion",
  input: Input<"research"> | Input<"portion">,
  signal: AbortSignal,
) => Promise<SearchResult>;
export type ProviderResult = {
  output: unknown;
  evidence: ToolEvidence[];
  usage: { inputTokens: number | null; outputTokens: number | null };
};
const searchName = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (name) =>
      !/[\r\n<>@]/.test(name) && !/(?:https?:\/\/|\b\d{8,}\b)/i.test(name),
  );

function validateFoodOnly(
  operation: "research" | "portion",
  input: Input<"research"> | Input<"portion">,
) {
  const names =
    operation === "research"
      ? [
          (input as Input<"research">).food_name_fa,
          (input as Input<"research">).food_name_en,
          (input as Input<"research">).brand,
          input.preparation,
          input.variant,
        ]
      : [
          (input as Input<"portion">).food_name,
          (input as Input<"portion">).unit,
          input.preparation,
          input.variant,
        ];
  if (names.some((name) => name && !searchName.safeParse(name).success))
    throw new AiFailure("gateway_search_input");
}

const annotationUrlSchema = z.object({
  type: z.literal("url_citation"),
  url: z.string().optional(),
  url_citation: z.object({ url: z.string() }).optional(),
});

function validateCalorieCitation(
  raw: unknown,
  input: CalorieSearch,
  annotations: unknown,
) {
  let output;
  try {
    output = parseCalorieAnswer(raw, input);
  } catch {
    throw new AiFailure("ai_calories_schema");
  }
  const sources = [
    ...(output.status === "known"
      ? [{ source: output.source, portion: false }]
      : []),
    ...(input.portionUnit && output.serving
      ? [{ source: output.serving.source, portion: true }]
      : []),
  ];
  const evidence = sources.flatMap<ToolEvidence>(
    ({ source, portion }, index) => {
      const url = citationUrl(source.url);
      const cited =
        Array.isArray(annotations) &&
        annotations.some((annotation: unknown) => {
          const parsed = annotationUrlSchema.safeParse(annotation);
          const annotated = parsed.data?.url_citation?.url ?? parsed.data?.url;
          try {
            return !!annotated && citationUrl(annotated) === url;
          } catch {
            return false;
          }
        });
      if (!cited) return [];
      return [
        {
          id: `sonar-${index + 1}`,
          url,
          title: source.title,
          accessedDate: new Date().toISOString().slice(0, 10),
          basis: input.basis,
          supportedNutrients: ["energy_kcal"],
          supportsPortion: portion,
          supportsAddedSugar: false,
          supportsRecipeYield: false,
        },
      ];
    },
  );
  const serving = evidence.some((entry) => entry.supportsPortion)
    ? output.serving
    : null;
  if (output.status === "known") {
    const density = evidence.find((entry) => !entry.supportsPortion);
    if (density)
      return {
        output: {
          ...output,
          source: { ...output.source, url: density.url },
          ...(input.portionUnit ? { serving } : {}),
        },
        evidence,
      };
    if (!serving) throw new AiFailure("ai_evidence");
    return {
      output: {
        status: "unknown",
        basis: input.basis,
        kcalPer100: null,
        source: null,
        serving,
      },
      evidence,
    };
  }
  return {
    output: input.portionUnit ? { ...output, serving } : output,
    evidence,
  };
}

export async function providerCall(
  config: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    calorieModel?: string;
    fetchProvider?: typeof fetch;
    search?: SearchConnector;
    prompt: (
      operation: Exclude<Operation, "calories">,
    ) => string | Promise<string>;
  },
  operation: Operation,
  input: Input<Operation>,
  idempotencyKey: string | undefined,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const prompt =
    operation === "calories"
      ? automaticCaloriePrompt(input as Input<"calories">)
      : await config.prompt(operation);
  const base = new URL(config.baseUrl ?? defaultAiProvider.baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new AiFailure("gateway_invalid_base_url");
  }
  const endpoint = `${base.href.replace(/\/$/, "")}/chat/completions`;

  let evidence: ToolEvidence[] = [];
  let researchData: SearchResult["records"] = null;
  if (operation === "research" || operation === "portion") {
    if (!config.search) throw new AiFailure("ai_search_unavailable");
    const foodInput = input as Input<"research"> | Input<"portion">;
    validateFoodOnly(operation, foodInput);
    const result = await config.search(operation, foodInput, signal);
    evidence = result.evidence;
    researchData = result.records;
    if (!evidence.length) throw new AiFailure("ai_search_unavailable");
  }
  let response: Response;
  try {
    response = await (config.fetchProvider ?? fetch)(endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        model:
          operation === "calories"
            ? (config.calorieModel ?? calorieSearchModel)
            : (config.model ?? defaultAiProvider.model),
        stream: false,
        ...(operation === "calories"
          ? { max_tokens: (input as Input<"calories">).portionUnit ? 550 : 240 }
          : {}),
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: JSON.stringify(
              researchData === null
                ? input
                : {
                    input,
                    tool_evidence: evidence,
                    tool_records_untrusted: researchData,
                  },
            ),
          },
        ],
      }),
    });
  } catch {
    throw new AiFailure("provider_network", true);
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    throw new AiFailure(
      "provider_rate",
      true,
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : undefined,
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new AiFailure("provider_auth");
  if (!response.ok)
    throw new AiFailure("provider_status", response.status >= 500);
  let raw: unknown;
  let annotations: unknown;
  let usage: ProviderResult["usage"];
  try {
    const parsed = providerOutput.parse(await response.json());
    const message = parsed.choices[0]?.message;
    raw = JSON.parse(message?.content ?? "");
    annotations = [
      ...(Array.isArray(message?.annotations) ? message.annotations : []),
      ...(parsed.citations ?? []).map((url) => ({ type: "url_citation", url })),
    ];
    usage = {
      inputTokens: parsed.usage?.prompt_tokens ?? null,
      outputTokens: parsed.usage?.completion_tokens ?? null,
    };
  } catch {
    throw new AiFailure("provider_json");
  }
  if (operation === "calories") {
    return {
      ...validateCalorieCitation(raw, input as Input<"calories">, annotations),
      usage,
    };
  }
  const validate = {
    extract: () => validateExtract(raw, input as Input<"extract">),
    portion: () =>
      validatePortion(raw, input as Input<"portion">, evidence, false),
    research: () =>
      validateResearch(raw, input as Input<"research">, evidence, false),
    weekly: () => validateWeekly(raw, input as Input<"weekly">),
  };
  return { output: validate[operation](), evidence, usage };
}
