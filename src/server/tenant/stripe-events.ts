import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import type { SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { retrieveStripeSubscription } from "./stripe";

export type StripeEventOutcome =
  | "applied"
  | "duplicate"
  | "stale"
  | "unknown"
  | "ignored";

const HANDLED_TYPES = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

function isDuplicateEventError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function subscriptionIdFromEvent(event: Stripe.Event): string | null {
  const object = event.data.object as unknown as Record<string, unknown>;

  if (event.type.startsWith("customer.subscription.")) {
    return typeof object.id === "string" ? object.id : null;
  }

  if (event.type.startsWith("invoice.")) {
    const parent = object.parent as
      | { subscription_details?: { subscription?: string | { id: string } } }
      | null
      | undefined;
    const subscription = parent?.subscription_details?.subscription;
    if (typeof subscription === "string") return subscription;
    if (subscription && typeof subscription === "object") return subscription.id;
    return null;
  }

  return null;
}

export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
    case "active":
      return "ACTIVE";
    case "incomplete":
      return "PENDING_AUTH";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
    case "paused":
      return "SUSPENDED";
    case "canceled":
      return "CANCELED";
    case "incomplete_expired":
      return "AUTH_DENIED";
    default:
      return "SUSPENDED";
  }
}

function epochToDate(seconds: number | null | undefined): Date | null {
  if (seconds === null || seconds === undefined) return null;
  return new Date(seconds * 1000);
}

function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = sub.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number");
  if (ends.length === 0) return epochToDate(sub.trial_end);
  return epochToDate(Math.min(...ends));
}

function cardOf(sub: Stripe.Subscription): { brand: string | null; last4: string | null } {
  const pm = sub.default_payment_method;
  if (pm && typeof pm !== "string" && pm.card) {
    return { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null };
  }
  return { brand: null, last4: null };
}

export function projectStripeState(
  sub: Stripe.Subscription,
): Prisma.SubscriptionUpdateManyMutationInput {
  const status = mapStripeStatus(sub.status);
  const periodEnd = periodEndOf(sub);
  const card = cardOf(sub);

  const changes: Prisma.SubscriptionUpdateManyMutationInput = {
    status,
    provider: "STRIPE",
    ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
  };

  if (card.brand !== null) changes.cardBrand = card.brand;
  if (card.last4 !== null) changes.cardLast4 = card.last4;

  if (status === "ACTIVE") {
    changes.lastFailureReason = null;
  }

  return changes;
}

async function recordProcessed(eventId: string, type: string): Promise<void> {
  try {
    await db.processedWebhookEvent.create({
      data: { id: `stripe:${eventId}`, event: type },
    });
  } catch (error) {
    if (!isDuplicateEventError(error)) throw error;
  }
}

export async function applyStripeEvent(
  event: Stripe.Event,
): Promise<StripeEventOutcome> {
  if (!HANDLED_TYPES.has(event.type)) return "ignored";

  const seen = await db.processedWebhookEvent.findUnique({
    where: { id: `stripe:${event.id}` },
  });
  if (seen) return "duplicate";

  const subscriptionId = subscriptionIdFromEvent(event);
  if (!subscriptionId) return "ignored";

  const local = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });
  if (!local) return "unknown";

  const readAt = new Date();
  const fresh = await retrieveStripeSubscription(subscriptionId);

  const changes = projectStripeState(fresh);

  if (event.type === "invoice.paid") {
    const periodEnd = periodEndOf(fresh);
    if (periodEnd) changes.paidThroughAt = periodEnd;
    changes.lastPaidAt = readAt;
  }
  if (event.type === "invoice.payment_failed") {
    changes.lastFailureReason = "Pagamento no cartão recusado.";
  }

  const updated = await db.subscription.updateMany({
    where: {
      id: local.id,
      OR: [{ stripeSyncedAt: null }, { stripeSyncedAt: { lt: readAt } }],
    },
    data: { ...changes, stripeSyncedAt: readAt },
  });

  if (updated.count === 0) return "stale";

  await recordProcessed(event.id, event.type);
  return "applied";
}
