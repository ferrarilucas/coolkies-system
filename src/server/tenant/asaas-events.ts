import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const GRACE_DAYS = 7;

export type PaymentEvent = {
  id: string;
  event: string;
  subscriptionId: string | null;
  dueDate: string | null;
};

export type EventOutcome = "applied" | "duplicate" | "unknown";

function isDuplicateEventError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function recordEvent(event: PaymentEvent): Promise<boolean> {
  try {
    await db.processedWebhookEvent.create({
      data: { id: event.id, event: event.event },
    });
    return true;
  } catch (error) {
    if (isDuplicateEventError(error)) return false;
    throw error;
  }
}

async function applyAndRecord(
  event: PaymentEvent,
  subscriptionId: string,
  data: Prisma.SubscriptionUpdateInput,
): Promise<boolean> {
  try {
    await db.$transaction([
      db.subscription.update({ where: { id: subscriptionId }, data }),
      db.processedWebhookEvent.create({
        data: { id: event.id, event: event.event },
      }),
    ]);
    return true;
  } catch (error) {
    if (isDuplicateEventError(error)) return false;
    throw error;
  }
}

export async function applyPaymentEvent(event: PaymentEvent): Promise<EventOutcome> {
  const seen = await db.processedWebhookEvent.findUnique({ where: { id: event.id } });
  if (seen) return "duplicate";

  if (!event.subscriptionId) {
    const recorded = await recordEvent(event);
    return recorded ? "unknown" : "duplicate";
  }

  const sub = await db.subscription.findFirst({
    where: { asaasSubscriptionId: event.subscriptionId },
  });

  if (!sub) {
    const recorded = await recordEvent(event);
    return recorded ? "unknown" : "duplicate";
  }

  const data = statusFor(event.event, event.dueDate);

  if (data) {
    const applied = await applyAndRecord(event, sub.id, data);
    return applied ? "applied" : "duplicate";
  }

  const recorded = await recordEvent(event);
  return recorded ? "applied" : "duplicate";
}

function statusFor(event: string, dueDate: string | null) {
  if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
    return {
      status: "ACTIVE" as const,
      graceUntil: null,
      currentPeriodEnd: dueDate ? new Date(dueDate) : null,
    };
  }
  if (event === "PAYMENT_OVERDUE") {
    return {
      status: "PAST_DUE" as const,
      graceUntil: new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000),
    };
  }
  return null;
}
