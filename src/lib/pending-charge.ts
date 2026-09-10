const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isPendingChargeWarningActive(dueAt: Date, now: Date = new Date()): boolean {
  return now.getTime() < dueAt.getTime() + MS_PER_DAY;
}
