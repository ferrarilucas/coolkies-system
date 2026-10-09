import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";
import { computeSalesSummary } from "./sales";

describe("computeSalesSummary", () => {
  let workspaceId = "";
  beforeEach(async () => {
    await resetDb();
    workspaceId = (await createWorkspace("Resumo")).id;
  });

  it("pendente soma só o em aberto; vencido soma só parcelas vencidas; recebido inclui parcelas pagas", async () => {
    const past = new Date(Date.now() - 10 * 86400000);
    const future = new Date(Date.now() + 40 * 86400000);
    await seedParceledSale({
      workspaceId,
      parcels: [
        { amountCents: 3000, dueDate: past, paidAt: past },
        { amountCents: 3000, dueDate: past },
        { amountCents: 4000, dueDate: future },
      ],
    });

    const summary = await computeSalesSummary(scopedDb(workspaceId), {});

    expect(summary).toEqual({
      pendingCents: 7000,
      pendingCount: 1,
      paidCents: 3000,
      paidCount: 0,
      overdueCents: 3000,
      overdueCount: 1,
    });
  });
});
