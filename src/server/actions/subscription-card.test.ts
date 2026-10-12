import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const createStripeSubscription = vi.fn(async (input: { idempotencyKey: string }) => {
  void input;
  return { subscriptionId: "sub_stripe_new", clientSecret: "pi_x_secret_y" };
});
const getOrCreateStripeCustomer = vi.fn(async () => "cus_stripe_new");
const retrieveStripeSubscription = vi.fn(async (id: string) => ({ id, status: "canceled" }));

vi.mock("@/server/tenant/stripe", () => ({
  StripeConfigError: class StripeConfigError extends Error {},
  priceIdFor: () => "price_test",
  getOrCreateStripeCustomer: (...a: unknown[]) => getOrCreateStripeCustomer(...(a as [])),
  createStripeSubscription: (...a: unknown[]) =>
    createStripeSubscription(...(a as [never])),
  retrieveStripeSubscription: (...a: unknown[]) =>
    retrieveStripeSubscription(...(a as [string])),
}));

const { subscribeWithCard } = await import("./subscription");

async function userWithWorkspace(id: string, email: string) {
  const user = await testDb.user.create({ data: { id, name: "Dona", email } });
  const ws = await testDb.workspace.create({ data: { name: "WS", slug: `ws-${id}` } });
  await testDb.member.create({
    data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
  });
  sessionResult = {
    user: { id: user.id },
    session: { id: `s-${id}`, activeWorkspaceId: ws.id },
  };
  return { user, ws };
}

const ATTEMPT_ID = "6f1c2a4e-8d3b-4c7a-9e21-5b0f3d8a7c64";

function cardForm(plan = "corre", cycle = "MONTHLY", attemptId = ATTEMPT_ID) {
  const fd = new FormData();
  fd.set("plan", plan);
  fd.set("cycle", cycle);
  fd.set("attemptId", attemptId);
  return fd;
}

function stubCancelFetch(pendingCycle?: { cycleSeq: number; dueDate: string }) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/cancel")) {
      return new Response(
        pendingCycle ? JSON.stringify({ pendingCycle }) : null,
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("subscribeWithCard", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeSubscription.mockClear();
    getOrCreateStripeCustomer.mockClear();
    retrieveStripeSubscription.mockReset();
    retrieveStripeSubscription.mockImplementation(async (id: string) => ({ id, status: "canceled" }));
    vi.unstubAllGlobals();
    vi.stubEnv("INTERPIX_API_URL", "https://interpix.test");
    vi.stubEnv("INTERPIX_API_TOKEN", "tok-test");
  });

  it("conta nova: cobra no cartão na hora e grava mapeamento STRIPE", async () => {
    const { user } = await userWithWorkspace("u-new", "new@example.com");

    const result = await subscribeWithCard(cardForm());

    expect(result.ok).toBe(true);
    expect(result.data?.clientSecret).toBe("pi_x_secret_y");

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.provider).toBe("STRIPE");
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.stripeCustomerId).toBe("cus_stripe_new");
    expect(sub?.stripeSubscriptionId).toBe("sub_stripe_new");
    expect(sub?.stripeSyncedAt).toBeNull();
  });

  it("teste do app em curso: cobra no cartão na hora, sem período de teste na Stripe", async () => {
    const { user } = await userWithWorkspace("u-trial", "trial@example.com");
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "INTERPIX",
        status: "TRIALING",
        trialEndsAt,
      },
    });

    const result = await subscribeWithCard(cardForm());

    expect(result.data?.clientSecret).toBe("pi_x_secret_y");
    const passed = createStripeSubscription.mock.calls[0][0] as Record<string, unknown>;
    expect(passed).not.toHaveProperty("trialEnd");
    expect(passed).not.toHaveProperty("mode");
  });

  it("período pago no Pix: cobra no cartão na hora, sem período de teste na Stripe", async () => {
    const { user } = await userWithWorkspace("u-pixpaid", "pixpaid@example.com");
    const periodEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "INTERPIX",
        status: "ACTIVE",
        currentPeriodEnd: periodEnd,
        paidThroughAt: periodEnd,
      },
    });

    const result = await subscribeWithCard(cardForm());

    expect(result.data?.clientSecret).toBe("pi_x_secret_y");
    const passed = createStripeSubscription.mock.calls[0][0] as Record<string, unknown>;
    expect(passed).not.toHaveProperty("trialEnd");
    expect(passed).not.toHaveProperty("mode");
  });

  it("recusa assinatura MANUAL sem tocar a Stripe", async () => {
    const { user } = await userWithWorkspace("u-manual", "manual@example.com");
    await testDb.subscription.create({
      data: { userId: user.id, plan: "escala", provider: "MANUAL", status: "ACTIVE" },
    });

    const result = await subscribeWithCard(cardForm());

    expect(result.ok).toBe(false);
    expect(createStripeSubscription).not.toHaveBeenCalled();
  });

  it("cancela o mandato InterPix antes de criar na Stripe e propaga a cobrança pendente", async () => {
    const { user } = await userWithWorkspace("u-switch", "switch@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        interpixSubscriptionId: "ipx-old",
      },
    });
    const fetchMock = stubCancelFetch({ cycleSeq: 4, dueDate: "2026-09-18" });

    const result = await subscribeWithCard(cardForm());

    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/cancel");
    expect(result.data?.previousPendingCharge).toEqual({
      cycleSeq: 4,
      dueDate: "2026-09-18",
    });
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.pendingChargeDueAt?.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(sub?.provider).toBe("STRIPE");
  });

  it("idempotency key deriva de userId + plano + ciclo + tentativa", async () => {
    const { user } = await userWithWorkspace("u-idem", "idem@example.com");

    await subscribeWithCard(cardForm("cresce", "YEARLY"));

    const passed = createStripeSubscription.mock.calls[0][0] as { idempotencyKey: string };
    expect(passed.idempotencyKey).toBe(`stripe-sub:${user.id}:cresce:YEARLY:${ATTEMPT_ID}`);
  });

  it("tentativas diferentes usam chaves diferentes, para não receber de volta a assinatura anterior", async () => {
    await userWithWorkspace("u-idem-2", "idem2@example.com");

    await subscribeWithCard(cardForm("corre", "MONTHLY", "0b9d6f1e-2c3a-4f5b-8a7e-1d2c3b4a5f60"));
    await subscribeWithCard(cardForm("corre", "MONTHLY", "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"));

    const keys = createStripeSubscription.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(2);
  });

  it("recusa tentativa sem identificador válido, sem tocar a Stripe", async () => {
    await userWithWorkspace("u-idem-missing", "idem-missing@example.com");

    const res = await subscribeWithCard(cardForm("corre", "MONTHLY", "nao-e-uuid"));

    expect(res.ok).toBe(false);
    expect(createStripeSubscription).not.toHaveBeenCalled();
  });

  it("recusa nova assinatura quando a assinatura de cartão anterior ainda está ativa na Stripe", async () => {
    const { user } = await userWithWorkspace("u-card-active", "card-active@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "STRIPE",
        status: "PENDING_AUTH",
        stripeCustomerId: "cus_old",
        stripeSubscriptionId: "sub_old_active",
      },
    });
    retrieveStripeSubscription.mockImplementation(async (id: string) => ({ id, status: "active" }));

    const res = await subscribeWithCard(cardForm());

    expect(res.ok).toBe(false);
    expect(res.error).toContain("assinatura ativa");
    expect(retrieveStripeSubscription).toHaveBeenCalledWith("sub_old_active");
    expect(createStripeSubscription).not.toHaveBeenCalled();
  });

  it("segue com a nova assinatura quando a anterior já foi cancelada na Stripe", async () => {
    const { user } = await userWithWorkspace("u-card-canceled", "card-canceled@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "STRIPE",
        status: "CANCELED",
        stripeCustomerId: "cus_old",
        stripeSubscriptionId: "sub_old_canceled",
      },
    });

    const res = await subscribeWithCard(cardForm());

    expect(res.ok).toBe(true);
    expect(createStripeSubscription).toHaveBeenCalledTimes(1);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.stripeSubscriptionId).toBe("sub_stripe_new");
  });

  it("recusa quando não consegue consultar a assinatura anterior na Stripe, para não cobrar em dobro", async () => {
    const { user } = await userWithWorkspace("u-card-unknown", "card-unknown@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "STRIPE",
        status: "ACTIVE",
        stripeCustomerId: "cus_old",
        stripeSubscriptionId: "sub_old_unknown",
      },
    });
    retrieveStripeSubscription.mockRejectedValue(new Error("stripe fora do ar"));

    const res = await subscribeWithCard(cardForm());

    expect(res.ok).toBe(false);
    expect(createStripeSubscription).not.toHaveBeenCalled();
  });
});
