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

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/shopping-list");
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/shopping-list", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/shopping-list", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("lista os itens pendentes", async () => {
    const { ws } = await seedMember();
    await testDb.shoppingListItem.create({ data: { label: "Farinha", workspaceId: ws.id } });
    await testDb.shoppingListItem.create({ data: { label: "Já comprado", done: true, workspaceId: ws.id } });

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe("Farinha");
  });
});

describe("POST /api/v1/shopping-list", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("adiciona um item com descrição", async () => {
    await seedMember();

    const res = await POST(postReq({ label: "Ovos", quantity: 30, unit: "UN" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.item.label).toBe("Ovos");
    expect(body.item.quantity).toBe(30);
  });

  it("recusa item sem descrição", async () => {
    await seedMember();

    const res = await POST(postReq({ label: "" }));
    expect(res.status).toBe(400);
  });
});
