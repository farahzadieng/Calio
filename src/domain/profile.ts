import { calorieLookupModes } from "./calorie-lookup";
import { z } from "zod";
import {
  calendarSchema,
  localeSchema,
  timeZoneSchema,
  timestamp,
} from "./dates";

export const activitySchema = z.enum([
  "sedentary",
  "light",
  "moderate",
  "high",
  "very_high",
]);
export const weightKg = z.number().positive();
export const physiologySchema = z.enum(["female", "male"]).nullable();

export const profileSchema = z.strictObject({
  id: z.literal("profile"),
  firstName: z.string().trim().min(1).max(120),
  age: z.number().int().min(18).max(130),
  heightCm: z.number().positive(),
  weightKg,
  activity: activitySchema,
  goal: z.enum(["understand", "maintain", "lose", "gain"]),
  physiology: physiologySchema,
  useWellnessEstimates: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Profile = z.infer<typeof profileSchema>;

export const settingsSchema = z.strictObject({
  id: z.literal("settings"),
  locale: localeSchema,
  calendar: calendarSchema,
  theme: z.enum(["light", "dark", "system"]),
  timeZone: timeZoneSchema,
  reduceMotion: z.boolean(),
  aiConsentAt: timestamp.nullable(),
  calorieLookupMode: z.enum(calorieLookupModes).optional(),
  healthShortcutName: z.string().min(1).max(256).nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

const activityFactors: Record<Profile["activity"], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};

export function estimateEnergy(profile: Profile) {
  if (!profile.physiology || !profile.useWellnessEstimates) return null;
  const referenceOffset = profile.physiology === "male" ? 5 : -161;
  const restingKcal =
    10 * profile.weightKg +
    6.25 * profile.heightCm -
    5 * profile.age +
    referenceOffset;
  const activityFactor = activityFactors[profile.activity];
  const dailyKcal = restingKcal * activityFactor;
  return Number.isFinite(dailyKcal) && restingKcal > 0
    ? { model: "mifflin-st-jeor-1990", activityFactor, restingKcal, dailyKcal }
    : null;
}
