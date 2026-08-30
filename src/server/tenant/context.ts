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

export class NoWorkspaceError extends Error {
  constructor() {
    super("Nenhum workspace disponível");
    this.name = "NoWorkspaceError";
  }
}

export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");

  const activeId = (session.session as { activeWorkspaceId?: string | null })
    .activeWorkspaceId;

  const membership = activeId
    ? await db.member.findFirst({
        where: { userId: session.user.id, workspaceId: activeId },
      })
    : null;

  const fallback =
    membership ??
    (await db.member.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
    }));

  if (!fallback) throw new NoWorkspaceError();

  return {
    userId: session.user.id,
    workspaceId: fallback.workspaceId,
    role: fallback.role,
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
