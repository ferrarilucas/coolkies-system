import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "", userId: "" };

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
}));

const { getCustomersWithBalance, getPendingSalesByCustomer, getCustomerSectors } =
  await import("./customers");

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000);

async function seedSale(
  customerId: string,
  data: { totalCents: number; status?: "PAID" | "PENDING"; forecast?: Date; soldAt?: Date },
) {
  return testDb.sale.create({
    data: {
      workspaceId: context.workspaceId,
      userId: context.userId,
      customerId,
      totalCents: data.totalCents,
      status: data.status ?? "PENDING",
      soldAt: data.soldAt ?? new Date(),
      paymentForecastDate: data.forecast ?? null,
    },
  });
}

describe("getCustomersWithBalance", () => {
  let ana = "";
  let bruno = "";

  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Cookies");
    const user = await testDb.user.create({
      data: { id: `user-${workspace.id}`, name: "Dono", email: `dono-${workspace.id}@ex.com` },
    });
    context.workspaceId = workspace.id;
    context.userId = user.id;

    ana = (
      await testDb.customer.create({
        data: {
          name: "Ana Souza",
          email: "ana@ex.com",
          phone: "11999990000",
          sector: "Empresa",
          workspaceId: workspace.id,
        },
      })
    ).id;
    bruno = (
      await testDb.customer.create({
        data: { name: "Bruno Lima", sector: "Pessoal", workspaceId: workspace.id },
      })
    ).id;
  });

  it("agrega o valor pendente de cada cliente e ignora vendas pagas", async () => {
    await seedSale(ana, { totalCents: 1000 });
    await seedSale(ana, { totalCents: 2500 });
    await seedSale(ana, { totalCents: 9999, status: "PAID" });

    const result = await getCustomersWithBalance({ situation: "all" });

    const anaRow = result.find((c) => c.id === ana);
    expect(anaRow?.pendingCents).toBe(3500);
    expect(anaRow?.pendingCount).toBe(2);
    expect(result.find((c) => c.id === bruno)?.pendingCents).toBe(0);
  });

  it("marca em atraso quem tem previsão vencida", async () => {
    await seedSale(ana, { totalCents: 1000, forecast: YESTERDAY });
    await seedSale(bruno, { totalCents: 1000, forecast: TOMORROW });

    const result = await getCustomersWithBalance({ situation: "overdue" });

    expect(result.map((c) => c.id)).toEqual([ana]);
  });

  it("filtra por valor devido mínimo", async () => {
    await seedSale(ana, { totalCents: 1000 });
    await seedSale(bruno, { totalCents: 20000 });

    const result = await getCustomersWithBalance({ situation: "all", minDueCents: 20000 });

    expect(result.map((c) => c.id)).toEqual([bruno]);
  });

  it("busca por nome, e-mail ou telefone", async () => {
    expect((await getCustomersWithBalance({ situation: "all", q: "souza" })).map((c) => c.id))
      .toEqual([ana]);
    expect((await getCustomersWithBalance({ situation: "all", q: "ana@ex" })).map((c) => c.id))
      .toEqual([ana]);
    expect((await getCustomersWithBalance({ situation: "all", q: "999990000" })).map((c) => c.id))
      .toEqual([ana]);
  });

  it("filtra por setor", async () => {
    const result = await getCustomersWithBalance({ situation: "all", sector: "Pessoal" });
    expect(result.map((c) => c.id)).toEqual([bruno]);
  });

  it("mantém a ordem alfabética por nome", async () => {
    const result = await getCustomersWithBalance({ situation: "all" });
    expect(result.map((c) => c.name)).toEqual(["Ana Souza", "Bruno Lima"]);
  });
});

describe("getPendingSalesByCustomer", () => {
  let ana = "";

  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Cookies");
    const user = await testDb.user.create({
      data: { id: `user-${workspace.id}`, name: "Dono", email: `dono-${workspace.id}@ex.com` },
    });
    context.workspaceId = workspace.id;
    context.userId = user.id;
    ana = (await testDb.customer.create({ data: { name: "Ana", workspaceId: workspace.id } })).id;
  });

  it("retorna apenas as vendas pendentes do cliente, da mais antiga para a mais recente", async () => {
    const nova = await seedSale(ana, { totalCents: 100, soldAt: new Date("2026-08-20T10:00:00Z") });
    const antiga = await seedSale(ana, { totalCents: 200, soldAt: new Date("2026-08-01T10:00:00Z") });
    await seedSale(ana, { totalCents: 300, status: "PAID" });

    const result = await getPendingSalesByCustomer(ana);

    expect(result.map((s) => s.id)).toEqual([antiga.id, nova.id]);
    expect(result[0].totalCents).toBe(200);
  });
});

describe("getCustomerSectors", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Cookies");
    context.workspaceId = workspace.id;
    await testDb.customer.createMany({
      data: [
        { name: "A", sector: "Empresa", workspaceId: workspace.id },
        { name: "B", sector: "Empresa", workspaceId: workspace.id },
        { name: "C", sector: "Pessoal", workspaceId: workspace.id },
        { name: "D", sector: null, workspaceId: workspace.id },
      ],
    });
  });

  it("lista os setores cadastrados sem repetição e sem vazios", async () => {
    expect(await getCustomerSectors()).toEqual(["Empresa", "Pessoal"]);
  });
});
