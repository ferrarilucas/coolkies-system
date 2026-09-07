import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const GRACE_DAYS = 7;

export type InterPixEvent =
  | { type: "cycle.paid"; eventId: string; data: { subscriptionId: string; cycleSeq: number; amount: string; paidAt: string } }
  | { type: "cycle.failed"; eventId: string; data: { subscriptionId: string; cycleSeq: number; reason: string | null } }
  | { type: "subscription.authorized"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.auth_denied"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.past_due"; eventId: string; data: { subscriptionId: string; externalUserId: string; retryDate: string } }
  | { type: "subscription.suspended"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.canceled"; eventId: string; data: { subscriptionId: string; externalUserId: string; pendingCycleSeq: number | null } };

export type EventOutcome = "applied" | "duplicate" | "stale" | "unknown";

function isDuplicateEventError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function changesFor(
  event: InterPixEvent,
  current: { currentPeriodEnd: Date | null },
): Prisma.SubscriptionUpdateInput {
  switch (event.type) {
    case "cycle.paid":
      return { status: "ACTIVE", graceUntil: null };
    case "cycle.failed":
      return {};
    case "subscription.authorized":
      return {
        status: "PENDING_AUTH",
        graceUntil: current.currentPeriodEnd
          ? addDays(current.currentPeriodEnd, GRACE_DAYS)
          : null,
      };
    case "subscription.auth_denied":
      return { status: "AUTH_DENIED" };
    case "subscription.past_due":
      return { status: "PAST_DUE" };
    case "subscription.suspended":
      return { status: "SUSPENDED" };
    case "subscription.canceled":
      return { status: "CANCELED" };
  }
}

async function recordOnly(event: InterPixEvent): Promise<void> {
  try {
    await db.processedWebhookEvent.create({ data: { id: event.eventId, event: event.type } });
  } catch (error) {
    if (!isDuplicateEventError(error)) throw error;
  }
}

export async function applyInterPixEvent(event: InterPixEvent): Promise<EventOutcome> {
  const seen = await db.processedWebhookEvent.findUnique({ where: { id: event.eventId } });
  if (seen) return "duplicate";

  const sub = await db.subscription.findUnique({
    where: { interpixSubscriptionId: event.data.subscriptionId },
  });

  if (!sub) {
    await recordOnly(event);
    return "unknown";
  }

  const incoming = BigInt(event.eventId);
  if (sub.lastAppliedEventId !== null && incoming <= sub.lastAppliedEventId) {
    await recordOnly(event);
    return "stale";
  }

  try {
    await db.$transaction([
      db.subscription.update({
        where: { id: sub.id },
        data: { ...changesFor(event, sub), lastAppliedEventId: incoming },
      }),
      db.processedWebhookEvent.create({ data: { id: event.eventId, event: event.type } }),
    ]);
    return "applied";
  } catch (error) {
    if (isDuplicateEventError(error)) return "duplicate";
    throw error;
  }
}
