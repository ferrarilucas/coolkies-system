import { db } from "@/lib/db";
import type { SubscriptionState } from "@/lib/subscription-confirmation";

export async function getSubscriptionState(userId: string): Promise<SubscriptionState | null> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  if (!sub) return null;
  return {
    status: sub.status,
    provider: sub.provider,
    authorized: sub.authorizedAt !== null,
    plan: sub.plan,
    cycle: sub.cycle,
    nextDueDate: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString().slice(0, 10) : null,
  };
}
