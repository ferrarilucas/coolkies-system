"use server";

import { db } from "@/lib/db";

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
  return db.customer.findMany({
    where: query?.trim()
      ? { name: { contains: query.trim(), mode: "insensitive" } }
      : undefined,
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, email: true, phone: true, sector: true },
  });
}

/** Lista completa para a página de clientes. */
export async function getCustomers() {
  return db.customer.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { sales: true } },
    },
  });
}

export async function getCustomerById(id: string) {
  return db.customer.findUnique({ where: { id } });
}
