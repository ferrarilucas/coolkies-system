import type { NextRequest } from "next/server";
import type { MemberRole, PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopedDb } from "./extension";
import { canWriteInWorkspace } from "./subscription";
import { NoWorkspaceError } from "./context";

export class McpAuthError extends Error {
  constructor() {
    super("Token inválido ou expirado.");
    this.name = "McpAuthError";
  }
}

export class McpRoleError extends Error {
  constructor() {
    super("Não autorizado.");
    this.name = "McpRoleError";
  }
}

export class McpReadOnlyError extends Error {
  constructor() {
    super("Este workspace está em modo somente leitura. Ative um plano para voltar a registrar.");
    this.name = "McpReadOnlyError";
  }
}

export async function requireMcpUserId(request: NextRequest): Promise<string> {
  const session = await auth.api.getMcpSession({ headers: request.headers });
  const userId = (session as { userId?: string } | null)?.userId;
  if (!userId) throw new McpAuthError();
  return userId;
}

export type McpWorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: MemberRole;
  canWrite: boolean;
  db: PrismaClient;
};

export async function getMcpWorkspaceContext(
  request: NextRequest,
  ...allowedRoles: MemberRole[]
): Promise<McpWorkspaceContext> {
  const userId = await requireMcpUserId(request);

  const saved = await db.mcpWorkspaceContext.findUnique({ where: { userId } });
  const membership =
    (saved
      ? await db.member.findFirst({ where: { userId, workspaceId: saved.workspaceId } })
      : null) ?? (await db.member.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }));

  if (!membership) throw new NoWorkspaceError();

  if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
    throw new McpRoleError();
  }

  const canWrite = await canWriteInWorkspace(membership.workspaceId);

  return {
    userId,
    workspaceId: membership.workspaceId,
    role: membership.role,
    canWrite,
    db: scopedDb(membership.workspaceId),
  };
}

export function assertMcpCanWrite(context: McpWorkspaceContext): void {
  if (!context.canWrite) throw new McpReadOnlyError();
}

export function mcpErrorResponse(e: unknown): Response {
  if (e instanceof McpAuthError) return Response.json({ error: e.message }, { status: 401 });
  if (e instanceof McpRoleError || e instanceof McpReadOnlyError) {
    return Response.json({ error: e.message }, { status: 403 });
  }
  if (e instanceof NoWorkspaceError) return Response.json({ error: e.message }, { status: 404 });
  console.error("mcpErrorResponse error:", e);
  return Response.json({ error: "Erro inesperado." }, { status: 500 });
}
