import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";

const billing = vi.hoisted(() => ({ fail: false, interpix: [] as string[], stripe: [] as string[] }));

vi.mock("./interpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./interpix")>();
  return {
    ...actual,
    cancelInterPixSubscription: async (id: string) => {
      if (billing.fail) throw new Error("gateway fora do ar");
      billing.interpix.push(id);
      return { pendingCycle: null };
    },
  };
});

vi.mock("./stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe")>();
  return {
    ...actual,
    cancelStripeSubscription: async (id: string) => {
      if (billing.fail) throw new Error("stripe fora do ar");
      billing.stripe.push(id);
    },
  };
});

const { deleteUserAccount, DELETION_BILLING_ERROR, listOwnedWorkspaceNames } = await import("./account");

async function seedFullWorkspace(workspaceId: string, userId: string) {
  const item = await testDb.item.create({
    data: { workspaceId, name: "Cookie", unit: "UN", sellable: true, productionInput: true },
  });
  const variant = await testDb.variant.create({ data: { workspaceId, itemId: item.id, name: "Chocolate" } });
  await testDb.sale.create({
    data: {
      workspaceId,
      userId,
      soldAt: new Date(),
      status: "PAID",
      totalCents: 1000,
      items: {
        create: [
          {
            workspaceId,
            itemId: item.id,
            variantId: variant.id,
            quantity: 1,
            unitPriceSnapshot: 1000,
            productNameSnapshot: "Cookie",
          },
        ],
      },
    },
  });
  await testDb.stockMovement.create({ data: { workspaceId, itemId: item.id, type: "PURCHASE", quantity: 10 } });
}

describe("deleteUserAccount", () => {
  beforeEach(async () => {
    await resetDb();
    billing.fail = false;
    billing.interpix.length = 0;
    billing.stripe.length = 0;
  });

  it("apaga a conta e os workspaces próprios com todos os dados", async () => {
    const ana = await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    const bia = await testDb.user.create({ data: { id: "bia", name: "Bia", email: "bia@example.com" } });
    const ws = await createWorkspace("Loja da Ana");
    await testDb.member.create({ data: { userId: ana.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: bia.id, workspaceId: ws.id, role: "MEMBER" } });
    await seedFullWorkspace(ws.id, bia.id);

    expect(await listOwnedWorkspaceNames(ana.id)).toEqual(["Loja da Ana"]);

    await deleteUserAccount(ana.id);

    expect(await testDb.user.findUnique({ where: { id: ana.id } })).toBeNull();
    expect(await testDb.workspace.findUnique({ where: { id: ws.id } })).toBeNull();
    expect(await testDb.sale.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await testDb.user.findUnique({ where: { id: bia.id } })).not.toBeNull();
  });

  it("vendas registradas no workspace de outra pessoa ficam, sem vínculo", async () => {
    const dona = await testDb.user.create({ data: { id: "dona", name: "Dona", email: "dona@example.com" } });
    const ex = await testDb.user.create({ data: { id: "ex", name: "Ex", email: "ex@example.com" } });
    const ws = await createWorkspace("Loja da Dona");
    await testDb.member.create({ data: { userId: dona.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: ex.id, workspaceId: ws.id, role: "MEMBER" } });
    await seedFullWorkspace(ws.id, ex.id);

    await deleteUserAccount(ex.id);

    const sales = await testDb.sale.findMany({ where: { workspaceId: ws.id } });
    expect(sales).toHaveLength(1);
    expect(sales[0].userId).toBeNull();
    expect(await testDb.workspace.findUnique({ where: { id: ws.id } })).not.toBeNull();
  });

  it("cancela a assinatura no provedor antes de apagar", async () => {
    await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    await testDb.subscription.create({
      data: { userId: "ana", plan: "corre", status: "ACTIVE", provider: "INTERPIX", interpixSubscriptionId: "ip-1" },
    });

    await deleteUserAccount("ana");

    expect(billing.interpix).toEqual(["ip-1"]);
    expect(await testDb.user.findUnique({ where: { id: "ana" } })).toBeNull();
  });

  it("se o provedor falhar, nada é apagado", async () => {
    await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    await testDb.subscription.create({
      data: { userId: "ana", plan: "cresce", status: "ACTIVE", provider: "STRIPE", stripeSubscriptionId: "sub_1" },
    });
    const ws = await createWorkspace("Loja");
    await testDb.member.create({ data: { userId: "ana", workspaceId: ws.id, role: "OWNER" } });
    billing.fail = true;

    await expect(deleteUserAccount("ana")).rejects.toThrow(DELETION_BILLING_ERROR);

    expect(await testDb.user.findUnique({ where: { id: "ana" } })).not.toBeNull();
    expect(await testDb.workspace.findUnique({ where: { id: ws.id } })).not.toBeNull();
  });

  it("assinatura já cancelada não chama o provedor", async () => {
    await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    await testDb.subscription.create({
      data: { userId: "ana", plan: "corre", status: "CANCELED", provider: "INTERPIX", interpixSubscriptionId: "ip-2" },
    });

    await deleteUserAccount("ana");

    expect(billing.interpix).toEqual([]);
  });
});
