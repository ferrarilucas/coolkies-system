import { beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { seedParceledSale } from "@/test/sales";

const due = (m: number) => new Date(2026, m, 5, 12);

describe("installment_split", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("split é apagado junto com a parcela recebida", async () => {
    const workspace = await createWorkspace("Cookies");
    const sale = await seedParceledSale({
      workspaceId: workspace.id,
      parcels: [
        { amountCents: 5000, dueDate: due(10) },
        { amountCents: 5000, dueDate: due(11) },
      ],
    });
    await testDb.installmentSplit.create({
      data: {
        saleId: sale.id,
        paidInstallmentId: sale.installments[0].id,
        originalCents: 5000,
        mode: "SPREAD",
        shares: [{ installmentId: sale.installments[1].id, cents: 2000, created: false }],
        workspaceId: workspace.id,
      },
    });
    expect(await testDb.installmentSplit.count()).toBe(1);

    await testDb.saleInstallment.delete({ where: { id: sale.installments[0].id } });

    expect(await testDb.installmentSplit.count()).toBe(0);
  });
});
