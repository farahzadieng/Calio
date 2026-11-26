import type { CalioDatabase } from "../../src/db/database";
import { tableNames } from "../../src/db/records";
import { saveProfile } from "../../src/services/tracking";

export const backupFormatForTest = tableNames;

export function addSyntheticProfile(db: CalioDatabase) {
  return saveProfile(
    db,
    {
      firstName: "نمونه",
      age: 30,
      heightCm: 170,
      weightKg: 70,
      activity: "light",
      goal: "understand",
      physiology: "female",
      useWellnessEstimates: true,
    },
    {
      locale: "fa",
      calendar: "persian",
      timeZone: "Asia/Tehran",
      theme: "system",
      reduceMotion: false,
      aiConsentAt: null,
      healthShortcutName: null,
    },
    "2026-11-01",
    new Date("2026-11-01T10:00:00Z"),
  );
}
