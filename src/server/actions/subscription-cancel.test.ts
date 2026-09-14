import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const cancelStripeSubscription = vi.fn(async () => undefined);

vi.mock("@/server/tenant/stripe", () => ({
  StripeConfigError: class StripeConfigError extends Error {},
  cancelStripeSubscription: (...a: unknown[]) =>
    cancelStripeSubscription(...(a as [])),
}));

const { cancelSubscription } = await import("./subscription");

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

function stubInterPixCancelFetch() {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/cancel")) {
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("cancelSubscription", () => {
  beforeEach(async () => {
    await resetDb();
    cancelStripeSubscription.mockClear();
    vi.unstubAllGlobals();
    vi.stubEnv("INTERPIX_API_URL", "https://interpix.test");
    vi.stubEnv("INTERPIX_API_TOKEN", "tok-test");
  });

  it("cancela mandato InterPix e marca a assinatura como CANCELED", async () => {
    const { user } = await userWithWorkspace("u-pix", "pix@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "INTERPIX",
        status: "ACTIVE",
        interpixSubscriptionId: "ipx-1",
      },
    });
    const fetchMock = stubInterPixCancelFetch();

    const result = await cancelSubscription();

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("CANCELED");
  });

  it("cancela assinatura Stripe e marca como CANCELED", async () => {
    const { user } = await userWithWorkspace("u-stripe", "stripe@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "cresce",
        provider: "STRIPE",
        status: "ACTIVE",
        stripeSubscriptionId: "sub_123",
      },
    });

    const result = await cancelSubscription();

    expect(result.ok).toBe(true);
    expect(cancelStripeSubscription).toHaveBeenCalledWith("sub_123");
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("CANCELED");
  });

  it("recusa cancelar assinatura MANUAL", async () => {
    const { user } = await userWithWorkspace("u-manual", "manual@example.com");
    await testDb.subscription.create({
      data: { userId: user.id, plan: "escala", provider: "MANUAL", status: "ACTIVE" },
    });

    const result = await cancelSubscription();

    expect(result.ok).toBe(false);
    expect(cancelStripeSubscription).not.toHaveBeenCalled();
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("ACTIVE");
  });

  it("é idempotente — cancelar de novo não chama a Stripe/InterPix de novo", async () => {
    const { user } = await userWithWorkspace("u-again", "again@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "cresce",
        provider: "STRIPE",
        status: "CANCELED",
        stripeSubscriptionId: "sub_456",
      },
    });

    const result = await cancelSubscription();

    expect(result.ok).toBe(false);
    expect(cancelStripeSubscription).not.toHaveBeenCalled();
  });

  it("sem assinatura nenhuma, recusa educadamente", async () => {
    await userWithWorkspace("u-none", "none@example.com");

    const result = await cancelSubscription();

    expect(result.ok).toBe(false);
  });
});
