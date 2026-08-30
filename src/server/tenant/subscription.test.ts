import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";

describe("model de assinatura", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura ligada ao usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-sub", name: "Ana", email: "ana@example.com" },
    });

    const sub = await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    expect(sub.status).toBe("TRIALING");
    expect(sub.asaasSubscriptionId).toBeNull();
  });

  it("permite no máximo uma assinatura por usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dup", name: "Bia", email: "bia@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    await expect(
      testDb.subscription.create({
        data: { userId: user.id, plan: "team", source: "MANUAL" },
      }),
    ).rejects.toThrow();
  });
});
