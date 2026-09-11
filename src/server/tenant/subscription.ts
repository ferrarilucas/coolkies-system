import { Prisma } from "@prisma/client";
import type { Subscription, SubscriptionCycle, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveLimit } from "@/lib/plans";
import { hasPaidAccess } from "@/lib/period";

const TRIAL_DAYS = 14;

export async function getSubscription(userId: string): Promise<Subscription | null> {
  return db.subscription.findUnique({ where: { userId } });
}

export type BillingUser = { name: string; email: string; cpf: string | null };

export async function getBillingUser(userId: string): Promise<BillingUser | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, cpf: true },
  });
}

export async function recordUserCpf(userId: string, cpf: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { cpf } });
}

export async function countOwnedWorkspaces(userId: string): Promise<number> {
  return db.member.count({ where: { userId, role: "OWNER" } });
}

export async function recordPendingChargeWarning(
  userId: string,
  dueAt: Date,
): Promise<void> {
  await db.subscription.updateMany({
    where: { userId },
    data: { pendingChargeDueAt: dueAt },
  });
}

export async function recordInterPixSubscription(input: {
  userId: string;
  plan: string;
  cycle: SubscriptionCycle;
  interpixSubscriptionId: string;
  pixCopyPaste: string | null;
  nextDueDate: Date;
}): Promise<void> {
  const existing = await db.subscription.findUnique({ where: { userId: input.userId } });

  await db.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      plan: input.plan,
      cycle: input.cycle,
      provider: "INTERPIX",
      status: "PENDING_AUTH",
      authorizedAt: null,
      interpixSubscriptionId: input.interpixSubscriptionId,
      interpixPixCopyPaste: input.pixCopyPaste,
      currentPeriodEnd: input.nextDueDate,
    },
    update: {
      plan: input.plan,
      cycle: input.cycle,
      provider: "INTERPIX",
      status: existing?.status === "ACTIVE" ? "ACTIVE" : "PENDING_AUTH",
      graceUntil: existing?.status === "ACTIVE" ? existing.graceUntil : null,
      authorizedAt: null,
      interpixSubscriptionId: input.interpixSubscriptionId,
      interpixPixCopyPaste: input.pixCopyPaste,
      currentPeriodEnd: input.nextDueDate,
      lastFailureReason: null,
    },
  });
}

export async function recordStripeSubscription(input: {
  userId: string;
  plan: string;
  cycle: SubscriptionCycle;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<void> {
  await db.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      plan: input.plan,
      cycle: input.cycle,
      provider: "STRIPE",
      status: "PENDING_AUTH",
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    },
    update: {
      plan: input.plan,
      cycle: input.cycle,
      provider: "STRIPE",
      status: "PENDING_AUTH",
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSyncedAt: null,
      interpixPixCopyPaste: null,
      authorizedAt: null,
      graceUntil: null,
      graceGrantedAt: null,
      lastFailureReason: null,
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
        plan: "corre",
        provider: "INTERPIX",
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
  if (sub.status === "PAST_DUE") return hasPaidAccess(sub);
  if (sub.status === "TRIALING") {
    return sub.trialEndsAt === null || sub.trialEndsAt > now;
  }
  if (sub.status === "PENDING_AUTH") {
    const graceValid = sub.graceUntil !== null && sub.graceUntil > now;
    const trialActive = sub.trialEndsAt !== null && sub.trialEndsAt > now;
    return graceValid || trialActive;
  }
  if (sub.status === "CANCELED") {
    if (!hasPaidAccess(sub)) return false;
    return sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now;
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

  const limit = effectiveLimit(
    sub?.plan ?? "corre",
    sub?.status ?? "TRIALING",
    sub !== null && hasPaidAccess(sub),
  );
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
  hasAuthorized: boolean;
  lastFailureReason: string | null;
};

export async function getWorkspacePlanState(workspaceId: string): Promise<WorkspacePlanState> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) {
    return {
      status: "NONE",
      isOverLimit: false,
      trialEndsAt: null,
      hasAuthorized: false,
      lastFailureReason: null,
    };
  }

  const sub = await getSubscription(owner.userId);
  const usable = isSubscriptionUsable(sub);
  const active = await activeWorkspaceIds(owner.userId);

  return {
    status: sub?.status ?? "NONE",
    isOverLimit: usable && !active.has(workspaceId),
    trialEndsAt: sub?.trialEndsAt ?? null,
    hasAuthorized: sub?.authorizedAt !== null && sub?.authorizedAt !== undefined,
    lastFailureReason: sub?.lastFailureReason ?? null,
  };
}
