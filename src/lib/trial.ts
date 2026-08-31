const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function daysUntil(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const diff = startOfUtcDay(date) - startOfUtcDay(now);
  if (diff <= 0) return 0;
  return Math.round(diff / DAY_MS);
}
