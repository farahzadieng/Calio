import type { CalioDatabase } from "../db/database";
import { calorieSearchModel } from "../domain/calorie-lookup";
import {
  AiFailure,
  inputSchemas,
  responseSchema,
  type AiTransport,
  type Input,
  type Operation,
} from "./contracts";

const timeoutMs = 25_000;

export async function requestAi<Name extends Operation>(
  db: CalioDatabase,
  transport: AiTransport,
  operation: Name,
  input: Input<Name>,
  idempotencyKey: string,
) {
  if (db.mode !== transport.mode) throw new AiFailure("ai_mode_mismatch");
  if (db.mode === "real" && !(await db.settings.get("settings"))?.aiConsentAt) {
    throw new AiFailure("ai_consent_required");
  }
  if (!inputSchemas[operation].safeParse(input).success)
    throw new AiFailure("ai_input_invalid");
  const model =
    operation === "calories"
      ? (transport.calorieModel ?? calorieSearchModel)
      : transport.model;
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const failure = new AiFailure("ai_timeout", true);
        reject(failure);
        controller.abort(failure);
      }, timeoutMs);
    });
    const raw = await Promise.race([
      transport.request(operation, input, {
        idempotencyKey,
        requestId,
        signal: controller.signal,
      }),
      expiry,
    ]);
    const response = responseSchema.safeParse(raw);
    if (
      !response.success ||
      response.data.requestId !== requestId ||
      response.data.model !== model ||
      (response.data.provider === "demo") !== (db.mode === "demo")
    ) {
      throw new AiFailure("ai_response_invalid");
    }
    if (
      db.mode === "real" &&
      !(await db.settings.get("settings"))?.aiConsentAt
    ) {
      throw new AiFailure("ai_consent_required");
    }
    await db.api_usage.add({
      id: crypto.randomUUID(),
      requestId,
      status: "success",
      createdAt: new Date().toISOString(),
      provider: response.data.provider,
      model,
      durationMs: performance.now() - started,
      inputTokens: response.data.usage.inputTokens,
      outputTokens: response.data.usage.outputTokens,
    });
    return response.data;
  } catch (error) {
    const failure =
      error instanceof AiFailure
        ? error
        : new AiFailure("ai_request_failed", true);
    await db.api_usage.add({
      id: crypto.randomUUID(),
      requestId,
      status: "failed",
      createdAt: new Date().toISOString(),
      provider: db.mode === "demo" ? "demo" : "gateway",
      model,
      durationMs: performance.now() - started,
      inputTokens: null,
      outputTokens: null,
    });
    throw failure;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
