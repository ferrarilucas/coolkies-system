import { toZonedTime } from "date-fns-tz";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = "America/Sao_Paulo";

function startOfDayInTimeZone(date: Date): number {
  const zoned = toZonedTime(date, TIME_ZONE);
  return Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate());
}

export function daysUntil(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const diff = startOfDayInTimeZone(date) - startOfDayInTimeZone(now);
  if (diff <= 0) return 0;
  return diff / DAY_MS;
}
