import { NextRequest } from "next/server";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const saleId = typeof body.saleId === "string" ? body.saleId : null;
    const saleIds = Array.isArray(body.saleIds)
      ? body.saleIds.filter((id: unknown): id is string => typeof id === "string")
      : null;
    const customerId = typeof body.customerId === "string" ? body.customerId : null;

    if (!saleId && !saleIds && !customerId) {
      return Response.json({ error: "Informe saleId, saleIds ou customerId." }, { status: 400 });
    }

    const where = customerId
      ? { customerId, status: "PENDING" as const }
      : { id: { in: saleId ? [saleId] : saleIds! }, status: "PENDING" as const };

    const pending = await context.db.sale.aggregate({
      where,
      _sum: { totalCents: true },
      _count: { _all: true },
    });

    if (pending._count._all === 0) {
      return Response.json({ error: "Nenhuma venda pendente encontrada." }, { status: 404 });
    }

    await context.db.sale.updateMany({
      where,
      data: { status: "PAID", paidAt: new Date(), paymentForecastDate: null, forecastPreset: null },
    });

    return Response.json({ count: pending._count._all, totalCents: pending._sum.totalCents ?? 0 });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
