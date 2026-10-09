import { NextRequest } from "next/server";
import { endOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";
import { dueByWhere, syncSaleSummary } from "@/server/sales/installments";

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((id: unknown): id is string => typeof id === "string") : null;
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const installmentIds = stringList(body.installmentIds);
    const saleId = typeof body.saleId === "string" ? body.saleId : null;
    const saleIds = stringList(body.saleIds);
    const customerId = typeof body.customerId === "string" ? body.customerId : null;

    if (!installmentIds && !saleId && !saleIds && !customerId) {
      return Response.json({ error: "Informe installmentIds, saleId, saleIds ou customerId." }, { status: 400 });
    }

    const target: Prisma.SaleInstallmentWhereInput = installmentIds
      ? { id: { in: installmentIds }, paidAt: null }
      : {
          paidAt: null,
          sale: customerId ? { customerId } : { id: { in: saleId ? [saleId] : saleIds! } },
        };
    const where: Prisma.SaleInstallmentWhereInput = installmentIds
      ? target
      : { ...target, ...dueByWhere(endOfDay(new Date())) };

    const open = await context.db.saleInstallment.findMany({
      where,
      select: { id: true, saleId: true, amountCents: true },
    });
    if (open.length === 0) {
      const futureCount = installmentIds ? 0 : await context.db.saleInstallment.count({ where: target });
      if (futureCount > 0) {
        return Response.json(
          { error: "Só há parcelas a vencer. Informe installmentIds para receber antecipado.", futureCount },
          { status: 409 },
        );
      }
      return Response.json({ error: "Nenhuma parcela em aberto encontrada." }, { status: 404 });
    }

    await context.db.$transaction(async (tx) => {
      await tx.saleInstallment.updateMany({
        where: { id: { in: open.map((i) => i.id) }, paidAt: null },
        data: { paidAt: new Date() },
      });
      await syncSaleSummary(tx, [...new Set(open.map((i) => i.saleId))]);
    });

    return Response.json({ count: open.length, totalCents: open.reduce((sum, i) => sum + i.amountCents, 0) });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
