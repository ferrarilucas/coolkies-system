import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "" };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({
    ...context,
    role: "OWNER",
    db: scopedDb(context.workspaceId),
  }),
}));

const { markSalesAsPaid } = await import("./sales");

async function seedUser(suffix: string) {
  return testDb.user.create({
    data: {
      id: `user-${suffix}`,
      name: "Dono",
      email: `dono-${suffix}@example.com`,
    },
  });
}

async function seedSale(
  workspaceId: string,
  userId: string,
  customerId: string,
  data: { totalCents: number; status?: "PAID" | "PENDING"; forecast?: Date },
) {
  return testDb.sale.create({
    data: {
      workspaceId,
      userId,
      customerId,
      totalCents: data.totalCents,
      status: data.status ?? "PENDING",
      paidAt: data.status === "PAID" ? new Date("2026-01-01T00:00:00Z") : null,
      paymentForecastDate: data.forecast ?? null,
    },
  });
}

describe("markSalesAsPaid", () => {
  let customerId = "";
  let userId = "";

  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Cookies");
    const user = await seedUser(workspace.id);
    context.workspaceId = workspace.id;
    context.userId = user.id;
    userId = user.id;
    const customer = await testDb.customer.create({
      data: { name: "Ana", workspaceId: workspace.id },
    });
    customerId = customer.id;
  });

  it("quita apenas as vendas selecionadas", async () => {
    const a = await seedSale(context.workspaceId, userId, customerId, { totalCents: 1000 });
    const b = await seedSale(context.workspaceId, userId, customerId, { totalCents: 2500 });
    const c = await seedSale(context.workspaceId, userId, customerId, { totalCents: 700 });

    const res = await markSalesAsPaid([a.id, b.id]);

    expect(res).toEqual({ ok: true, data: { count: 2, totalCents: 3500 } });

    const statuses = await testDb.sale.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      orderBy: { totalCents: "asc" },
      select: { status: true },
    });
    expect(statuses.map((s) => s.status)).toEqual(["PENDING", "PAID", "PAID"]);
  });

  it("registra a data de pagamento e limpa a previsão", async () => {
    const sale = await seedSale(context.workspaceId, userId, customerId, {
      totalCents: 1000,
      forecast: new Date("2026-09-05T00:00:00Z"),
    });

    await markSalesAsPaid([sale.id]);

    const updated = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(updated.paidAt).toBeInstanceOf(Date);
    expect(updated.paymentForecastDate).toBeNull();
  });

  it("ignora venda que já estava paga", async () => {
    const paid = await seedSale(context.workspaceId, userId, customerId, {
      totalCents: 5000,
      status: "PAID",
    });
    const pending = await seedSale(context.workspaceId, userId, customerId, { totalCents: 1000 });

    const res = await markSalesAsPaid([paid.id, pending.id]);

    expect(res.data).toEqual({ count: 1, totalCents: 1000 });
    const untouched = await testDb.sale.findUniqueOrThrow({ where: { id: paid.id } });
    expect(untouched.paidAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("não quita venda de outro workspace", async () => {
    const other = await createWorkspace("Outro");
    const otherUser = await seedUser(other.id);
    const otherCustomer = await testDb.customer.create({
      data: { name: "Intruso", workspaceId: other.id },
    });
    const alheia = await seedSale(other.id, otherUser.id, otherCustomer.id, { totalCents: 9999 });

    const res = await markSalesAsPaid([alheia.id]);

    expect(res.ok).toBe(false);
    const untouched = await testDb.sale.findUniqueOrThrow({ where: { id: alheia.id } });
    expect(untouched.status).toBe("PENDING");
  });

  it("recusa lista vazia", async () => {
    const res = await markSalesAsPaid([]);
    expect(res.ok).toBe(false);
  });
});
