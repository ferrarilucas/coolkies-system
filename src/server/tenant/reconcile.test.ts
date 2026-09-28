import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

const remote = vi.hoisted(() => ({ byId: {} as Record<string, string | Error> }));

vi.mock("./interpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./interpix")>();
  return {
    ...actual,
    getInterPixSubscription: async (id: string) => {
      const value = remote.byId[id];
      if (value instanceof Error) throw value;
      return {
        id,
        status: value,
        externalUserId: "x",
        planCode: "corre-monthly",
        amount: "34.50",
        nextDueDate: "2026-10-05",
      };
    },
  };
});

const { reconcileInterPixSubscriptions } = await import("./reconcile");

async function seed(userId: string, interpixId: string, status: "ACTIVE" | "PENDING_AUTH") {
  await testDb.user.create({ data: { id: userId, name: userId, email: `${userId}@example.com` } });
  await testDb.subscription.create({
    data: { userId, plan: "corre", status, provider: "INTERPIX", interpixSubscriptionId: interpixId },
  });
}

describe("reconcileInterPixSubscriptions", () => {
  beforeEach(async () => {
    await resetDb();
    remote.byId = {};
  });

  it("aplica o cancelamento remoto e conta a correção", async () => {
    await seed("u1", "ip-1", "ACTIVE");
    remote.byId["ip-1"] = "CANCELED";

    const summary = await reconcileInterPixSubscriptions(undefined, () => {});

    expect(summary).toMatchObject({ checked: 1, corrected: 1, failed: 0 });
    const sub = await testDb.subscription.findUniqueOrThrow({ where: { userId: "u1" } });
    expect(sub.status).toBe("CANCELED");
  });

  it("uma falha no gateway não impede as outras", async () => {
    await seed("u1", "ip-1", "ACTIVE");
    await seed("u2", "ip-2", "ACTIVE");
    remote.byId["ip-1"] = new Error("timeout");
    remote.byId["ip-2"] = "CANCELED";

    const summary = await reconcileInterPixSubscriptions(undefined, () => {});

    expect(summary).toMatchObject({ checked: 2, failed: 1, corrected: 1 });
  });

  it("ignora assinaturas manuais", async () => {
    await testDb.user.create({ data: { id: "u3", name: "u3", email: "u3@example.com" } });
    await testDb.subscription.create({ data: { userId: "u3", plan: "escala", status: "ACTIVE", provider: "MANUAL" } });

    const summary = await reconcileInterPixSubscriptions(undefined, () => {});

    expect(summary.checked).toBe(0);
  });
});
