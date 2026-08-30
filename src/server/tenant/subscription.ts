import type { Subscription, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveLimit } from "@/lib/plans";

const TRIAL_DAYS = 14;

export async function getSubscription(userId: string): Promise<Subscription | null> {
  return db.subscription.findUnique({ where: { userId } });
}

export async function ensureTrialSubscription(userId: string): Promise<void> {
  const existing = await db.subscription.findUnique({ where: { userId } });
  if (existing) return;

  await db.subscription.create({
    data: {
      userId,
      plan: "solo",
      source: "ASAAS",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
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

export async function canWriteInWorkspace(workspaceId: string): Promise<boolean> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) return false;

  const sub = await getSubscription(owner.userId);
  if (!isSubscriptionUsable(sub)) return false;

  const active = await activeWorkspaceIds(owner.userId);
  return active.has(workspaceId);
}

export type WorkspacePlanState = {
  status: SubscriptionStatus | "NONE";
  isOverLimit: boolean;
};

export async function getWorkspacePlanState(workspaceId: string): Promise<WorkspacePlanState> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) return { status: "NONE", isOverLimit: false };

  const sub = await getSubscription(owner.userId);
  const usable = isSubscriptionUsable(sub);
  const active = await activeWorkspaceIds(owner.userId);

  return {
    status: sub?.status ?? "NONE",
    isOverLimit: usable && !active.has(workspaceId),
  };
}
