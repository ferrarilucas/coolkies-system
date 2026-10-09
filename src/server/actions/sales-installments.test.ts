import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "" };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({ ...context, role: "OWNER", db: scopedDb(context.workspaceId) }),
  writeBlocked: async () => null,
}));

const { createSale, updateSale } = await import("./sales");

let itemId = "";

function form(fields: Record<string, string>, unitPriceCents = 10000, quantity = 1) {
  const fd = new FormData();
  fd.set("soldAt", "2026-10-09");
  fd.set("items", JSON.stringify([{ itemId, productName: "Bolo", variantId: null, variantName: null, quantity, unitPriceCents }]));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

async function installmentsOf(saleId: string) {
  return testDb.saleInstallment.findMany({ where: { saleId }, orderBy: { number: "asc" } });
}

describe("createSale / updateSale com parcelas", () => {
  beforeEach(async () => {
    await resetDb();
    const ws = await createWorkspace("Vendas");
    const user = await testDb.user.create({ data: { id: `u-${ws.id}`, name: "Dona", email: `d-${ws.id}@example.com` } });
    context.workspaceId = ws.id;
    context.userId = user.id;
    itemId = (
      await testDb.item.create({ data: { name: "Bolo", unit: "UN", sellable: true, productionInput: false, workspaceId: ws.id } })
    ).id;
  });

  it("à vista paga cria uma parcela paga", async () => {
    const res = await createSale(form({ paymentMode: "CASH", status: "PAID" }));
    expect(res.ok).toBe(true);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: res.data!.id } });
    expect([sale.status, sale.openCents, sale.installmentCount]).toEqual(["PAID", 0, 1]);
    const parcels = await installmentsOf(sale.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt !== null])).toEqual([[10000, true]]);
  });

  it("parcelado em 3x divide o total e agenda mês a mês", async () => {
    const res = await createSale(
      form({ paymentMode: "INSTALLMENTS", installmentCount: "3", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }),
    );
    expect(res.ok).toBe(true);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: res.data!.id } });
    expect([sale.status, sale.openCents, sale.installmentCount, ymd(sale.paymentForecastDate)]).toEqual([
      "PENDING",
      10000,
      3,
      "2026-10-20",
    ]);
    const parcels = await installmentsOf(sale.id);
    expect(parcels.map((p) => [p.amountCents, ymd(p.dueDate)])).toEqual([
      [3333, "2026-10-20"],
      [3333, "2026-11-20"],
      [3334, "2026-12-20"],
    ]);
  });

  it("recusa parcelado com 25 parcelas sem gravar nada", async () => {
    const res = await createSale(form({ paymentMode: "INSTALLMENTS", installmentCount: "25", forecastPreset: "DAY_FIVE" }));
    expect(res).toEqual({ ok: false, error: "O parcelamento deve ter de 2 a 24 parcelas." });
    expect(await testDb.sale.count()).toBe(0);
  });

  it("edição com parcela paga redistribui o saldo nas parcelas em aberto", async () => {
    const res = await createSale(
      form({ paymentMode: "INSTALLMENTS", installmentCount: "3", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }),
    );
    const saleId = res.data!.id;
    await testDb.saleInstallment.update({
      where: { saleId_number: { saleId, number: 1 } },
      data: { paidAt: new Date() },
    });

    const upd = await updateSale(
      saleId,
      form({ paymentMode: "INSTALLMENTS", installmentCount: "3", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }, 12000),
    );
    expect(upd).toEqual({ ok: true });
    const parcels = await installmentsOf(saleId);
    expect(parcels.map((p) => [p.number, p.amountCents, p.paidAt !== null])).toEqual([
      [1, 3333, true],
      [2, 4333, false],
      [3, 4334, false],
    ]);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect([sale.totalCents, sale.openCents]).toEqual([12000, 8667]);
  });

  it("edição que reduz o total abaixo do pago é recusada e não altera itens nem estoque", async () => {
    const res = await createSale(
      form({ paymentMode: "INSTALLMENTS", installmentCount: "2", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }),
    );
    const saleId = res.data!.id;
    await testDb.saleInstallment.update({
      where: { saleId_number: { saleId, number: 1 } },
      data: { paidAt: new Date() },
    });

    const upd = await updateSale(
      saleId,
      form({ paymentMode: "INSTALLMENTS", installmentCount: "2", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }, 4000),
    );
    expect(upd).toEqual({ ok: false, error: "O novo total é menor que o valor já pago." });
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
    expect([sale.totalCents, sale.items.length]).toEqual([10000, 1]);
    expect(await testDb.stockMovement.count({ where: { saleId } })).toBe(1);
  });

  it("editar venda à vista já paga mantém a data de pagamento original", async () => {
    const res = await createSale(form({ paymentMode: "CASH", status: "PAID" }));
    const saleId = res.data!.id;
    const original = new Date(2026, 8, 1, 12);
    await testDb.saleInstallment.updateMany({ where: { saleId }, data: { paidAt: original } });
    await testDb.sale.update({ where: { id: saleId }, data: { paidAt: original } });

    await updateSale(saleId, form({ paymentMode: "CASH", status: "PAID", notes: "ajuste" }));

    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.paidAt).toEqual(original);
  });
});
