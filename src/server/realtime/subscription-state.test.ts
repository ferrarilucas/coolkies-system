import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { getSubscriptionState } from "./subscription-state";

describe("getSubscriptionState", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("devolve null para quem não tem assinatura", async () => {
    expect(await getSubscriptionState("ninguem")).toBeNull();
  });

  it("resume status, método, autorização, plano, ciclo e vencimento", async () => {
    const user = await testDb.user.create({
      data: { id: "u-state", name: "Dono", email: "state@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "cresce",
        cycle: "YEARLY",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        authorizedAt: new Date("2026-10-11T12:00:00Z"),
        currentPeriodEnd: new Date("2026-10-20T00:00:00Z"),
      },
    });

    expect(await getSubscriptionState(user.id)).toEqual({
      status: "PENDING_AUTH",
      provider: "INTERPIX",
      authorized: true,
      plan: "cresce",
      cycle: "YEARLY",
      nextDueDate: "2026-10-20",
    });
  });
});
