import {
  AiFailure,
  type AiTransport,
  type Input,
  type Operation,
  type RequestContext,
} from "./contracts";
import {
  aiSettingsSchema,
  type AiSettings,
  type AiSettingsUpdate,
} from "./configuration";

async function restoreLocalSession(signal: AbortSignal) {
  const session = await fetch("/api/calio/ai/session", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "X-Calio-Request": "1" },
    signal,
  });
  return session.status === 204;
}

export async function readAiSettings() {
  const options = {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
    headers: { "X-Calio-Request": "1" },
  } as const;
  let response = await fetch("/api/calio/ai/settings", options);
  if (response.status === 403 && (await restoreLocalSession(options.signal))) {
    response = await fetch("/api/calio/ai/settings", options);
  }
  if (!response.ok) throw new AiFailure("ai_settings_unavailable");
  return aiSettingsSchema.parse(await response.json());
}

export async function saveAiSettings(input: AiSettingsUpdate) {
  const options = {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Calio-Request": "1" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(8000),
  } as const;
  let response = await fetch("/api/calio/ai/settings", options);
  if (response.status === 403 && (await restoreLocalSession(options.signal))) {
    response = await fetch("/api/calio/ai/settings", options);
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new AiFailure(
      failure?.error === "ai_key_required"
        ? failure.error
        : "ai_settings_unavailable",
    );
  }
  return aiSettingsSchema.parse(await response.json());
}

export class GatewayTransport implements AiTransport {
  readonly mode = "real";
  readonly model: string;
  readonly calorieModel: string;

  constructor(private readonly settings: AiSettings) {
    this.model = settings.model;
    this.calorieModel = settings.calorieModel;
  }

  static async connect() {
    if (!navigator.onLine) return null;
    try {
      const settings = await readAiSettings();
      return settings.enabled ? new GatewayTransport(settings) : null;
    } catch {
      return null;
    }
  }

  async request<Name extends Operation>(
    operation: Name,
    input: Input<Name>,
    context: RequestContext,
  ) {
    if (!navigator.onLine) throw new AiFailure("ai_offline", true);
    const response = await fetch("/api/calio/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Calio-Config": this.settings.revision,
      },
      credentials: "same-origin",
      cache: "no-store",
      signal: context.signal,
      body: JSON.stringify({
        operation,
        input,
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
        schemaVersion: 1,
      }),
    });
    if (response.status === 501) throw new AiFailure("ai_search_unavailable");
    if (response.status === 401 || response.status === 403)
      throw new AiFailure("ai_gateway_auth");
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      throw new AiFailure(
        "ai_rate_limit",
        true,
        Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
      );
    }
    if (!response.ok)
      throw new AiFailure("ai_gateway_error", response.status >= 500);
    try {
      return await response.json();
    } catch {
      throw new AiFailure("ai_response_invalid");
    }
  }
}
