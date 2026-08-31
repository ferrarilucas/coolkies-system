import { db } from "@/lib/db";

const GRACE_DAYS = 7;

export type PaymentEvent = {
  id: string;
  event: string;
  subscriptionId: string | null;
  dueDate: string | null;
};

export type EventOutcome = "applied" | "duplicate" | "unknown";

export async function applyPaymentEvent(event: PaymentEvent): Promise<EventOutcome> {
  const seen = await db.processedWebhookEvent.findUnique({ where: { id: event.id } });
  if (seen) return "duplicate";

  if (!event.subscriptionId) {
    await db.processedWebhookEvent.create({
      data: { id: event.id, event: event.event },
    });
    return "unknown";
  }

  const sub = await db.subscription.findFirst({
    where: { asaasSubscriptionId: event.subscriptionId },
  });

  if (!sub) {
    await db.processedWebhookEvent.create({
      data: { id: event.id, event: event.event },
    });
    return "unknown";
  }

  const data = statusFor(event.event, event.dueDate);

  if (data) {
    await db.$transaction([
      db.subscription.update({ where: { id: sub.id }, data }),
      db.processedWebhookEvent.create({
        data: { id: event.id, event: event.event },
      }),
    ]);
    return "applied";
  }

  await db.processedWebhookEvent.create({
    data: { id: event.id, event: event.event },
  });
  return "applied";
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
