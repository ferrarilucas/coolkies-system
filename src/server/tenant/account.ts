import { db } from "@/lib/db";
import { TERMS_VERSION } from "@/lib/legal";
import { getSubscription, markSubscriptionCanceled } from "./subscription";
import { cancelInterPixSubscription } from "./interpix";
import { cancelStripeSubscription, StripeApiError } from "./stripe";

export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { termsVersion: true } });
  return user?.termsVersion === TERMS_VERSION;
}

export async function acceptCurrentTerms(userId: string, now: Date = new Date()): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: now },
  });
}

export const DELETION_BILLING_ERROR =
  "Não conseguimos cancelar sua assinatura agora, então nada foi excluído. Tente de novo em alguns minutos.";

export class AccountDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

export type PersonalDataExport = {
  exportedAt: string;
  user: {
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    cpf: string | null;
    createdAt: string;
    termsVersion: string | null;
    termsAcceptedAt: string | null;
  };
  loginMethods: string[];
  workspaces: { name: string; role: string; joinedAt: string }[];
  subscription: {
    plan: string;
    status: string;
    cycle: string;
    provider: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
  } | null;
};

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export async function buildPersonalDataExport(
  userId: string,
  now: Date = new Date(),
): Promise<PersonalDataExport> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      accounts: { select: { providerId: true } },
      members: { include: { workspace: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      subscription: true,
    },
  });
  const sub = user.subscription;

  return {
    exportedAt: now.toISOString(),
    user: {
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      cpf: user.cpf,
      createdAt: user.createdAt.toISOString(),
      termsVersion: user.termsVersion,
      termsAcceptedAt: iso(user.termsAcceptedAt),
    },
    loginMethods: user.accounts.map((a) => a.providerId),
    workspaces: user.members.map((m) => ({
      name: m.workspace.name,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    })),
    subscription: sub
      ? {
          plan: sub.plan,
          status: sub.status,
          cycle: sub.cycle,
          provider: sub.provider,
          trialEndsAt: iso(sub.trialEndsAt),
          currentPeriodEnd: iso(sub.currentPeriodEnd),
          cardBrand: sub.cardBrand,
          cardLast4: sub.cardLast4,
        }
      : null,
  };
}

export async function listOwnedWorkspaceNames(userId: string): Promise<string[]> {
  const owned = await db.member.findMany({
    where: { userId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { name: true } } },
  });
  return owned.map((m) => m.workspace.name);
}

const SETTLED_STATUSES = new Set(["CANCELED", "AUTH_DENIED"]);

function isStripeResourceMissing(e: unknown): boolean {
  return e instanceof StripeApiError && e.code === "resource_missing";
}

async function cancelStripeIfPresent(subscriptionId: string): Promise<void> {
  try {
    await cancelStripeSubscription(subscriptionId);
  } catch (e) {
    if (isStripeResourceMissing(e)) return;
    throw e;
  }
}

async function cancelBilling(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub || SETTLED_STATUSES.has(sub.status)) return;

  try {
    if (sub.provider === "INTERPIX" && sub.interpixSubscriptionId) {
      await cancelInterPixSubscription(sub.interpixSubscriptionId);
    }
    if (sub.provider === "STRIPE" && sub.stripeSubscriptionId) {
      await cancelStripeIfPresent(sub.stripeSubscriptionId);
    }
  } catch (e) {
    console.error(
      "deleteUserAccount: falha ao cancelar assinatura",
      sub.id,
      e instanceof Error ? e.name : "erro desconhecido",
    );
    throw new AccountDeletionError(DELETION_BILLING_ERROR);
  }

  await markSubscriptionCanceled(userId);
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await cancelBilling(userId);

  const owned = await db.member.findMany({
    where: { userId, role: "OWNER" },
    select: { workspaceId: true },
  });
  const workspaceId = { in: owned.map((m) => m.workspaceId) };

  await db.$transaction([
    db.stockMovement.deleteMany({ where: { workspaceId } }),
    db.saleItem.deleteMany({ where: { workspaceId } }),
    db.productionVariantLine.deleteMany({ where: { workspaceId } }),
    db.productionBatch.deleteMany({ where: { workspaceId } }),
    db.recipeItem.deleteMany({ where: { workspaceId } }),
    db.workspace.deleteMany({ where: { id: workspaceId } }),
    db.user.delete({ where: { id: userId } }),
  ]);
}
