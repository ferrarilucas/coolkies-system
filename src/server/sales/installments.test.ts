import { beforeEach, describe, expect, it } from "vitest";
import { backfillSaleInstallments, createWorkspace, resetDb, testDb } from "@/test/db";
import { syncSaleSummary, writeInstallments } from "./installments";

describe("parcelas no banco", () => {
  let workspaceId = "";

  beforeEach(async () => {
    await resetDb();
    workspaceId = (await createWorkspace("Parcelas")).id;
  });

  it("backfill cria uma parcela por venda legada com o resumo coerente", async () => {
    const forecast = new Date(2026, 10, 5, 12);
    const pending = await testDb.sale.create({
      data: { workspaceId, totalCents: 5000, status: "PENDING", paymentForecastDate: forecast, forecastPreset: "DAY_FIVE" },
    });
    const paid = await testDb.sale.create({ data: { workspaceId, totalCents: 3000, status: "PAID", paidAt: null } });

    await backfillSaleInstallments();

    const rows = await testDb.saleInstallment.findMany({ orderBy: { amountCents: "asc" } });
    expect(rows.map((r) => [r.saleId, r.number, r.amountCents, r.dueDate, r.paidAt !== null])).toEqual([
      [paid.id, 1, 3000, null, true],
      [pending.id, 1, 5000, forecast, false],
    ]);
    const sales = await testDb.sale.findMany({ orderBy: { totalCents: "asc" }, select: { openCents: true } });
    expect(sales.map((s) => s.openCents)).toEqual([0, 5000]);
  });

  it("writeInstallments troca as parcelas e grava o resumo; syncSaleSummary recalcula após pagamento", async () => {
    const sale = await testDb.sale.create({ data: { workspaceId, totalCents: 10000 } });
    const due = (m: number) => new Date(2026, m, 5, 12);

    await testDb.$transaction((tx) =>
      writeInstallments(tx, sale.id, workspaceId, [
        { number: 1, amountCents: 3333, dueDate: due(10), forecastPreset: "DAY_FIVE", paidAt: null },
        { number: 2, amountCents: 3333, dueDate: due(11), forecastPreset: "DAY_FIVE", paidAt: null },
        { number: 3, amountCents: 3334, dueDate: due(12), forecastPreset: "DAY_FIVE", paidAt: null },
      ]),
    );

    let saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.installmentCount, saved.paymentForecastDate]).toEqual([
      "PENDING",
      10000,
      3,
      due(10),
    ]);

    await testDb.saleInstallment.update({
      where: { saleId_number: { saleId: sale.id, number: 1 } },
      data: { paidAt: new Date() },
    });
    await testDb.$transaction((tx) => syncSaleSummary(tx, [sale.id]));

    saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paymentForecastDate]).toEqual(["PENDING", 6667, due(11)]);
  });
});
