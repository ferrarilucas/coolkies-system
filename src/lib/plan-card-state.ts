const TERMINAL_STATUSES = new Set(["SUSPENDED", "AUTH_DENIED", "CANCELED"]);

export function isCurrentPlanCard(params: {
  hasSubscriptionId: boolean;
  currentPlan: string | null;
  currentCycle: string | null;
  planId: string;
  cycle: string;
  status: string | null;
  isExpiredThisPlan: boolean;
}): boolean {
  const { hasSubscriptionId, currentPlan, currentCycle, planId, cycle, status, isExpiredThisPlan } =
    params;

  if (!hasSubscriptionId) return false;
  if (currentPlan !== planId || currentCycle !== cycle) return false;
  if (isExpiredThisPlan) return false;
  if (status && TERMINAL_STATUSES.has(status)) return false;
  return true;
}
