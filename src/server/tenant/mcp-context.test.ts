import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { getMcpWorkspaceContext, assertMcpCanWrite, McpAuthError, McpRoleError, McpReadOnlyError } = await import(
  "./mcp-context"
);
const { NoWorkspaceError } = await import("./context");

function fakeRequest(): NextRequest {
  return new Request("http://localhost/api/v1/items") as unknown as NextRequest;
}

describe("getMcpWorkspaceContext", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("lança McpAuthError sem sessão MCP válida", async () => {
    await expect(getMcpWorkspaceContext(fakeRequest())).rejects.toThrow(McpAuthError);
  });

  it("usa o workspace salvo em McpWorkspaceContext quando existe", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const ws1 = await createWorkspace("Loja 1");
    const ws2 = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws2.id, role: "MEMBER" } });
    await testDb.mcpWorkspaceContext.create({ data: { userId: user.id, workspaceId: ws2.id } });
    mcpSessionResult = { userId: user.id };

    const context = await getMcpWorkspaceContext(fakeRequest());

    expect(context.workspaceId).toBe(ws2.id);
    expect(context.role).toBe("MEMBER");
  });

  it("cai para o primeiro workspace do usuário quando não há contexto salvo", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const ws1 = await createWorkspace("Loja A");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    mcpSessionResult = { userId: user.id };

    const context = await getMcpWorkspaceContext(fakeRequest());

    expect(context.workspaceId).toBe(ws1.id);
  });

  it("lança NoWorkspaceError quando o usuário não pertence a nenhum workspace", async () => {
    const user = await testDb.user.create({ data: { id: "u3", name: "Caio", email: "caio@example.com" } });
    mcpSessionResult = { userId: user.id };

    await expect(getMcpWorkspaceContext(fakeRequest())).rejects.toThrow(NoWorkspaceError);
  });

  it("lança McpRoleError quando o papel não está entre os permitidos", async () => {
    const user = await testDb.user.create({ data: { id: "u4", name: "Duda", email: "duda@example.com" } });
    const ws1 = await createWorkspace("Loja B");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    await expect(getMcpWorkspaceContext(fakeRequest(), "OWNER", "ADMIN")).rejects.toThrow(McpRoleError);
  });
});

describe("assertMcpCanWrite", () => {
  it("lança McpReadOnlyError quando canWrite é false", () => {
    expect(() =>
      assertMcpCanWrite({
        userId: "u1",
        workspaceId: "w1",
        role: "OWNER",
        canWrite: false,
        db: testDb as never,
      }),
    ).toThrow(McpReadOnlyError);
  });
});
