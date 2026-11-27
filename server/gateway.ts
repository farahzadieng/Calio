import { readFile } from "node:fs/promises";
import { z } from "zod";
import { defaultAiProvider } from "../src/ai/configuration";
import { calorieSearchModel } from "../src/domain/calorie-lookup";
import {
  providerCall,
  type SearchConnector,
  type ProviderResult,
} from "../src/ai/provider";
import {
  AiFailure,
  inputSchemas,
  operations,
  type Operation,
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
const maximumBodyBytes = 768 * 1024;
const timeoutMs = 23_000;

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

export function createGateway(config: GatewayConfig) {
  // Deduplicate in-flight work without retaining user outputs in server storage.
  const inProgress = new Map<
    string,
    { hash: string; request: Promise<ProviderResult> }
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
          { ...config, prompt: trustedPrompt },
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
