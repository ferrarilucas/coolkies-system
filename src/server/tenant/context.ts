import { cache } from "react";
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

export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
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
});

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

export async function getScopedDb(...allowedRoles: MemberRole[]): Promise<ScopedDb> {
  const context = await getWorkspaceContext();
  if (allowedRoles.length > 0 && !allowedRoles.includes(context.role)) {
    throw new Error("Não autorizado");
  }
  return { ...context, db: scopedDb(context.workspaceId) };
}
