import type { Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveLimit } from "@/lib/plans";

export async function getSubscription(userId: string): Promise<Subscription | null> {
  return db.subscription.findUnique({ where: { userId } });
}

export function isSubscriptionUsable(
  sub: Subscription | null,
  now: Date = new Date(),
): boolean {
  if (!sub) return false;
  if (sub.status === "ACTIVE") return true;
  if (sub.status === "TRIALING") {
    return sub.trialEndsAt === null || sub.trialEndsAt > now;
  }
  if (sub.status === "PAST_DUE") {
    return sub.graceUntil !== null && sub.graceUntil > now;
  }
  return false;
}

export async function activeWorkspaceIds(userId: string): Promise<Set<string>> {
  const [sub, owned] = await Promise.all([
    getSubscription(userId),
    db.member.findMany({
      where: { userId, role: "OWNER" },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    }),
  ]);

  const limit = effectiveLimit(sub?.plan ?? "solo", sub?.status ?? "TRIALING");
  const allowed = owned.slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);
  return new Set(allowed.map((m) => m.workspaceId));
}
