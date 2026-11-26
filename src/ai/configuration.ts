import { z } from "zod";
import { calorieSearchModel } from "../domain/calorie-lookup";

export const defaultAiProvider = {
  baseUrl: "https://iranrouter.net/api/v1",
  model: "openai/gpt-6-luna",
  calorieModel: calorieSearchModel,
};

const baseUrl = z
  .url()
  .max(1000)
  .transform((value) => {
    const url = new URL(value);
    return url.href.replace(/\/+$/, "");
  })
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/\/chat\/completions$/i.test(url.pathname)
    );
  });

const model = z
  .string()
  .trim()
  .min(1)
  .max(250)
  .regex(/^[\w./:+@-]+$/);

export const aiProviderSchema = z.strictObject({
  baseUrl,
  model,
  calorieModel: model,
});

export const aiSettingsSchema = aiProviderSchema.extend({
  hasKey: z.boolean(),
  enabled: z.boolean(),
  revision: z.string().min(1).max(80),
});

export const aiSettingsUpdateSchema = aiProviderSchema.extend({
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[!-~]+$/)
    .optional(),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiSettingsUpdate = z.infer<typeof aiSettingsUpdateSchema>;
