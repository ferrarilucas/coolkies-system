import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMcpUserId, mcpErrorResponse } from "@/server/tenant/mcp-context";

const bodySchema = z.object({ workspaceId: z.string().min(1) });

export async function PUT(request: NextRequest) {
  try {
    const userId = await requireMcpUserId(request);
    const body = bodySchema.parse(await request.json());

    const membership = await db.member.findFirst({
      where: { userId, workspaceId: body.workspaceId },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
    });
    if (!membership) {
      return Response.json({ error: "Você não participa deste workspace." }, { status: 404 });
    }

    await db.mcpWorkspaceContext.upsert({
      where: { userId },
      create: { userId, workspaceId: body.workspaceId },
      update: { workspaceId: body.workspaceId },
    });

    return Response.json({
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      role: membership.role,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: "workspaceId é obrigatório." }, { status: 400 });
    }
    return mcpErrorResponse(e);
  }
}
