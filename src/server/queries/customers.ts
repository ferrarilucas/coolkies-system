"use server";

import { getWorkspaceDb } from "@/server/tenant/context";
import { dueByWhere } from "@/server/sales/installments";
import {
  aggregateOpenInstallments,
  buildCustomerBalances,
  parseForecastCutoff,
  type CustomerSituation,
  type WithBalance,
} from "@/lib/customer-balance";

export type CustomerSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  sector: string | null;
};

export type CustomerFull = Awaited<ReturnType<typeof getCustomers>>[number];

/** Filtro por nome ou setor (case-insensitive). Sem termo = sem filtro. */
function nameOrSectorWhere(query?: string) {
  const term = query?.trim();
  if (!term) return undefined;
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" as const } },
      { sector: { contains: term, mode: "insensitive" as const } },
    ],
  };
}

/** Busca clientes por nome ou setor (case-insensitive). Sem query = retorna todos. */
export async function searchCustomers(query?: string): Promise<CustomerSummary[]> {
  const db = await getWorkspaceDb();
  return db.customer.findMany({
    where: nameOrSectorWhere(query),
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, email: true, phone: true, sector: true },
  });
}

const CUSTOMER_PAGE_SIZE = 20;

/** Busca paginada por nome ou setor. Usa take+1 para detectar próxima página sem count extra. */
export async function searchCustomersPage(
  query: string | undefined,
  page = 1,
): Promise<{ items: CustomerSummary[]; hasMore: boolean }> {
  const db = await getWorkspaceDb();
  const items = await db.customer.findMany({
    where: nameOrSectorWhere(query),
    orderBy: { name: "asc" },
    skip: (page - 1) * CUSTOMER_PAGE_SIZE,
    take: CUSTOMER_PAGE_SIZE + 1,
    select: { id: true, name: true, email: true, phone: true, sector: true },
  });
  const hasMore = items.length > CUSTOMER_PAGE_SIZE;
  return { items: hasMore ? items.slice(0, CUSTOMER_PAGE_SIZE) : items, hasMore };
}

/** Lista completa para a página de clientes. */
export async function getCustomers() {
  const db = await getWorkspaceDb();
  return db.customer.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { sales: true } },
    },
  });
}

export async function getCustomerById(id: string) {
  const db = await getWorkspaceDb();
  return db.customer.findUnique({ where: { id } });
}

export type CustomerBalanceQuery = {
  q?: string;
  sector?: string;
  situation: CustomerSituation;
  minDueCents?: number;
  forecastTo?: string;
};

function openInstallmentsWhere(forecastTo?: string) {
  const cutoff = parseForecastCutoff(forecastTo);
  return { paidAt: null, ...(cutoff ? dueByWhere(cutoff) : {}) };
}

export type CustomerWithBalance = WithBalance<
  Awaited<ReturnType<typeof getCustomers>>[number]
>;

/** Lista de clientes com o saldo pendente agregado, para a tela de clientes. */
export async function getCustomersWithBalance(
  filters: CustomerBalanceQuery,
): Promise<CustomerWithBalance[]> {
  const db = await getWorkspaceDb();
  const term = filters.q?.trim();

  const customers = await db.customer.findMany({
    where: {
      ...(filters.sector ? { sector: filters.sector } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" as const } },
              { sector: { contains: term, mode: "insensitive" as const } },
              { email: { contains: term, mode: "insensitive" as const } },
              { phone: { contains: term } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { sales: true } } },
  });

  const open = await db.saleInstallment.findMany({
    where: {
      ...openInstallmentsWhere(filters.forecastTo),
      sale: { customerId: { in: customers.map((c) => c.id) } },
    },
    select: { saleId: true, amountCents: true, dueDate: true, sale: { select: { customerId: true } } },
  });

  const pendingRows = aggregateOpenInstallments(
    open.map((row) => ({
      saleId: row.saleId,
      customerId: row.sale.customerId,
      amountCents: row.amountCents,
      dueDate: row.dueDate,
    })),
  );

  return buildCustomerBalances(customers, pendingRows, filters);
}

export async function getOpenInstallmentsByCustomer(customerId: string, forecastTo?: string) {
  const db = await getWorkspaceDb();
  return db.saleInstallment.findMany({
    where: { ...openInstallmentsWhere(forecastTo), sale: { customerId } },
    orderBy: [{ sale: { soldAt: "asc" } }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      amountCents: true,
      dueDate: true,
      sale: { select: { id: true, soldAt: true, installmentCount: true, notes: true } },
    },
  });
}

/** Setores distintos já cadastrados, para alimentar o filtro. */
export async function getCustomerSectors(): Promise<string[]> {
  const db = await getWorkspaceDb();
  const rows = await db.customer.findMany({
    where: { sector: { not: null } },
    distinct: ["sector"],
    orderBy: { sector: "asc" },
    select: { sector: true },
  });
  return rows.map((r) => r.sector).filter((s): s is string => Boolean(s?.trim()));
}

export type CustomerReportSale = {
  id: string;
  soldAt: Date;
  status: "PAID" | "PENDING";
  totalCents: number;
  installmentCount: number;
  openInstallments: { number: number; amountCents: number; dueDate: Date | null }[];
  items: {
    id: string;
    quantity: number;
    unitPriceSnapshot: number;
    productNameSnapshot: string;
    variantNameSnapshot: string | null;
  }[];
};

export type CustomerReport = {
  customer: { id: string; name: string; email: string | null; phone: string | null; sector: string | null };
  sales: CustomerReportSale[];
  totalCents: number;
  paidCents: number;
  pendingCents: number;
};

export async function getCustomerReport(
  customerId: string,
  from: Date,
  to: Date,
): Promise<CustomerReport | null> {
  const db = await getWorkspaceDb();
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, email: true, phone: true, sector: true },
  });
  if (!customer) return null;

  const sales = await db.sale.findMany({
    where: { customerId, soldAt: { gte: from, lte: to } },
    orderBy: { soldAt: "asc" },
    select: {
      id: true,
      soldAt: true,
      status: true,
      totalCents: true,
      installmentCount: true,
      openCents: true,
      installments: {
        where: { paidAt: null },
        orderBy: { number: "asc" },
        select: { number: true, amountCents: true, dueDate: true },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPriceSnapshot: true,
          productNameSnapshot: true,
          variantNameSnapshot: true,
        },
      },
    },
  });

  const totalCents = sales.reduce((sum, s) => sum + s.totalCents, 0);
  const pendingCents = sales.reduce((sum, s) => sum + s.openCents, 0);

  return {
    customer,
    sales: sales.map((s) => ({
      id: s.id,
      soldAt: s.soldAt,
      status: s.status,
      totalCents: s.totalCents,
      installmentCount: s.installmentCount,
      items: s.items,
      openInstallments: s.installments,
    })),
    totalCents,
    paidCents: totalCents - pendingCents,
    pendingCents,
  };
}
