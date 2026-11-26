import type { Period } from "../db/records";
import {
  dateDistance,
  dateInTimeZone,
  localDate,
  shiftDate,
  timeZoneSchema,
} from "./dates";

export type WeeklyPolicy = {
  firstStart: string;
  timeZone: string;
  minimumFreshDays: number;
  maxSyncAgeMs?: number;
};

export function completedWeeks(policy: WeeklyPolicy, now: Date): Period[] {
  const start = localDate.parse(policy.firstStart);
  const today = dateInTimeZone(now, timeZoneSchema.parse(policy.timeZone));
  const count = Math.max(0, Math.floor(dateDistance(start, today) / 7));
  return Array.from({ length: count }, (_, index) => {
    const periodStart = shiftDate(start, 7 * index);
    return {
      id: periodStart,
      start: periodStart,
      end: shiftDate(periodStart, 6),
    };
  });
}

export function periodDates(period: Pick<Period, "start" | "end">): string[] {
  const size = dateDistance(period.start, period.end) + 1;
  if (size < 1 || size > 366) throw new RangeError("period_range");
  return Array.from({ length: size }, (_, index) =>
    shiftDate(period.start, index),
  );
}
