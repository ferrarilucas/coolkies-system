import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET, POST } = await import("./route");

async function seedOwner() {
  const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
  const ws = await createWorkspace("Loja 1");
  await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "OWNER" } });
  await testDb.subscription.create({
    data: { userId: user.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" },
  });
  mcpSessionResult = { userId: user.id };
  return { user, ws };
}

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/items");
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/items", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/items", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("lista os itens ativos do workspace ativo", async () => {
    const { ws } = await seedOwner();
    await testDb.item.create({ data: { name: "Açúcar", unit: "G", productionInput: true, workspaceId: ws.id } });

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Açúcar");
  });
});

describe("POST /api/v1/items", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("cria um item vendável", async () => {
    await seedOwner();

    const res = await POST(postReq({ name: "Refrigerante", unit: "UN", sellable: true, productionInput: false }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.item.sellable).toBe(true);
  });

  it("recusa item sem nenhuma finalidade marcada", async () => {
    await seedOwner();

    const res = await POST(postReq({ name: "Sem finalidade", unit: "G", sellable: false, productionInput: false }));
    expect(res.status).toBe(400);
  });

  it("recusa item vendável com unidade diferente de UN", async () => {
    await seedOwner();

    const res = await POST(postReq({ name: "Errado", unit: "G", sellable: true, productionInput: false }));
    expect(res.status).toBe(400);
  });

  it("retorna 403 quando o papel não é OWNER/ADMIN", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const ws = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ name: "Item", unit: "UN", sellable: true, productionInput: false }));
    expect(res.status).toBe(403);
  });
});
