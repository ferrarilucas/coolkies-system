import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "" };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({ ...context, role: "OWNER", db: scopedDb(context.workspaceId) }),
  assertCanWrite: async () => {},
}));

const { payInstallments, unpayInstallments, payNextInstallment } = await import("./sales");

const due = (m: number) => new Date(2026, m, 5, 12);

describe("pagamento por parcela", () => {
  beforeEach(async () => {
    await resetDb();
    context.workspaceId = (await createWorkspace("Cookies")).id;
  });

  async function threeParcels() {
    return seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [
        { amountCents: 3333, dueDate: due(10) },
        { amountCents: 3333, dueDate: due(11) },
        { amountCents: 3334, dueDate: due(12) },
      ],
    });
  }

  it("pagar uma parcela não quita a venda", async () => {
    const sale = await threeParcels();
    const res = await payInstallments([sale.installments[0].id]);
    expect(res).toEqual({ ok: true, data: { count: 1, totalCents: 3333 } });
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paymentForecastDate]).toEqual(["PENDING", 6667, due(11)]);
  });

  it("pagar todas quita a venda", async () => {
    const sale = await threeParcels();
    await payInstallments(sale.installments.map((i) => i.id));
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paidAt !== null]).toEqual(["PAID", 0, true]);
  });

  it("pagar de novo a mesma parcela não muda a data nem soma valor", async () => {
    const sale = await threeParcels();
    await payInstallments([sale.installments[0].id]);
    const first = await testDb.saleInstallment.findUniqueOrThrow({ where: { id: sale.installments[0].id } });
    const res = await payInstallments([sale.installments[0].id]);
    expect(res).toEqual({ ok: false, error: "Nenhuma parcela em aberto selecionada." });
    const again = await testDb.saleInstallment.findUniqueOrThrow({ where: { id: sale.installments[0].id } });
    expect(again.paidAt).toEqual(first.paidAt);
  });

  it("desfazer reabre a parcela e a venda", async () => {
    const sale = await threeParcels();
    await payInstallments(sale.installments.map((i) => i.id));
    expect(await unpayInstallments([sale.installments[2].id])).toEqual({ ok: true });
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paymentForecastDate]).toEqual(["PENDING", 3334, due(12)]);
  });

  it("payNextInstallment paga a primeira parcela em aberto", async () => {
    const sale = await threeParcels();
    await payInstallments([sale.installments[0].id]);
    const res = await payNextInstallment(sale.id);
    expect(res).toEqual({
      ok: true,
      data: { installmentId: sale.installments[1].id, number: 2, installmentCount: 3, amountCents: 3333 },
    });
  });

  it("não paga parcela de outro workspace", async () => {
    const other = await createWorkspace("Outra");
    const foreign = await seedParceledSale({ workspaceId: other.id, parcels: [{ amountCents: 1000, dueDate: due(10) }] });
    const res = await payInstallments([foreign.installments[0].id]);
    expect(res).toEqual({ ok: false, error: "Nenhuma parcela em aberto selecionada." });
  });

  it("recusa lista vazia", async () => {
    expect(await payInstallments([])).toEqual({ ok: false, error: "Selecione ao menos uma parcela." });
  });
});
