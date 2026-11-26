import { readFile } from "node:fs/promises";
import { z } from "zod";
import { defaultAiProvider } from "../src/ai/configuration";
import {
  automaticCaloriePrompt,
  calorieSearchModel,
  citationUrl,
  parseCalorieAnswer,
  type CalorieTarget,
} from "../src/domain/calorie-lookup";
import {
  AiFailure,
  inputSchemas,
  operations,
  validateExtract,
  validatePortion,
  validateResearch,
  validateWeekly,
  type Input,
  type Operation,
  type ToolEvidence,
} from "../src/ai/contracts";

const files: Record<Exclude<Operation, "calories">, string> = {
  extract: "01-extract.md",
  portion: "02-portion.md",
  research: "03-food-research.md",
  weekly: "04-weekly-report.md",
};
const requestSchema = z.strictObject({
  operation: z.enum(operations),
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  idempotencyKey: z.string().regex(/^[a-f\d]{64}$/),
  input: z.unknown(),
});
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

const maximumBodyBytes = 768 * 1024;
const timeoutMs = 23_000;

type SearchResult = {
  evidence: ToolEvidence[];
  records: z.infer<ReturnType<typeof z.json>>;
};
type SearchConnector = (
  operation: "research" | "portion",
  input: Input<"research"> | Input<"portion">,
  signal: AbortSignal,
) => Promise<SearchResult>;
type Result = {
  output: unknown;
  evidence: ToolEvidence[];
  usage: { inputTokens: number | null; outputTokens: number | null };
};
export type GatewayConfig = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  calorieModel?: string;
  allowedOrigin: string;
  authenticate: (request: Request) => boolean | Promise<boolean>;
  fetchProvider?: typeof fetch;
  search?: SearchConnector;
};

function reply(
  status: number,
  data: unknown,
  additionalHeaders?: Record<string, string>,
) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
  });
}

async function parseBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new AiFailure("gateway_payload");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let raw = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBodyBytes) {
        await reader.cancel();
        throw new AiFailure("gateway_size");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return requestSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof AiFailure) throw error;
    throw new AiFailure("gateway_payload");
  } finally {
    reader.releaseLock();
  }
}

async function trustedPrompt(operation: Exclude<Operation, "calories">) {
  const root = new URL("../", import.meta.url);
  const [prompt, schema] = await Promise.all([
    readFile(new URL(`prompts/${files[operation]}`, root), "utf8"),
    readFile(new URL(`schemas/${operation}.schema.json`, root), "utf8"),
  ]);
  return `${prompt}\nExact response schema:\n${schema}`;
}

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
  input: CalorieTarget,
  annotations: unknown,
) {
  let output;
  try {
    output = parseCalorieAnswer(raw, input);
  } catch {
    throw new AiFailure("ai_calories_schema");
  }
  if (output.status === "unknown") return { output, evidence: [] };
  const url = citationUrl(output.source.url);
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
  if (!cited) throw new AiFailure("ai_evidence");
  const evidence: ToolEvidence[] = [
    {
      id: "sonar-1",
      url,
      title: output.source.title,
      accessedDate: new Date().toISOString().slice(0, 10),
      basis: input.basis,
      supportedNutrients: ["energy_kcal"],
      supportsPortion: false,
      supportsAddedSugar: false,
      supportsRecipeYield: false,
    },
  ];
  return { output: { ...output, source: { ...output.source, url } }, evidence };
}

async function providerCall(
  config: GatewayConfig,
  operation: Operation,
  input: Input<Operation>,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<Result> {
  const prompt =
    operation === "calories"
      ? automaticCaloriePrompt(input as Input<"calories">)
      : await trustedPrompt(operation);
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
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        model:
          operation === "calories"
            ? (config.calorieModel ?? calorieSearchModel)
            : (config.model ?? defaultAiProvider.model),
        stream: false,
        ...(operation === "calories" ? { max_tokens: 240 } : {}),
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
  if (!response.ok)
    throw new AiFailure("provider_status", response.status >= 500);
  let raw: unknown;
  let annotations: unknown;
  let usage: Result["usage"];
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

export function createGateway(config: GatewayConfig) {
  // Deduplicate in-flight work without retaining user outputs in server storage.
  const inProgress = new Map<
    string,
    { hash: string; request: Promise<Result> }
  >();
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return reply(405, { error: "gateway_method" }, { Allow: "POST" });
    if (
      request.headers.get("Origin") !== config.allowedOrigin ||
      !(await config.authenticate(request))
    ) {
      return reply(403, { error: "gateway_auth" });
    }
    if (!config.apiKey) return reply(503, { error: "gateway_unconfigured" });
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("Content-Type") ?? "",
      )
    ) {
      return reply(415, { error: "gateway_content_type" });
    }
    try {
      const body = await parseBody(request.body);
      const input = inputSchemas[body.operation].safeParse(body.input);
      if (!input.success) return reply(400, { error: "gateway_input" });
      const key = `${body.operation}:${body.idempotencyKey}`;
      const canonicalInput = JSON.stringify(input.data);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalInput),
      );
      const hash = Buffer.from(digest).toString("hex");
      const previous = inProgress.get(key);
      if (previous && previous.hash !== hash)
        return reply(409, { error: "gateway_idempotency" });
      const running =
        previous?.request ??
        providerCall(
          config,
          body.operation,
          input.data,
          body.idempotencyKey,
          AbortSignal.timeout(timeoutMs),
        ).finally(() => inProgress.delete(key));
      if (!previous) inProgress.set(key, { hash, request: running });
      const result = await running;
      return reply(200, {
        ...result,
        requestId: body.requestId,
        model:
          body.operation === "calories"
            ? (config.calorieModel ?? calorieSearchModel)
            : (config.model ?? defaultAiProvider.model),
        provider: new URL(config.baseUrl ?? defaultAiProvider.baseUrl).hostname,
      });
    } catch (error) {
      const failure =
        error instanceof AiFailure ? error : new AiFailure("gateway_error");
      if (failure.code === "gateway_size")
        return reply(413, { error: failure.code });
      if (
        failure.code === "gateway_payload" ||
        failure.code === "gateway_search_input"
      )
        return reply(400, { error: failure.code });
      if (failure.code === "ai_search_unavailable")
        return reply(501, { error: failure.code });
      if (failure.code === "provider_rate")
        return reply(
          429,
          { error: failure.code },
          failure.retryAfterMs
            ? { "Retry-After": String(Math.ceil(failure.retryAfterMs / 1000)) }
            : undefined,
        );
      return reply(failure.retryable ? 502 : 422, { error: failure.code });
    }
  };
}
