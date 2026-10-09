import { getWorkspaceDb } from "@/server/tenant/context";
import type { Prisma, PrismaClient } from "@prisma/client";

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

export function buildSalesWhere(f: SalesFilters): Prisma.SaleWhereInput {
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
            { customer: { sector: { contains: search, mode: "insensitive" as const } } },
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
                  variantNameSnapshot: { contains: search, mode: "insensitive" as const },
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
        customer: { select: { sector: true } },
        _count: { select: { installments: { where: { paidAt: null } } } },
        items: {
          select: {
            quantity: true,
            unitPriceSnapshot: true,
            productNameSnapshot: true,
            variantNameSnapshot: true,
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

export type SalesSummary = Awaited<ReturnType<typeof computeSalesSummary>>;

export async function computeSalesSummary(db: PrismaClient, base: Prisma.SaleWhereInput) {
  const now = new Date();
  const [groups, overdue, overdueCount] = await Promise.all([
    db.sale.groupBy({
      by: ["status"],
      where: base,
      _sum: { totalCents: true, openCents: true },
      _count: { _all: true },
    }),
    db.saleInstallment.aggregate({
      where: { paidAt: null, dueDate: { lt: now }, sale: base },
      _sum: { amountCents: true },
    }),
    db.sale.count({
      where: { AND: [base, { installments: { some: { paidAt: null, dueDate: { lt: now } } } }] },
    }),
  ]);

  const byStatus = new Map(groups.map((g) => [g.status, g]));
  const pending = byStatus.get("PENDING");
  const paid = byStatus.get("PAID");
  const pendingTotal = pending?._sum.totalCents ?? 0;
  const pendingOpen = pending?._sum.openCents ?? 0;

  return {
    pendingCents: pendingOpen,
    pendingCount: pending?._count._all ?? 0,
    paidCents: (paid?._sum.totalCents ?? 0) + (pendingTotal - pendingOpen),
    paidCount: paid?._count._all ?? 0,
    overdueCents: overdue._sum.amountCents ?? 0,
    overdueCount,
  };
}

export async function getSalesSummary(filters: Omit<SalesFilters, "status" | "overdueOnly"> = {}) {
  const db = await getWorkspaceDb();
  return computeSalesSummary(db, buildSalesWhere({ ...filters, status: undefined, overdueOnly: undefined }));
}

// ─── Detalhe de uma venda (para edição) ──────────────────────────────────────

export type SaleDetail = Awaited<ReturnType<typeof getSaleById>>;

export async function getSaleById(id: string) {
  const db = await getWorkspaceDb();
  return db.sale.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, sector: true } },
      items: {
        select: {
          id: true,
          itemId: true,
          productNameSnapshot: true,
          variantId: true,
          variantNameSnapshot: true,
          quantity: true,
          unitPriceSnapshot: true,
        },
      },
      installments: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, amountCents: true, dueDate: true, forecastPreset: true, paidAt: true },
      },
    },
  });
}

// ─── Catálogo para o formulário de venda ─────────────────────────────────────

export type CatalogProduct = Awaited<ReturnType<typeof getCatalogForSale>>[number];

export async function getCatalogForSale() {
  const db = await getWorkspaceDb();
  const items = await db.item.findMany({
    where: { active: true, sellable: true },
    orderBy: { name: "asc" },
    include: {
      options: {
        orderBy: { position: "asc" },
        include: { values: { orderBy: { position: "asc" }, select: { id: true, name: true } } },
      },
      variants: {
        where: { active: true },
        orderBy: { name: "asc" },
        include: {
          optionValues: { select: { optionValueId: true } },
          priceListItems: {
            where: { active: true },
            select: { priceCents: true },
          },
        },
      },
      priceListItems: {
        where: { active: true, variantId: null },
        select: { priceCents: true },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    name: item.name,
    genericPriceCents: item.priceListItems[0]?.priceCents ?? null,
    options: item.options.map((o) => ({ id: o.id, name: o.name, values: o.values })),
    variants: item.variants.map((v) => ({
      id: v.id,
      name: v.name,
      valueIds: v.optionValues.map((ov) => ov.optionValueId),
      priceCents: v.priceListItems[0]?.priceCents ?? item.priceListItems[0]?.priceCents ?? null,
    })),
  }));
}

export type SaleExportRow = {
  soldAt: string;
  customerName: string;
  status: string;
  totalCents: number;
  paymentForecastDate: string;
  installments: string;
  openCents: number;
};

export async function getSalesForExport(filters: SalesFilters = {}): Promise<SaleExportRow[]> {
  const db = await getWorkspaceDb();
  const where = buildSalesWhere(filters);

  const sales = await db.sale.findMany({
    where,
    orderBy: { soldAt: "asc" },
    include: {
      customer: { select: { name: true } },
      _count: { select: { installments: { where: { paidAt: null } } } },
    },
  });

  return sales.map((sale) => ({
    soldAt: sale.soldAt.toISOString().slice(0, 10),
    customerName: sale.customer?.name ?? sale.customerName ?? "Sem cliente",
    status: sale.status === "PAID" ? "Pago" : "Pendente",
    totalCents: sale.totalCents,
    paymentForecastDate: sale.paymentForecastDate
      ? sale.paymentForecastDate.toISOString().slice(0, 10)
      : "",
    installments:
      sale.installmentCount > 1
        ? `${sale.installmentCount - sale._count.installments}/${sale.installmentCount} pagas`
        : "",
    openCents: sale.openCents,
  }));
}
