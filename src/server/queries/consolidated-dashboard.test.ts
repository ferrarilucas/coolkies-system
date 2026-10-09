import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace, backfillSaleInstallments } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { getConsolidatedSummary } from "./consolidated-dashboard";

describe("getConsolidatedSummary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("soma o faturamento pago de vários workspaces, ignorando o pendente e fora do período", async () => {
    const wsA = await createWorkspace("Loja A");
    const wsB = await createWorkspace("Loja B");
    const user = await testDb.user.create({
      data: { id: "u-consolidado", name: "Dona", email: "dona@example.com" },
    });

    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-30T23:59:59.999Z");

    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsA.id, status: "PAID", totalCents: 1000, soldAt: new Date("2026-09-05") },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsA.id, status: "PENDING", totalCents: 5000, soldAt: new Date("2026-09-06") },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsB.id, status: "PAID", totalCents: 3000, soldAt: new Date("2026-09-10") },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsB.id, status: "PAID", totalCents: 3000, soldAt: new Date("2026-08-10") },
    });

    await backfillSaleInstallments();
    const result = await getConsolidatedSummary(
      [
        { id: wsA.id, name: "Loja A" },
        { id: wsB.id, name: "Loja B" },
      ],
      { from, to },
    );

    expect(result).toEqual([
      { workspaceId: wsA.id, workspaceName: "Loja A", paidRevenueCents: 1000, salesCount: 1, avgTicketCents: 1000 },
      { workspaceId: wsB.id, workspaceName: "Loja B", paidRevenueCents: 3000, salesCount: 1, avgTicketCents: 3000 },
    ]);
  });

  it("conta no faturamento pago só as parcelas já recebidas", async () => {
    const ws = await createWorkspace("Loja C");
    await seedParceledSale({
      workspaceId: ws.id,
      soldAt: new Date("2026-09-05T12:00:00Z"),
      parcels: [
        { amountCents: 2000, dueDate: new Date("2026-09-05T12:00:00Z"), paidAt: new Date("2026-09-05T12:00:00Z") },
        { amountCents: 2000, dueDate: new Date("2026-10-05T12:00:00Z") },
      ],
    });

    const [summary] = await getConsolidatedSummary([{ id: ws.id, name: "Loja C" }], {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-30T23:59:59.999Z"),
    });

    expect(summary).toMatchObject({ paidRevenueCents: 2000, salesCount: 1, avgTicketCents: 2000 });
  });
});
