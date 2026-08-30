import { getWorkspaceDb } from "@/server/tenant/context";
import type { Prisma } from "@prisma/client";

// ─── Lista de vendas (paginada) ───────────────────────────────────────────────

export const SALES_PAGE_SIZE = 20;

export type SaleListItem = Awaited<ReturnType<typeof getSales>>["items"][number];

export type SalesFilters = {
  status?: "PAID" | "PENDING";
  q?: string;
  customerId?: string;
  from?: Date;
  to?: Date;
  forecastFrom?: Date;
  forecastTo?: Date;
  overdueOnly?: boolean;
};

function buildSalesWhere(f: SalesFilters): Prisma.SaleWhereInput {
  const search = f.q?.trim();
  const forecast: Prisma.DateTimeNullableFilter = {
    ...(f.forecastFrom ? { gte: f.forecastFrom } : {}),
    ...(f.forecastTo ? { lte: f.forecastTo } : {}),
    ...(f.overdueOnly ? { lt: new Date() } : {}),
  };
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.overdueOnly ? { status: "PENDING" } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.from || f.to
      ? {
          soldAt: {
            ...(f.from ? { gte: f.from } : {}),
            ...(f.to ? { lte: f.to } : {}),
          },
        }
      : {}),
    ...(Object.keys(forecast).length > 0 ? { paymentForecastDate: forecast } : {}),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search, mode: "insensitive" as const } },
            { notes: { contains: search, mode: "insensitive" as const } },
            {
              items: {
                some: {
                  productNameSnapshot: { contains: search, mode: "insensitive" as const },
                },
              },
            },
            {
              items: {
                some: {
                  flavorNameSnapshot: { contains: search, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : {}),
  };
}

export async function getSales(filters: SalesFilters = {}, page = 1) {
  const db = await getWorkspaceDb();
  const where = buildSalesWhere(filters);
  const skip = (page - 1) * SALES_PAGE_SIZE;

  const [items, total] = await Promise.all([
    db.sale.findMany({
      where,
      orderBy: { soldAt: "desc" },
      skip,
      take: SALES_PAGE_SIZE,
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
    db.sale.count({ where }),
  ]);

  return { items, total, page, pageSize: SALES_PAGE_SIZE, pageCount: Math.ceil(total / SALES_PAGE_SIZE) };
}

export async function getSalesCounts(filters: Omit<SalesFilters, "status" | "overdueOnly"> = {}) {
  const db = await getWorkspaceDb();
  const groups = await db.sale.groupBy({
    by: ["status"],
    where: buildSalesWhere({ ...filters, status: undefined, overdueOnly: undefined }),
    _count: { _all: true },
  });
  const map = new Map(groups.map((g) => [g.status, g._count._all]));
  const paid = map.get("PAID") ?? 0;
  const pending = map.get("PENDING") ?? 0;
  return { all: paid + pending, paid, pending };
}

// ─── Resumo do conjunto filtrado (big numbers) ───────────────────────────────

export type SalesSummary = Awaited<ReturnType<typeof getSalesSummary>>;

export async function getSalesSummary(filters: Omit<SalesFilters, "status" | "overdueOnly"> = {}) {
  const db = await getWorkspaceDb();
  const base = buildSalesWhere({ ...filters, status: undefined, overdueOnly: undefined });

  const groups = await db.sale.groupBy({
    by: ["status"],
    where: base,
    _sum: { totalCents: true },
    _count: { _all: true },
  });
  const overdue = await db.sale.aggregate({
    where: {
      AND: [base, { status: "PENDING", paymentForecastDate: { lt: new Date() } }],
    },
    _sum: { totalCents: true },
    _count: { _all: true },
  });

  const byStatus = new Map(groups.map((g) => [g.status, g]));
  const pending = byStatus.get("PENDING");
  const paid = byStatus.get("PAID");

  return {
    pendingCents: pending?._sum.totalCents ?? 0,
    pendingCount: pending?._count._all ?? 0,
    paidCents: paid?._sum.totalCents ?? 0,
    paidCount: paid?._count._all ?? 0,
    overdueCents: overdue._sum.totalCents ?? 0,
    overdueCount: overdue._count._all ?? 0,
  };
}

// ─── Detalhe de uma venda (para edição) ──────────────────────────────────────

export type SaleDetail = Awaited<ReturnType<typeof getSaleById>>;

export async function getSaleById(id: string) {
  const db = await getWorkspaceDb();
  return db.sale.findUnique({
    where: { id },
    include: {
      items: {
        select: {
          id: true,
          productId: true,
          productNameSnapshot: true,
          flavorId: true,
          flavorNameSnapshot: true,
          quantity: true,
          unitPriceSnapshot: true,
        },
      },
    },
  });
}

// ─── Catálogo para o formulário de venda ─────────────────────────────────────

export type CatalogProduct = Awaited<ReturnType<typeof getCatalogForSale>>[number];

export async function getCatalogForSale() {
  const db = await getWorkspaceDb();
  const products = await db.product.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      flavors: {
        where: { active: true },
        orderBy: { name: "asc" },
        include: {
          priceListItems: {
            where: { active: true },
            select: { priceCents: true },
          },
        },
      },
      priceListItems: {
        where: { active: true, flavorId: null },
        select: { priceCents: true },
      },
    },
  });

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    genericPriceCents: p.priceListItems[0]?.priceCents ?? null,
    flavors: p.flavors.map((f) => ({
      id: f.id,
      name: f.name,
      priceCents: f.priceListItems[0]?.priceCents ?? p.priceListItems[0]?.priceCents ?? null,
    })),
  }));
}
