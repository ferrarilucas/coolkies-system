import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET, POST } = await import("./route");

async function seedMember() {
  const member = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
  const owner = await testDb.user.create({ data: { id: "u2", name: "Bruno", email: "bruno@example.com" } });
  const ws = await createWorkspace("Loja 1");
  await testDb.member.create({ data: { userId: member.id, workspaceId: ws.id, role: "MEMBER" } });
  await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
  await testDb.subscription.create({
    data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" },
  });
  mcpSessionResult = { userId: member.id };
  return { user: member, ws };
}

function getReq(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/sales${query}`);
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/sales", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/sales", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("filtra por customerId e status, e soma o resumo pendente", async () => {
    const { user, ws } = await seedMember();
    const customer = await testDb.customer.create({ data: { name: "Maria", workspaceId: ws.id } });
    await testDb.sale.create({
      data: {
        userId: user.id,
        workspaceId: ws.id,
        customerId: customer.id,
        status: "PENDING",
        totalCents: 5000,
        soldAt: new Date(),
      },
    });
    await testDb.sale.create({
      data: {
        userId: user.id,
        workspaceId: ws.id,
        customerId: customer.id,
        status: "PAID",
        totalCents: 3000,
        soldAt: new Date(),
      },
    });

    const res = await GET(getReq(`?customerId=${customer.id}&status=PENDING`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sales).toHaveLength(1);
    expect(body.summary.pendingCents).toBe(5000);
  });
});

describe("POST /api/v1/sales", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("cria uma venda com itens e desconta do estoque", async () => {
    const { ws } = await seedMember();
    const item = await testDb.item.create({ data: { name: "Bolo", unit: "UN", sellable: true, workspaceId: ws.id } });

    const res = await POST(
      postReq({
        customerName: "Cliente Avulso",
        items: [
          { itemId: item.id, productName: "Bolo", variantId: null, flavorName: null, quantity: 2, unitPriceCents: 1500 },
        ],
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.sale.totalCents).toBe(3000);

    const movement = await testDb.stockMovement.findFirst({ where: { saleId: body.sale.id } });
    expect(movement?.quantity).toBe(-2);
  });

  it("recusa venda sem itens", async () => {
    await seedMember();

    const res = await POST(postReq({ items: [] }));
    expect(res.status).toBe(400);
  });
});
