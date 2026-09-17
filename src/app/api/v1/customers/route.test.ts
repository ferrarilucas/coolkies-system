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
  return new NextRequest(`http://localhost/api/v1/customers${query}`);
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/customers", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/customers", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("busca por telefone", async () => {
    const { ws } = await seedMember();
    await testDb.customer.create({ data: { name: "Maria", phone: "11999998888", workspaceId: ws.id } });
    await testDb.customer.create({ data: { name: "João", phone: "11777776666", workspaceId: ws.id } });

    const res = await GET(getReq("?q=9999"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].name).toBe("Maria");
  });

  it("sem query lista até 20 clientes", async () => {
    await seedMember();

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customers).toEqual([]);
  });
});

describe("POST /api/v1/customers", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("cria um cliente", async () => {
    await seedMember();

    const res = await POST(postReq({ name: "Nova Cliente", email: "nova@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.customer.name).toBe("Nova Cliente");
  });

  it("recusa e-mail duplicado no mesmo workspace", async () => {
    const { ws } = await seedMember();
    await testDb.customer.create({ data: { name: "Existente", email: "dup@example.com", workspaceId: ws.id } });

    const res = await POST(postReq({ name: "Outra", email: "dup@example.com" }));
    expect(res.status).toBe(409);
  });

  it("recusa cliente sem nome", async () => {
    await seedMember();

    const res = await POST(postReq({ name: "" }));
    expect(res.status).toBe(400);
  });
});
