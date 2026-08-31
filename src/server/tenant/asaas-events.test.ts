import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { applyPaymentEvent } from "./asaas-events";

async function subscriptionFor(email: string, asaasId: string) {
  const user = await testDb.user.create({
    data: { id: `u-${asaasId}`, name: "Dono", email },
  });
  return testDb.subscription.create({
    data: {
      userId: user.id,
      plan: "solo",
      source: "ASAAS",
      status: "TRIALING",
      asaasSubscriptionId: asaasId,
    },
  });
}

describe("eventos de cobranca", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("pagamento confirmado ativa a assinatura", async () => {
    const sub = await subscriptionFor("conf@example.com", "sub_conf");

    await applyPaymentEvent({
      id: "evt_1",
      event: "PAYMENT_CONFIRMED",
      subscriptionId: "sub_conf",
      dueDate: "2026-10-01",
    });

    const updated = await testDb.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.graceUntil).toBeNull();
  });

  it("pagamento vencido marca inadimplencia com sete dias de tolerancia", async () => {
    const sub = await subscriptionFor("over@example.com", "sub_over");

    await applyPaymentEvent({
      id: "evt_2",
      event: "PAYMENT_OVERDUE",
      subscriptionId: "sub_over",
      dueDate: "2026-10-01",
    });

    const updated = await testDb.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.status).toBe("PAST_DUE");
    const dias = Math.round(
      ((updated?.graceUntil?.getTime() ?? 0) - Date.now()) / 86400000,
    );
    expect(dias).toBe(7);
  });

  it("evento repetido nao reaplica efeito", async () => {
    await subscriptionFor("dup@example.com", "sub_dup");

    const first = await applyPaymentEvent({
      id: "evt_3",
      event: "PAYMENT_CONFIRMED",
      subscriptionId: "sub_dup",
      dueDate: "2026-10-01",
    });
    const second = await applyPaymentEvent({
      id: "evt_3",
      event: "PAYMENT_OVERDUE",
      subscriptionId: "sub_dup",
      dueDate: "2026-10-01",
    });

    expect(first).toBe("applied");
    expect(second).toBe("duplicate");

    const sub = await testDb.subscription.findFirst({
      where: { asaasSubscriptionId: "sub_dup" },
    });
    expect(sub?.status).toBe("ACTIVE");
  });

  it("assinatura desconhecida nao quebra", async () => {
    const result = await applyPaymentEvent({
      id: "evt_4",
      event: "PAYMENT_CONFIRMED",
      subscriptionId: "sub_inexistente",
      dueDate: "2026-10-01",
    });
    expect(result).toBe("unknown");
  });
});
