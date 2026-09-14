import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "" };

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
}));

const { getSalesForExport } = await import("./sales");

describe("getSalesForExport", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("devolve uma linha por venda, com valores formatados para CSV", async () => {
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    const user = await testDb.user.create({
      data: { id: `user-${workspace.id}`, name: "Dona", email: `dona-${workspace.id}@example.com` },
    });
    const customer = await testDb.customer.create({
      data: { workspaceId: workspace.id, name: "Ana" },
    });

    await testDb.sale.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        customerId: customer.id,
        status: "PAID",
        totalCents: 5000,
        soldAt: new Date("2026-09-05T12:00:00.000Z"),
      },
    });
    await testDb.sale.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        status: "PENDING",
        totalCents: 2000,
        soldAt: new Date("2026-09-06T12:00:00.000Z"),
        paymentForecastDate: new Date("2026-09-20T12:00:00.000Z"),
      },
    });

    const rows = await getSalesForExport();

    expect(rows).toEqual([
      {
        soldAt: "2026-09-05",
        customerName: "Ana",
        status: "Pago",
        totalCents: 5000,
        paymentForecastDate: "",
      },
      {
        soldAt: "2026-09-06",
        customerName: "Sem cliente",
        status: "Pendente",
        totalCents: 2000,
        paymentForecastDate: "2026-09-20",
      },
    ]);
  });
});
