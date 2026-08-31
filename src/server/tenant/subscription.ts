import { Prisma } from "@prisma/client";
import type { Subscription, SubscriptionCycle, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveLimit } from "@/lib/plans";

const TRIAL_DAYS = 14;

export async function getSubscription(userId: string): Promise<Subscription | null> {
  return db.subscription.findUnique({ where: { userId } });
}

export type BillingUser = { name: string; email: string };

export async function getBillingUser(userId: string): Promise<BillingUser | null> {
  return db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
}

export async function countOwnedWorkspaces(userId: string): Promise<number> {
  return db.member.count({ where: { userId, role: "OWNER" } });
}

export async function recordAsaasSubscription(input: {
  userId: string;
  plan: string;
  cycle: SubscriptionCycle;
  asaasCustomerId: string;
  asaasSubscriptionId: string;
}): Promise<void> {
  await db.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      plan: input.plan,
      cycle: input.cycle,
      source: "ASAAS",
      status: "TRIALING",
      asaasCustomerId: input.asaasCustomerId,
      asaasSubscriptionId: input.asaasSubscriptionId,
    },
    update: {
      plan: input.plan,
      cycle: input.cycle,
      source: "ASAAS",
      asaasCustomerId: input.asaasCustomerId,
      asaasSubscriptionId: input.asaasSubscriptionId,
    },
  });
}

export async function ensureTrialSubscription(userId: string): Promise<void> {
  const existing = await db.subscription.findUnique({ where: { userId } });
  if (existing) return;

  try {
    await db.subscription.create({
      data: {
        userId,
        plan: "solo",
        source: "ASAAS",
        status: "TRIALING",
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }
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
      orderBy: [{ createdAt: "asc" }, { workspaceId: "asc" }],
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
  trialEndsAt: Date | null;
};

export async function getWorkspacePlanState(workspaceId: string): Promise<WorkspacePlanState> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) return { status: "NONE", isOverLimit: false, trialEndsAt: null };

  const sub = await getSubscription(owner.userId);
  const usable = isSubscriptionUsable(sub);
  const active = await activeWorkspaceIds(owner.userId);

  return {
    status: sub?.status ?? "NONE",
    isOverLimit: usable && !active.has(workspaceId),
    trialEndsAt: sub?.trialEndsAt ?? null,
  };
}
