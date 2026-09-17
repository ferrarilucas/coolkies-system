import { NextRequest } from "next/server";
import { BaseUnit } from "@prisma/client";
import { normalizeName } from "@/lib/text";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const items = await db.item.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        sellable: true,
        productionInput: true,
        minStock: true,
      },
    });
    return Response.json({ items });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

function parseUnit(value: unknown): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request, "OWNER", "ADMIN");
    assertMcpCanWrite(context);

    const body = await request.json();
    const name = normalizeName(String(body.name ?? ""));
    const unit = parseUnit(body.unit);
    const minStock =
      typeof body.minStock === "number" && !Number.isNaN(body.minStock) ? body.minStock : null;
    const productionInput = Boolean(body.productionInput);
    const sellable = Boolean(body.sellable);

    if (!name) return Response.json({ error: "Nome obrigatório." }, { status: 400 });
    if (!productionInput && !sellable) {
      return Response.json({ error: "Marque insumo de produção e/ou venda." }, { status: 400 });
    }
    if (sellable && unit !== BaseUnit.UN) {
      return Response.json(
        { error: 'Venda só é permitida para itens com unidade "Unidade (un)".' },
        { status: 400 },
      );
    }

    try {
      const item = await context.db.item.create({
        data: { name, unit, minStock, productionInput, sellable, workspaceId: context.workspaceId },
      });
      return Response.json({ item }, { status: 201 });
    } catch {
      return Response.json({ error: "Já existe um item com esse nome." }, { status: 409 });
    }
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
