"use server";

import { getWorkspaceDb } from "@/server/tenant/context";

export type CustomerSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  sector: string | null;
};

export type CustomerFull = Awaited<ReturnType<typeof getCustomers>>[number];

/** Busca clientes por nome (case-insensitive). Sem query = retorna todos. */
export async function searchCustomers(query?: string): Promise<CustomerSummary[]> {
  const db = await getWorkspaceDb();
  return db.customer.findMany({
    where: query?.trim()
      ? { name: { contains: query.trim(), mode: "insensitive" } }
      : undefined,
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, email: true, phone: true, sector: true },
  });
}

const CUSTOMER_PAGE_SIZE = 20;

/** Busca paginada por nome. Usa take+1 para detectar próxima página sem count extra. */
export async function searchCustomersPage(
  query: string | undefined,
  page = 1,
): Promise<{ items: CustomerSummary[]; hasMore: boolean }> {
  const db = await getWorkspaceDb();
  const items = await db.customer.findMany({
    where: query?.trim()
      ? { name: { contains: query.trim(), mode: "insensitive" } }
      : undefined,
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
