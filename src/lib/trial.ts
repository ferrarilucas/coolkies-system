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

export type TrialState = { kind: "running"; daysLeft: number } | { kind: "expired" };

export function trialState(
  status: string,
  trialEndsAt: Date | null,
  now: Date = new Date(),
): TrialState | null {
  if (status !== "TRIALING" || trialEndsAt === null) return null;
  if (trialEndsAt.getTime() <= now.getTime()) return { kind: "expired" };
  return { kind: "running", daysLeft: daysUntil(trialEndsAt, now) ?? 0 };
}

export function isTrialExpired(
  status: string,
  trialEndsAt: Date | null,
  now: Date = new Date(),
): boolean {
  return trialState(status, trialEndsAt, now)?.kind === "expired";
}
