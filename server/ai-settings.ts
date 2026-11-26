import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
  aiProviderSchema,
  aiSettingsUpdateSchema,
  defaultAiProvider,
} from "../src/ai/configuration";
import { z } from "zod";

const savedSchema = aiSettingsUpdateSchema.extend({
  apiKey: aiSettingsUpdateSchema.shape.apiKey.unwrap(),
  revision: z.uuid(),
});
type Saved = z.infer<typeof savedSchema>;

type Initial = {
  baseUrl?: string;
  model?: string;
  calorieModel?: string;
  apiKey: string;
  enabled: boolean;
};

export async function openAiSettings(file: string, initial: Initial) {
  const config = aiProviderSchema.safeParse({
    baseUrl: initial.baseUrl ?? defaultAiProvider.baseUrl,
    model: initial.model ?? defaultAiProvider.model,
    calorieModel: initial.calorieModel ?? defaultAiProvider.calorieModel,
  });
  let current: Saved & { enabled: boolean } = {
    ...(config.success ? config.data : defaultAiProvider),
    apiKey: config.success ? initial.apiKey : "",
    enabled: config.success && initial.enabled && Boolean(initial.apiKey),
    revision: randomUUID(),
  };
  try {
    const saved = savedSchema.parse(JSON.parse(await readFile(file, "utf8")));
    current = { ...saved, enabled: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      current.enabled = false;
    }
  }

  function publicSettings() {
    const { baseUrl, model, calorieModel, apiKey, enabled, revision } = current;
    return {
      baseUrl,
      model,
      calorieModel,
      hasKey: Boolean(apiKey),
      enabled,
      revision,
    };
  }

  let pending = Promise.resolve();
  async function save(input: unknown) {
    const parsed = aiSettingsUpdateSchema.safeParse(input);
    if (!parsed.success) return new Response(null, { status: 400 });
    const previous = pending;
    let release = () => {};
    pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const { baseUrl, model, calorieModel, apiKey } = parsed.data;
      const replacementKey =
        apiKey ?? (baseUrl === current.baseUrl ? current.apiKey : "");
      if (!replacementKey) {
        return Response.json({ error: "ai_key_required" }, { status: 400 });
      }
      const next: Saved = {
        baseUrl,
        model,
        calorieModel,
        apiKey: replacementKey,
        revision: randomUUID(),
      };
      await writeFile(temporary, JSON.stringify(next), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, file);
      current = { ...next, enabled: true };
      return Response.json(publicSettings());
    } catch {
      return Response.json(
        { error: "ai_settings_unavailable" },
        { status: 503 },
      );
    } finally {
      await unlink(temporary).catch(() => {});
      release();
    }
  }

  return { current: () => current, publicSettings, save };
}

export async function readAiSettingsInput(
  body: ReadableStream<Uint8Array> | null,
) {
  if (!body) throw new Error("ai_settings_body");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let raw = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) throw new Error("ai_settings_size");
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
