import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { resetDb, testDb } from "@/test/db";

const retrieveMock = vi.fn();
vi.mock("./stripe", () => ({
  retrieveStripeSubscription: (...args: unknown[]) => retrieveMock(...args),
}));

import { applyStripeEvent, mapStripeStatus, projectStripeState } from "./stripe-events";

const STRIPE_SUB_ID = "sub_stripe_1";

async function subscriber(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const user = await testDb.user.create({
    data: { id, name: "Dono", email: `${id}@example.com` },
  });
  await testDb.subscription.create({
    data: {
      userId: user.id,
      plan: "corre",
      provider: "STRIPE",
      status: "PENDING_AUTH",
      stripeCustomerId: `cus_${id}`,
      stripeSubscriptionId: STRIPE_SUB_ID,
      ...overrides,
    },
  });
  return user;
}

function subOf(userId: string) {
  return testDb.subscription.findUnique({ where: { userId } });
}

function fakeStripeSub(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: STRIPE_SUB_ID,
    status: "active",
    trial_end: null,
    default_payment_method: {
      card: { brand: "visa", last4: "4242" },
    },
    items: {
      data: [{ current_period_end: 1_800_000_000 }],
    },
    ...over,
  } as unknown as Stripe.Subscription;
}

function subEvent(
  type: string,
  eventId: string,
  object: Record<string, unknown> = { id: STRIPE_SUB_ID },
): Stripe.Event {
  return { id: eventId, type, data: { object } } as unknown as Stripe.Event;
}

function invoiceEvent(type: string, eventId: string): Stripe.Event {
  return {
    id: eventId,
    type,
    data: {
      object: {
        parent: { subscription_details: { subscription: STRIPE_SUB_ID } },
      },
    },
  } as unknown as Stripe.Event;
}

describe("mapStripeStatus", () => {
  it("trialing e active viram ACTIVE", () => {
    expect(mapStripeStatus("trialing")).toBe("ACTIVE");
    expect(mapStripeStatus("active")).toBe("ACTIVE");
  });

  it("incomplete_expired vira AUTH_DENIED", () => {
    expect(mapStripeStatus("incomplete_expired")).toBe("AUTH_DENIED");
  });

  it("unpaid e paused viram SUSPENDED", () => {
    expect(mapStripeStatus("unpaid")).toBe("SUSPENDED");
    expect(mapStripeStatus("paused")).toBe("SUSPENDED");
  });
});

describe("projectStripeState", () => {
  it("em trial usa trial_end como fim de período e não toca cartão ausente", () => {
    const changes = projectStripeState(
      fakeStripeSub({
        status: "trialing",
        trial_end: 1_900_000_000,
        default_payment_method: null,
        items: { data: [{ current_period_end: 1_900_000_000 }] } as never,
      }),
    );
    expect(changes.status).toBe("ACTIVE");
    expect(changes.currentPeriodEnd).toEqual(new Date(1_900_000_000 * 1000));
    expect(changes.cardBrand).toBeUndefined();
  });
});

describe("applyStripeEvent", () => {
  beforeEach(async () => {
    await resetDb();
    retrieveMock.mockReset();
  });

  it("customer.subscription.updated projeta status e cartão", async () => {
    const user = await subscriber("u-upd");
    retrieveMock.mockResolvedValue(fakeStripeSub());

    const outcome = await applyStripeEvent(
      subEvent("customer.subscription.updated", "evt_1"),
    );

    expect(outcome).toBe("applied");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.cardBrand).toBe("visa");
    expect(sub?.cardLast4).toBe("4242");
    expect(sub?.stripeSyncedAt).not.toBeNull();
  });

  it("evento duplicado não reaplica", async () => {
    await subscriber("u-dup");
    retrieveMock.mockResolvedValue(fakeStripeSub());

    const first = await applyStripeEvent(
      subEvent("customer.subscription.updated", "evt_dup"),
    );
    const second = await applyStripeEvent(
      subEvent("customer.subscription.updated", "evt_dup"),
    );

    expect(first).toBe("applied");
    expect(second).toBe("duplicate");
  });

  it("evento fora de ordem não regride o estado", async () => {
    const user = await subscriber("u-race", {
      status: "ACTIVE",
      stripeSyncedAt: new Date("2999-01-01T00:00:00Z"),
    });
    retrieveMock.mockResolvedValue(fakeStripeSub({ status: "past_due" }));

    const outcome = await applyStripeEvent(
      subEvent("customer.subscription.updated", "evt_late"),
    );

    expect(outcome).toBe("stale");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
  });

  it("assinatura Stripe desconhecida retorna unknown", async () => {
    retrieveMock.mockResolvedValue(fakeStripeSub());
    const outcome = await applyStripeEvent(
      subEvent("customer.subscription.updated", "evt_unknown"),
    );
    expect(outcome).toBe("unknown");
  });

  it("tipo não tratado é ignorado", async () => {
    const outcome = await applyStripeEvent(
      subEvent("customer.subscription.trial_will_end", "evt_ignored"),
    );
    expect(outcome).toBe("ignored");
  });

  it("invoice.paid avança paidThroughAt preservando o período pago do Pix", async () => {
    const pixPaidThrough = new Date("2027-01-01T00:00:00Z");
    const user = await subscriber("u-invoice", {
      status: "ACTIVE",
      paidThroughAt: pixPaidThrough,
      currentPeriodEnd: pixPaidThrough,
    });
    retrieveMock.mockResolvedValue(
      fakeStripeSub({
        status: "active",
        items: { data: [{ current_period_end: 1_950_000_000 }] } as never,
      }),
    );

    const outcome = await applyStripeEvent(invoiceEvent("invoice.paid", "evt_inv"));

    expect(outcome).toBe("applied");
    const sub = await subOf(user.id);
    expect(sub?.paidThroughAt).toEqual(new Date(1_950_000_000 * 1000));
    expect(sub?.lastPaidAt).not.toBeNull();
  });

  it("invoice.payment_failed registra o motivo da falha", async () => {
    const user = await subscriber("u-fail", { status: "ACTIVE" });
    retrieveMock.mockResolvedValue(fakeStripeSub({ status: "past_due" }));

    const outcome = await applyStripeEvent(
      invoiceEvent("invoice.payment_failed", "evt_fail"),
    );

    expect(outcome).toBe("applied");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("PAST_DUE");
    expect(sub?.lastFailureReason).toBe("Pagamento no cartão recusado.");
  });
});
