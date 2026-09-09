import { Prisma, type Subscription, type SubscriptionCycle } from "@prisma/client";
import { db } from "@/lib/db";
import { isSubscriptionUsable } from "./subscription";

const GRACE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_ID_PATTERN = /^\d{1,19}$/;

export type InterPixEvent =
  | { type: "cycle.paid"; eventId: string; data: { subscriptionId: string; cycleSeq: number; amount: string; paidAt: string } }
  | { type: "cycle.failed"; eventId: string; data: { subscriptionId: string; cycleSeq: number; reason: string | null } }
  | { type: "subscription.authorized"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.auth_denied"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.past_due"; eventId: string; data: { subscriptionId: string; externalUserId: string; retryDate: string } }
  | { type: "subscription.suspended"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.canceled"; eventId: string; data: { subscriptionId: string; externalUserId: string; pendingCycleSeq: number | null } };

export type EventOutcome = "applied" | "duplicate" | "stale" | "conflict" | "unknown" | "invalid";

function isDuplicateEventError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseEventId(eventId: string): bigint | null {
  if (!EVENT_ID_PATTERN.test(eventId)) return null;
  return BigInt(eventId);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function addMonths(date: Date, months: number): Date {
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

function advancePeriod(periodEnd: Date, cycle: SubscriptionCycle): Date {
  return addMonths(periodEnd, cycle === "YEARLY" ? 12 : 1);
}

function changesFor(
  event: InterPixEvent,
  current: Subscription,
  now: Date,
): Prisma.SubscriptionUpdateManyMutationInput {
  switch (event.type) {
    case "cycle.paid":
      return {
        status: "ACTIVE",
        graceUntil: null,
        graceGrantedAt: null,
        lastPaidAt: new Date(event.data.paidAt),
        lastFailureReason: null,
        ...(current.currentPeriodEnd
          ? { currentPeriodEnd: advancePeriod(current.currentPeriodEnd, current.cycle) }
          : {}),
      };
    case "cycle.failed":
      return { lastFailureReason: event.data.reason };
    case "subscription.authorized": {
      const statusChange: Prisma.SubscriptionUpdateManyMutationInput =
        current.status === "ACTIVE" ? {} : { status: "PENDING_AUTH" };
      const hadAccess = isSubscriptionUsable(current, now);
      if (current.graceGrantedAt !== null || !hadAccess) {
        return { ...statusChange, authorizedAt: now };
      }
      return {
        ...statusChange,
        authorizedAt: now,
        graceUntil: current.currentPeriodEnd
          ? addDays(current.currentPeriodEnd, GRACE_DAYS)
          : null,
        graceGrantedAt: now,
      };
    }
    case "subscription.auth_denied":
      return { status: "AUTH_DENIED" };
    case "subscription.past_due":
      return current.status === "ACTIVE" || current.status === "PAST_DUE"
        ? { status: "PAST_DUE" }
        : {};
    case "subscription.suspended":
      return { status: "SUSPENDED" };
    case "subscription.canceled":
      return { status: "CANCELED", pendingCycleSeq: event.data.pendingCycleSeq };
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
  const incoming = parseEventId(event.eventId);
  if (incoming === null) return "invalid";

  const seen = await db.processedWebhookEvent.findUnique({ where: { id: event.eventId } });
  if (seen) return "duplicate";

  const sub = await db.subscription.findUnique({
    where: { interpixSubscriptionId: event.data.subscriptionId },
  });

  if (!sub) return "unknown";

  if (sub.lastAppliedEventId !== null && incoming <= sub.lastAppliedEventId) {
    await recordOnly(event);
    return "stale";
  }

  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.subscription.findUnique({ where: { id: sub.id } });
      if (!current) return "unknown";

      if (current.lastAppliedEventId !== null && incoming <= current.lastAppliedEventId) {
        return "stale";
      }

      const updated = await tx.subscription.updateMany({
        where: {
          id: current.id,
          status: current.status,
          graceGrantedAt: current.graceGrantedAt,
          OR: [{ lastAppliedEventId: null }, { lastAppliedEventId: { lt: incoming } }],
        },
        data: { ...changesFor(event, current, new Date()), lastAppliedEventId: incoming },
      });

      if (updated.count === 0) {
        const after = await tx.subscription.findUnique({ where: { id: current.id } });
        if (after && after.lastAppliedEventId !== null && incoming <= after.lastAppliedEventId) {
          return "stale";
        }
        return "conflict";
      }

      await tx.processedWebhookEvent.create({ data: { id: event.eventId, event: event.type } });
      return "applied";
    });
  } catch (error) {
    if (isDuplicateEventError(error)) return "duplicate";
    throw error;
  }
}
