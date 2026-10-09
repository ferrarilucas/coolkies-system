import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace, backfillSaleInstallments } from "@/test/db";
import { seedParceledSale } from "@/test/sales";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { POST } = await import("./route");

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/sales/mark-paid", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/v1/sales/mark-paid", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("marca todas as vendas pendentes de um cliente como pagas", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const owner = await testDb.user.create({ data: { id: "u1o", name: "Bruno", email: "bruno@example.com" } });
    const ws = await createWorkspace("Loja 1");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" },
    });
    const customer = await testDb.customer.create({ data: { name: "Maria", workspaceId: ws.id } });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: ws.id, customerId: customer.id, status: "PENDING", totalCents: 2000, soldAt: new Date() },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: ws.id, customerId: customer.id, status: "PENDING", totalCents: 3000, soldAt: new Date() },
    });
    await backfillSaleInstallments();
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ customerId: customer.id }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.totalCents).toBe(5000);

    const remaining = await testDb.sale.count({ where: { customerId: customer.id, status: "PENDING" } });
    expect(remaining).toBe(0);
  });

  it("retorna 404 quando não há venda pendente encontrada", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const owner = await testDb.user.create({ data: { id: "u2o", name: "Breno", email: "breno@example.com" } });
    const ws = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" },
    });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ saleId: "inexistente" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Nenhuma parcela em aberto encontrada." });
  });

  it("retorna 400 quando nenhum identificador é informado", async () => {
    const user = await testDb.user.create({ data: { id: "u3", name: "Caio", email: "caio@example.com" } });
    const owner = await testDb.user.create({ data: { id: "u3o", name: "Duda", email: "duda@example.com" } });
    const ws = await createWorkspace("Loja 3");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" },
    });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Informe installmentIds, saleId, saleIds ou customerId." });
  });

  it("por cliente quita só parcelas vencidas e deixa as futuras em aberto", async () => {
    const user = await testDb.user.create({ data: { id: "u3", name: "Ana", email: "ana3@example.com" } });
    const owner = await testDb.user.create({ data: { id: "u3o", name: "Bruno", email: "bruno3@example.com" } });
    const ws = await createWorkspace("Loja 3");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({ data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" } });
    const customer = await testDb.customer.create({ data: { name: "Maria", workspaceId: ws.id } });
    const sale = await seedParceledSale({
      workspaceId: ws.id,
      customerId: customer.id,
      parcels: [
        { amountCents: 1000, dueDate: new Date(Date.now() - 5 * 86400000) },
        { amountCents: 1000, dueDate: new Date(Date.now() + 25 * 86400000) },
      ],
    });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ customerId: customer.id }));

    expect(await res.json()).toEqual({ count: 1, totalCents: 1000 });
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents]).toEqual(["PENDING", 1000]);
  });

  it("quita parcela futura quando informada por installmentIds", async () => {
    const user = await testDb.user.create({ data: { id: "u4", name: "Ana", email: "ana4@example.com" } });
    const owner = await testDb.user.create({ data: { id: "u4o", name: "Bruno", email: "bruno4@example.com" } });
    const ws = await createWorkspace("Loja 4");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({ data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" } });
    const sale = await seedParceledSale({
      workspaceId: ws.id,
      parcels: [{ amountCents: 1500, dueDate: new Date(Date.now() + 25 * 86400000) }],
    });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ installmentIds: [sale.installments[0].id] }));

    expect(await res.json()).toEqual({ count: 1, totalCents: 1500 });
  });
});
