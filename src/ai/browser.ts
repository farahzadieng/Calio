import extractPrompt from "../../prompts/01-extract.md?raw";
import weeklyPrompt from "../../prompts/04-weekly-report.md?raw";
import extractSchema from "../../schemas/extract.schema.json?raw";
import weeklySchema from "../../schemas/weekly.schema.json?raw";
import type { CalioDatabase } from "../db/database";
import { type AiSettingsUpdate } from "./configuration";
import {
  AiFailure,
  type AiTransport,
  type Input,
  type Operation,
  type RequestContext,
} from "./contracts";
import { providerCall } from "./provider";

export async function readAiSettings(db: CalioDatabase) {
  const record = await db.ai_connection.get("connection");
  if (!record) return null;
  const { baseUrl, model, calorieModel } = record;
  return { baseUrl, model, calorieModel };
}

export async function saveAiSettings(
  db: CalioDatabase,
  input: AiSettingsUpdate,
) {
  if (db.mode !== "real") throw new AiFailure("ai_mode_mismatch");
  return db.transaction("rw", db.ai_connection, db.settings, async () => {
    const previous = await db.ai_connection.get("connection");
    const compatible = previous?.baseUrl === input.baseUrl;
    const apiKey = input.apiKey ?? (compatible ? previous.apiKey : undefined);
    if (!apiKey) throw new AiFailure("ai_key_required");
    const { baseUrl, model, calorieModel } = input;
    await db.ai_connection.put({
      id: "connection",
      baseUrl,
      model,
      calorieModel,
      apiKey,
      revision: crypto.randomUUID(),
    });
    if (!compatible) {
      await db.settings.update("settings", { aiConsentAt: null });
    }
    return { baseUrl, model, calorieModel };
  });
}

export class DirectAiTransport implements AiTransport {
  readonly mode = "real";

  private constructor(
    private readonly db: CalioDatabase,
    readonly model: string,
    readonly calorieModel: string,
    private readonly revision: string,
  ) {}

  static async connect(db: CalioDatabase) {
    if (db.mode !== "real" || !navigator.onLine) return null;
    const record = await db.ai_connection.get("connection");
    return record
      ? new DirectAiTransport(
          db,
          record.model,
          record.calorieModel,
          record.revision,
        )
      : null;
  }

  async request<Name extends Operation>(
    operation: Name,
    input: Input<Name>,
    context: RequestContext,
  ) {
    if (!navigator.onLine) throw new AiFailure("ai_offline", true);
    if (operation === "research" || operation === "portion") {
      throw new AiFailure("ai_search_unavailable");
    }
    const [connection, settings] = await Promise.all([
      this.db.ai_connection.get("connection"),
      this.db.settings.get("settings"),
    ]);
    if (!settings?.aiConsentAt) throw new AiFailure("ai_consent_required");
    if (!connection || connection.revision !== this.revision) {
      throw new AiFailure("ai_configuration_changed", true);
    }
    context.signal.throwIfAborted();
    const result = await providerCall(
      {
        ...connection,
        prompt: (name) =>
          name === "extract"
            ? `${extractPrompt}\nExact response schema:\n${extractSchema}`
            : `${weeklyPrompt}\nExact response schema:\n${weeklySchema}`,
      },
      operation,
      input,
      undefined,
      context.signal,
    );
    return {
      ...result,
      requestId: context.requestId,
      model: operation === "calories" ? this.calorieModel : this.model,
      provider: new URL(connection.baseUrl).hostname,
    };
  }
}
