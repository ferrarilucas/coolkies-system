import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET } = await import("./route");

function req(): NextRequest {
  return new NextRequest("http://localhost/api/v1/workspaces");
}

describe("GET /api/v1/workspaces", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("retorna 401 sem sessão MCP", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("lista os workspaces do usuário com o papel e qual está ativo", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const ws1 = await createWorkspace("Loja 1");
    const ws2 = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws2.id, role: "MEMBER" } });
    await testDb.mcpWorkspaceContext.create({ data: { userId: user.id, workspaceId: ws2.id } });
    mcpSessionResult = { userId: user.id };

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspaces).toHaveLength(2);
    const active = body.workspaces.find((w: { active: boolean }) => w.active);
    expect(active.id).toBe(ws2.id);
  });
});
