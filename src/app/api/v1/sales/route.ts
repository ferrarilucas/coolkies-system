import { NextRequest } from "next/server";
import { StockMovementType } from "@prisma/client";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";
import { buildSalesWhere, type SalesFilters } from "@/server/queries/sales";

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

    const [sales, summaryGroups, overdue] = await Promise.all([
      db.sale.findMany({
        where,
        orderBy: { soldAt: "desc" },
        take: 50,
        include: {
          items: {
            select: {
              quantity: true,
              unitPriceSnapshot: true,
              productNameSnapshot: true,
              flavorNameSnapshot: true,
            },
          },
        },
      }),
      db.sale.groupBy({
        by: ["status"],
        where: summaryWhere,
        _sum: { totalCents: true },
        _count: { _all: true },
      }),
      db.sale.aggregate({
        where: { AND: [summaryWhere, { status: "PENDING", paymentForecastDate: { lt: new Date() } }] },
        _sum: { totalCents: true },
        _count: { _all: true },
      }),
    ]);

    const byStatus = new Map(summaryGroups.map((g) => [g.status, g]));
    const pending = byStatus.get("PENDING");
    const paid = byStatus.get("PAID");

    return Response.json({
      sales,
      summary: {
        pendingCents: pending?._sum.totalCents ?? 0,
        pendingCount: pending?._count._all ?? 0,
        paidCents: paid?._sum.totalCents ?? 0,
        paidCount: paid?._count._all ?? 0,
        overdueCents: overdue._sum.totalCents ?? 0,
        overdueCount: overdue._count._all ?? 0,
      },
    });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

type SaleItemInput = {
  itemId: string;
  productName: string;
  variantId: string | null;
  flavorName: string | null;
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
    const status: "PAID" | "PENDING" = body.status === "PENDING" ? "PENDING" : "PAID";
    const forecastPreset = typeof body.forecastPreset === "string" ? body.forecastPreset : null;

    let paymentForecastDate: Date | null = null;
    if (typeof body.forecastDate === "string" && body.forecastDate.trim()) {
      const parsed = parseDateOnly(body.forecastDate.trim());
      if (!isValidDate(parsed)) return Response.json({ error: "Data inválida." }, { status: 400 });
      paymentForecastDate = parsed;
    }

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

    const sale = await context.db.sale.create({
      data: {
        userId: context.userId,
        customerId,
        customerName,
        soldAt,
        notes,
        status,
        paidAt: status === "PAID" ? new Date() : null,
        paymentForecastDate: status === "PENDING" ? paymentForecastDate : null,
        forecastPreset: status === "PENDING" && forecastPreset ? forecastPreset : null,
        discountType,
        discountValue,
        totalCents,
        workspaceId: context.workspaceId,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            productNameSnapshot: item.productName,
            variantId: item.variantId,
            flavorNameSnapshot: item.flavorName,
            quantity: item.quantity,
            unitPriceSnapshot: item.unitPriceCents,
            workspaceId: context.workspaceId,
          })),
        },
      },
    });

    for (const item of items) {
      await context.db.stockMovement.create({
        data: {
          itemId: item.itemId,
          variantId: item.variantId,
          type: StockMovementType.SALE,
          quantity: -item.quantity,
          saleId: sale.id,
          workspaceId: context.workspaceId,
        },
      });
    }

    return Response.json({ sale: { id: sale.id, totalCents } }, { status: 201 });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
