import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { PUT } = await import("./route");

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/workspaces/active", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("PUT /api/v1/workspaces/active", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("troca o workspace ativo quando o usuário é membro", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const ws1 = await createWorkspace("Loja 1");
    const ws2 = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws2.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    const res = await PUT(req({ workspaceId: ws2.id }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(ws2.id);

    const saved = await testDb.mcpWorkspaceContext.findUnique({ where: { userId: user.id } });
    expect(saved?.workspaceId).toBe(ws2.id);
  });

  it("retorna 404 quando o usuário não participa do workspace", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const otherWs = await createWorkspace("Loja de outra pessoa");
    mcpSessionResult = { userId: user.id };

    const res = await PUT(req({ workspaceId: otherWs.id }));
    expect(res.status).toBe(404);
  });
});
