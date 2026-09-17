import { NextRequest } from "next/server";
import { BaseUnit } from "@prisma/client";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const items = await db.shoppingListItem.findMany({
      where: { done: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, itemId: true, label: true, quantity: true, unit: true },
    });
    return Response.json({ items });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const itemId = typeof body.itemId === "string" && body.itemId.trim() ? body.itemId : null;
    const label = String(body.label ?? "").trim();
    const quantity =
      typeof body.quantity === "number" && !Number.isNaN(body.quantity) ? body.quantity : null;
    const unit = typeof body.unit === "string" && body.unit ? (body.unit as BaseUnit) : null;

    if (!label) return Response.json({ error: "Descreva o item." }, { status: 400 });

    if (itemId) {
      const found = await context.db.item.findFirst({ where: { id: itemId } });
      if (!found) return Response.json({ error: "Item não encontrado." }, { status: 400 });
    }

    const created = await context.db.shoppingListItem.create({
      data: { itemId, label, quantity, unit, workspaceId: context.workspaceId },
    });
    return Response.json({ item: created }, { status: 201 });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
