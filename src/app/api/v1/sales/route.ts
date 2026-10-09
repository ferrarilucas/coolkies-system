import { NextRequest } from "next/server";
import { StockMovementType } from "@prisma/client";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";
import { MAX_INSTALLMENTS, parsePaymentChoice, planPayment } from "@/lib/installments";
import { writeInstallments } from "@/server/sales/installments";
import { buildSalesWhere, computeSalesSummary, type SalesFilters } from "@/server/queries/sales";

function parseDateOnly(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function parseFilterDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = parseDateOnly(value);
  return isValidDate(date) ? date : undefined;
}

function parseFilters(searchParams: URLSearchParams): SalesFilters {
  const status = searchParams.get("status");
  return {
    status: status === "PAID" || status === "PENDING" ? status : undefined,
    q: searchParams.get("q") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    from: parseFilterDate(searchParams.get("from")),
    to: parseFilterDate(searchParams.get("to")),
    forecastFrom: parseFilterDate(searchParams.get("forecastFrom")),
    forecastTo: parseFilterDate(searchParams.get("forecastTo")),
    overdueOnly: searchParams.get("overdueOnly") === "true",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const filters = parseFilters(request.nextUrl.searchParams);
    const where = buildSalesWhere(filters);
    const summaryWhere = buildSalesWhere({ ...filters, status: undefined, overdueOnly: undefined });

    const [sales, summary] = await Promise.all([
      db.sale.findMany({
        where,
        orderBy: { soldAt: "desc" },
        take: 50,
        include: {
          items: {
            select: { quantity: true, unitPriceSnapshot: true, productNameSnapshot: true, variantNameSnapshot: true },
          },
          installments: {
            orderBy: { number: "asc" },
            select: { id: true, number: true, amountCents: true, dueDate: true, paidAt: true },
          },
        },
      }),
      computeSalesSummary(db, summaryWhere),
    ]);

    return Response.json({
      sales: sales.map((sale) => ({
        ...sale,
        items: sale.items.map((item) => ({ ...item, flavorNameSnapshot: item.variantNameSnapshot })),
      })),
      summary,
    });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

type SaleItemInput = {
  itemId: string;
  productName: string;
  variantId: string | null;
  variantName?: string | null;
  flavorName?: string | null;
  quantity: number;
  unitPriceCents: number;
};

function calcDiscountCents(subtotal: number, type: "PERCENTAGE" | "FIXED" | null, value: number): number {
  if (!type || value <= 0) return 0;
  if (type === "PERCENTAGE") return Math.round((subtotal * value) / 100);
  return Math.min(value, subtotal);
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const customerId = typeof body.customerId === "string" && body.customerId ? body.customerId : null;
    const customerName =
      typeof body.customerName === "string" && body.customerName.trim() ? body.customerName.trim() : null;

    let soldAt = new Date();
    if (typeof body.soldAt === "string" && body.soldAt.trim()) {
      const parsed = parseDateOnly(body.soldAt.trim());
      if (!isValidDate(parsed)) return Response.json({ error: "Data inválida." }, { status: 400 });
      soldAt = parsed;
    }

    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    let forecastDate: Date | null = null;
    if (typeof body.forecastDate === "string" && body.forecastDate.trim()) {
      const parsed = parseDateOnly(body.forecastDate.trim());
      if (!isValidDate(parsed)) return Response.json({ error: "Data inválida." }, { status: 400 });
      forecastDate = parsed;
    }
    const count = body.installments === undefined ? 1 : Number(body.installments);
    if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
      return Response.json({ error: `installments deve ser um inteiro de 1 a ${MAX_INSTALLMENTS}.` }, { status: 400 });
    }
    const choice = parsePaymentChoice({
      mode: count > 1 ? "INSTALLMENTS" : "CASH",
      status: count > 1 ? "PENDING" : body.status === "PENDING" ? "PENDING" : "PAID",
      count,
      preset: typeof body.forecastPreset === "string" ? body.forecastPreset : "",
      dueDate: forecastDate,
    });
    if ("error" in choice) return Response.json({ error: choice.error }, { status: 400 });

    const discountType: "PERCENTAGE" | "FIXED" | null =
      body.discountType === "PERCENTAGE" || body.discountType === "FIXED" ? body.discountType : null;
    const discountValue = discountType ? Math.max(0, Number(body.discountValue) || 0) : 0;

    const items = Array.isArray(body.items) ? (body.items as SaleItemInput[]) : [];
    if (items.length === 0) {
      return Response.json({ error: "Adicione pelo menos um item." }, { status: 400 });
    }

    if (customerId) {
      const customer = await context.db.customer.findFirst({ where: { id: customerId } });
      if (!customer) return Response.json({ error: "Cliente não encontrado." }, { status: 400 });
    }

    for (const item of items) {
      const foundItem = await context.db.item.findFirst({ where: { id: item.itemId } });
      if (!foundItem) return Response.json({ error: "Item não encontrado." }, { status: 400 });

      if (item.variantId) {
        const variant = await context.db.variant.findFirst({ where: { id: item.variantId } });
        if (!variant) return Response.json({ error: "Variante não encontrada." }, { status: 400 });
      }
    }

    const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    const discountCents = calcDiscountCents(subtotalCents, discountType, discountValue);
    const totalCents = subtotalCents - discountCents;

    const plan = planPayment(choice, totalCents, [], new Date());
    if (!plan.ok) return Response.json({ error: plan.error }, { status: 400 });

    const sale = await context.db.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          userId: context.userId,
          customerId,
          customerName,
          soldAt,
          notes,
          discountType,
          discountValue,
          totalCents,
          workspaceId: context.workspaceId,
          items: {
            create: items.map((item) => ({
              itemId: item.itemId,
              productNameSnapshot: item.productName,
              variantId: item.variantId,
              variantNameSnapshot: item.variantName ?? item.flavorName ?? null,
              quantity: item.quantity,
              unitPriceSnapshot: item.unitPriceCents,
              workspaceId: context.workspaceId,
            })),
          },
        },
      });
      for (const item of items) {
        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            variantId: item.variantId,
            type: StockMovementType.SALE,
            quantity: -item.quantity,
            saleId: created.id,
            workspaceId: context.workspaceId,
          },
        });
      }
      await writeInstallments(tx, created.id, context.workspaceId, plan.installments);
      const installments = await tx.saleInstallment.findMany({
        where: { saleId: created.id },
        orderBy: { number: "asc" },
        select: { id: true, number: true, amountCents: true, dueDate: true, paidAt: true },
      });
      return { id: created.id, installments };
    });

    return Response.json({ sale: { id: sale.id, totalCents, installments: sale.installments } }, { status: 201 });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
