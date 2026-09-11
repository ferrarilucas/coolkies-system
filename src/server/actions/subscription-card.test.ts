import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const createStripeSubscription = vi.fn(
  async (input: { mode: "payment" | "setup"; trialEnd?: number; idempotencyKey: string }) => ({
    subscriptionId: "sub_stripe_new",
    clientSecret: input.mode === "setup" ? "seti_x_secret_y" : "pi_x_secret_y",
    mode: input.mode,
  }),
);
const getOrCreateStripeCustomer = vi.fn(async () => "cus_stripe_new");

vi.mock("@/server/tenant/stripe", () => ({
  StripeConfigError: class StripeConfigError extends Error {},
  priceIdFor: () => "price_test",
  getOrCreateStripeCustomer: (...a: unknown[]) => getOrCreateStripeCustomer(...(a as [])),
  createStripeSubscription: (...a: unknown[]) =>
    createStripeSubscription(...(a as [never])),
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

function cardForm(plan = "corre", cycle = "MONTHLY") {
  const fd = new FormData();
  fd.set("plan", plan);
  fd.set("cycle", cycle);
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
    vi.unstubAllGlobals();
    vi.stubEnv("INTERPIX_API_URL", "https://interpix.test");
    vi.stubEnv("INTERPIX_API_TOKEN", "tok-test");
  });

  it("conta nova sem período pago: modo payment e grava mapeamento STRIPE", async () => {
    const { user } = await userWithWorkspace("u-new", "new@example.com");

    const result = await subscribeWithCard(cardForm());

    expect(result.ok).toBe(true);
    expect(result.data?.mode).toBe("payment");
    expect(result.data?.clientSecret).toBe("pi_x_secret_y");

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.provider).toBe("STRIPE");
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.stripeCustomerId).toBe("cus_stripe_new");
    expect(sub?.stripeSubscriptionId).toBe("sub_stripe_new");
    expect(sub?.stripeSyncedAt).toBeNull();
  });

  it("trial de 14 dias em curso: modo setup com trial_end no fim do teste", async () => {
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

    expect(result.data?.mode).toBe("setup");
    const passed = createStripeSubscription.mock.calls[0][0] as { trialEnd?: number };
    expect(passed.trialEnd).toBe(Math.floor(trialEndsAt.getTime() / 1000));
  });

  it("Pix pago à frente: modo setup usando o fim do período já pago", async () => {
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

    expect(result.data?.mode).toBe("setup");
    const passed = createStripeSubscription.mock.calls[0][0] as { trialEnd?: number };
    expect(passed.trialEnd).toBe(Math.floor(periodEnd.getTime() / 1000));
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

  it("idempotency key deriva de userId + plano + ciclo", async () => {
    const { user } = await userWithWorkspace("u-idem", "idem@example.com");

    await subscribeWithCard(cardForm("cresce", "YEARLY"));

    const passed = createStripeSubscription.mock.calls[0][0] as { idempotencyKey: string };
    expect(passed.idempotencyKey).toBe(`stripe-sub:${user.id}:cresce:YEARLY`);
  });
});
