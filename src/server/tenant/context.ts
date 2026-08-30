import { headers } from "next/headers";
import type { MemberRole, PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopedDb } from "./extension";

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: MemberRole;
};

export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");

  const membership = await db.member.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new Error("Nenhum workspace disponível");

  return {
    userId: session.user.id,
    workspaceId: membership.workspaceId,
    role: membership.role,
  };
}

export async function getWorkspaceDb(): Promise<PrismaClient> {
  const { workspaceId } = await getWorkspaceContext();
  return scopedDb(workspaceId);
}

export async function requireRole(...allowed: MemberRole[]): Promise<WorkspaceContext> {
  const context = await getWorkspaceContext();
  if (!allowed.includes(context.role)) throw new Error("Não autorizado");
  return context;
}

export type ScopedDb = WorkspaceContext & { db: PrismaClient };

export async function getScopedDb(): Promise<ScopedDb> {
  const context = await getWorkspaceContext();
  return { ...context, db: scopedDb(context.workspaceId) };
}
