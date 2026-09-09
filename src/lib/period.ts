export type Cycle = "MONTHLY" | "YEARLY";

const MONTHS_IN_YEAR = 12;

export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDayOfTargetMonth),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function advancePeriod(periodEnd: Date, cycle: Cycle): Date {
  return addMonths(periodEnd, cycle === "YEARLY" ? MONTHS_IN_YEAR : 1);
}

export function isPeriodPaid(sub: {
  lastPaidAt: Date | null;
  currentPeriodEnd: Date | null;
  cycle: Cycle;
}): boolean {
  if (sub.lastPaidAt === null || sub.currentPeriodEnd === null) return false;
  const coveredUntil = advancePeriod(sub.lastPaidAt, sub.cycle);
  return sub.currentPeriodEnd <= coveredUntil;
}
