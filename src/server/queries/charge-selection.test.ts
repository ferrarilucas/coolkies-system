import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "" };

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
}));

const { getChargeSelection } = await import("./charge-selection");

const DAY = 24 * 60 * 60 * 1000;

describe("getChargeSelection", () => {
  let workspaceId = "";
  let otherWorkspaceId = "";
  let ana = "";
  let bruno = "";

  beforeEach(async () => {
    await resetDb();
    workspaceId = (await createWorkspace("Cookies")).id;
    otherWorkspaceId = (await createWorkspace("Outra")).id;
    context.workspaceId = workspaceId;
    ana = (await testDb.customer.create({ data: { name: "Ana", sector: "RH", workspaceId } })).id;
    bruno = (await testDb.customer.create({ data: { name: "Bruno", workspaceId } })).id;
  });

  it("só as parcelas selecionadas, em aberto, do cliente", async () => {
    const sale = await seedParceledSale({
      workspaceId,
      customerId: ana,
      parcels: [
        { amountCents: 1000, dueDate: null },
        { amountCents: 2000, dueDate: null, paidAt: new Date() },
      ],
    });
    const brunoSale = await seedParceledSale({ workspaceId, customerId: bruno, parcels: [{ amountCents: 500, dueDate: null }] });
    const otherCustomer = await testDb.customer.create({ data: { name: "Fora", workspaceId: otherWorkspaceId } });
    const foreign = await seedParceledSale({
      workspaceId: otherWorkspaceId,
      customerId: otherCustomer.id,
      parcels: [{ amountCents: 700, dueDate: null }],
    });

    const [open, paid] = sale.installments;
    const result = await getChargeSelection(ana, [open.id, paid.id, brunoSale.installments[0].id, foreign.installments[0].id, "lixo"]);
    expect(result.status).toBe("ok");
    const sel = result.status === "ok" ? result.selection : null;

    expect(sel?.customer).toEqual({ id: ana, name: "Ana", sector: "RH" });
    expect(sel?.sales.flatMap((s) => s.selectedInstallments.map((i) => i.id))).toEqual([open.id]);
    expect(sel?.totalCents).toBe(1000);
  });

  it("venda parcelada lista só as parcelas marcadas", async () => {
    const sale = await seedParceledSale({
      workspaceId,
      customerId: ana,
      parcels: [
        { amountCents: 1000, dueDate: new Date(Date.now() + DAY) },
        { amountCents: 1000, dueDate: new Date(Date.now() + 30 * DAY) },
        { amountCents: 1000, dueDate: new Date(Date.now() + 60 * DAY) },
      ],
    });
    const result = await getChargeSelection(ana, [sale.installments[0].id, sale.installments[2].id]);
    const sel = result.status === "ok" ? result.selection : null;
    expect(sel?.sales).toHaveLength(1);
    expect(sel?.sales[0].installmentCount).toBe(3);
    expect(sel?.sales[0].selectedInstallments.map((i) => i.number)).toEqual([1, 3]);
    expect(sel?.totalCents).toBe(2000);
  });

  it("ordena vendas por soldAt e traz os itens", async () => {
    const late = await seedParceledSale({ workspaceId, customerId: ana, soldAt: new Date(Date.now() - DAY), parcels: [{ amountCents: 100, dueDate: null }] });
    const early = await seedParceledSale({ workspaceId, customerId: ana, soldAt: new Date(Date.now() - 5 * DAY), parcels: [{ amountCents: 200, dueDate: null }] });
    const item = await testDb.item.create({ data: { name: "Cookie", workspaceId } });
    await testDb.saleItem.create({
      data: { saleId: early.id, itemId: item.id, workspaceId, quantity: 2, unitPriceSnapshot: 100, productNameSnapshot: "Cookie", variantNameSnapshot: "Nutella" },
    });
    const result = await getChargeSelection(ana, [late.installments[0].id, early.installments[0].id]);
    const sel = result.status === "ok" ? result.selection : null;
    expect(sel?.sales.map((s) => s.id)).toEqual([early.id, late.id]);
    expect(sel?.sales[0].items).toEqual([
      expect.objectContaining({ quantity: 2, productNameSnapshot: "Cookie", variantNameSnapshot: "Nutella" }),
    ]);
  });

  it("nenhuma válida → empty", async () => {
    expect(await getChargeSelection(ana, ["lixo"])).toEqual({ status: "empty" });
    expect(await getChargeSelection(ana, [])).toEqual({ status: "empty" });
  });

  it("só parcelas pagas → empty", async () => {
    const sale = await seedParceledSale({ workspaceId, customerId: ana, parcels: [{ amountCents: 100, dueDate: null, paidAt: new Date() }] });
    expect(await getChargeSelection(ana, [sale.installments[0].id])).toEqual({ status: "empty" });
  });

  it("cliente de outro workspace → no-customer", async () => {
    const otherCustomer = await testDb.customer.create({ data: { name: "Fora", workspaceId: otherWorkspaceId } });
    const foreign = await seedParceledSale({ workspaceId: otherWorkspaceId, customerId: otherCustomer.id, parcels: [{ amountCents: 700, dueDate: null }] });
    expect(await getChargeSelection(otherCustomer.id, [foreign.installments[0].id])).toEqual({ status: "no-customer" });
  });

  it("cliente inexistente → no-customer mesmo sem ids", async () => {
    expect(await getChargeSelection("nao-existe", [])).toEqual({ status: "no-customer" });
  });
});
