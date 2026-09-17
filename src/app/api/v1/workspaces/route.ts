import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireMcpUserId, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireMcpUserId(request);

    const [members, active] = await Promise.all([
      db.member.findMany({
        where: { userId },
        include: { workspace: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.mcpWorkspaceContext.findUnique({ where: { userId } }),
    ]);

    const activeWorkspaceId = active?.workspaceId ?? members[0]?.workspaceId ?? null;

    const workspaces = members.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      active: m.workspaceId === activeWorkspaceId,
    }));

    return Response.json({ workspaces });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
