"use server";

import { getWorkspaceDb } from "@/server/tenant/context";
import {
  buildCustomerBalances,
  parseForecastCutoff,
  type CustomerPendingRow,
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

/**
 * Recorte das vendas pendentes por data prevista de pagamento.
 * Vendas sem previsão entram no recorte: não há data futura a esperar.
 */
function pendingForecastWhere(forecastTo?: string) {
  const cutoff = parseForecastCutoff(forecastTo);
  if (!cutoff) return {};
  return {
    OR: [{ paymentForecastDate: { lte: cutoff } }, { paymentForecastDate: null }],
  };
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

  const grouped = await db.sale.groupBy({
    by: ["customerId"],
    where: {
      status: "PENDING",
      customerId: { in: customers.map((c) => c.id) },
      ...pendingForecastWhere(filters.forecastTo),
    },
    _sum: { totalCents: true },
    _count: { _all: true },
    _min: { paymentForecastDate: true },
  });

  const pendingRows: CustomerPendingRow[] = grouped
    .filter((row): row is typeof row & { customerId: string } => row.customerId !== null)
    .map((row) => ({
      customerId: row.customerId,
      pendingCents: row._sum.totalCents ?? 0,
      pendingCount: row._count._all,
      oldestForecastDate: row._min.paymentForecastDate,
    }));

  return buildCustomerBalances(customers, pendingRows, filters);
}

/** Vendas pendentes de um cliente, da mais antiga para a mais recente. */
export async function getPendingSalesByCustomer(customerId: string, forecastTo?: string) {
  const db = await getWorkspaceDb();
  return db.sale.findMany({
    where: { customerId, status: "PENDING", ...pendingForecastWhere(forecastTo) },
    orderBy: { soldAt: "asc" },
    select: {
      id: true,
      soldAt: true,
      totalCents: true,
      paymentForecastDate: true,
      notes: true,
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
