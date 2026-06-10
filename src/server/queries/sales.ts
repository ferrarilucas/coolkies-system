import { db } from "@/lib/db";

// ─── Lista de vendas ─────────────────────────────────────────────────────────

export type SaleListItem = Awaited<ReturnType<typeof getSales>>[number];

export async function getSales(filter?: "PAID" | "PENDING") {
  return db.sale.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: { soldAt: "desc" },
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
  });
}

// ─── Detalhe de uma venda (para edição) ──────────────────────────────────────

export type SaleDetail = Awaited<ReturnType<typeof getSaleById>>;

export async function getSaleById(id: string) {
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
    // preço genérico do produto (sem sabor)
    genericPriceCents: p.priceListItems[0]?.priceCents ?? null,
    flavors: p.flavors.map((f) => ({
      id: f.id,
      name: f.name,
      priceCents: f.priceListItems[0]?.priceCents ?? p.priceListItems[0]?.priceCents ?? null,
    })),
  }));
}
