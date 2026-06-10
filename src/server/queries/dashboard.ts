import { db } from "@/lib/db";
import {
  startOfDay,
  endOfDay,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  startOfWeek,
  startOfMonth,
  differenceInCalendarDays,
  format,
} from "date-fns";
import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de filtro
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardStatus = "ALL" | "PAID" | "PENDING";

export type DashboardFilters = {
  from: Date;
  to: Date;
  status: DashboardStatus;
  productId?: string;
  flavorId?: string;
  customerId?: string;
  marketId?: string;
};

export type Granularity = "day" | "week" | "month";

// chave produto|sabor → label
function flavorKey(productId: string, flavorId: string | null) {
  return `${productId}|${flavorId ?? "null"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opções para a barra de filtros
// ─────────────────────────────────────────────────────────────────────────────

export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;

export async function getFilterOptions() {
  const [products, customers, markets] = await Promise.all([
    db.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        flavors: {
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
    db.customer.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.market.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return { products, customers, markets };
}

// ─────────────────────────────────────────────────────────────────────────────
// Custo médio estimado por cookie (CMV)
//   Total de ingredientes consumidos × custo da última compra ÷ total produzido.
//   É uma estimativa global — suficiente para margem gerencial.
// ─────────────────────────────────────────────────────────────────────────────

async function getEstimatedUnitCostCents(): Promise<number | null> {
  const ingredients = await db.ingredient.findMany({
    select: {
      id: true,
      purchases: {
        orderBy: { purchasedAt: "desc" },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  const costPerBaseUnit = new Map<string, number>(); // centavos por unidade base
  for (const ing of ingredients) {
    const p = ing.purchases[0];
    if (p && p.quantity > 0) {
      costPerBaseUnit.set(ing.id, p.pricePaidCents / p.quantity);
    }
  }

  const batches = await db.productionBatch.findMany({
    where: { recipeId: { not: null } },
    select: {
      quantity: true,
      recipe: {
        select: {
          yieldQty: true,
          ingredients: { select: { ingredientId: true, quantity: true } },
        },
      },
      fillings: {
        select: {
          quantity: true,
          flavor: {
            select: {
              fillingRecipe: {
                select: {
                  ingredients: {
                    select: { ingredientId: true, quantity: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  let totalCost = 0;
  let totalProduced = 0;

  for (const batch of batches) {
    if (!batch.recipe) continue;
    const yieldQty = batch.recipe.yieldQty || 1;
    const recipeBatches = batch.quantity / yieldQty;

    for (const ri of batch.recipe.ingredients) {
      const unit = costPerBaseUnit.get(ri.ingredientId);
      if (unit != null) totalCost += unit * ri.quantity * recipeBatches;
    }
    for (const f of batch.fillings) {
      const fr = f.flavor.fillingRecipe;
      if (!fr) continue;
      for (const ri of fr.ingredients) {
        const unit = costPerBaseUnit.get(ri.ingredientId);
        if (unit != null) totalCost += unit * ri.quantity * f.quantity;
      }
    }
    totalProduced += batch.quantity;
  }

  if (totalProduced <= 0 || totalCost <= 0) return null;
  return totalCost / totalProduced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dados principais do dashboard
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData(filters: DashboardFilters) {
  const from = startOfDay(filters.from);
  const to = endOfDay(filters.to);

  // ─── Vendas do período (filtra por sobreposição com itens quando há produto/sabor)
  const where: Prisma.SaleWhereInput = {
    soldAt: { gte: from, lte: to },
  };
  if (filters.status !== "ALL") where.status = filters.status;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.productId || filters.flavorId) {
    where.items = {
      some: {
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.flavorId ? { flavorId: filters.flavorId } : {}),
      },
    };
  }

  const sales = await db.sale.findMany({
    where,
    orderBy: { soldAt: "asc" },
    select: {
      id: true,
      soldAt: true,
      status: true,
      paidAt: true,
      paymentForecastDate: true,
      totalCents: true,
      customerId: true,
      customerName: true,
      items: {
        select: {
          productId: true,
          flavorId: true,
          quantity: true,
          unitPriceSnapshot: true,
          productNameSnapshot: true,
          flavorNameSnapshot: true,
        },
      },
    },
  });

  // Quando filtra por produto/sabor, considera apenas os itens correspondentes
  // para as métricas de receita e mix (a venda entra, mas só o que casa conta).
  const itemMatches = (i: {
    productId: string;
    flavorId: string | null;
  }) =>
    (!filters.productId || i.productId === filters.productId) &&
    (!filters.flavorId || i.flavorId === filters.flavorId);

  // ─── KPIs ──────────────────────────────────────────────────────────────────
  let paidRevenue = 0;
  let forecastRevenue = 0;
  let salesCount = 0;
  let soldCookies = 0;
  let revenueForMargin = 0; // base para margem (somente recebida)

  // Mix por sabor + top clientes
  const mixMap = new Map<
    string,
    { label: string; revenue: number; qty: number }
  >();
  const customerMap = new Map<
    string,
    { name: string; revenue: number; count: number }
  >();

  for (const sale of sales) {
    const hasFilter = !!(filters.productId || filters.flavorId);
    const matchedItems = hasFilter
      ? sale.items.filter(itemMatches)
      : sale.items;
    const saleRevenue = matchedItems.reduce(
      (s, i) => s + i.unitPriceSnapshot * i.quantity,
      0,
    );
    const saleQty = matchedItems.reduce((s, i) => s + i.quantity, 0);

    salesCount += 1;
    soldCookies += saleQty;

    if (sale.status === "PAID") {
      paidRevenue += saleRevenue;
      revenueForMargin += saleRevenue;
    } else {
      forecastRevenue += saleRevenue;
    }

    // mix
    for (const i of matchedItems) {
      const key = flavorKey(i.productId, i.flavorId);
      const label = i.flavorNameSnapshot
        ? `${i.productNameSnapshot} ${i.flavorNameSnapshot}`
        : i.productNameSnapshot;
      const cur = mixMap.get(key) ?? { label, revenue: 0, qty: 0 };
      cur.revenue += i.unitPriceSnapshot * i.quantity;
      cur.qty += i.quantity;
      mixMap.set(key, cur);
    }

    // clientes
    const cid = sale.customerId ?? "__none__";
    const cname = sale.customerName ?? "Sem identificação";
    const cc = customerMap.get(cid) ?? { name: cname, revenue: 0, count: 0 };
    cc.revenue += saleRevenue;
    cc.count += 1;
    customerMap.set(cid, cc);
  }

  const totalRevenue = paidRevenue + forecastRevenue;
  const avgTicket = salesCount > 0 ? Math.round(totalRevenue / salesCount) : 0;

  // ─── CMV / lucro / margem ────────────────────────────────────────────────────
  const unitCost = await getEstimatedUnitCostCents();
  const cogs = unitCost != null ? Math.round(unitCost * soldCookies) : null;
  const grossProfit = cogs != null ? revenueForMargin - cogs : null;
  const marginPct =
    grossProfit != null && revenueForMargin > 0
      ? (grossProfit / revenueForMargin) * 100
      : null;

  // ─── Série temporal: realizada x prevista ────────────────────────────────────
  const spanDays = differenceInCalendarDays(to, from);
  const granularity: Granularity =
    spanDays <= 31 ? "day" : spanDays <= 120 ? "week" : "month";

  const bucketKey = (d: Date) => {
    if (granularity === "day") return format(d, "yyyy-MM-dd");
    if (granularity === "week")
      return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
    return format(startOfMonth(d), "yyyy-MM");
  };
  const bucketLabel = (d: Date) =>
    granularity === "month" ? format(d, "MMM/yy") : format(d, "dd/MM");

  const buckets =
    granularity === "day"
      ? eachDayOfInterval({ start: from, end: to })
      : granularity === "week"
        ? eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 1 })
        : eachMonthOfInterval({ start: from, end: to });

  const series = new Map<
    string,
    { label: string; realized: number; forecast: number }
  >();
  for (const b of buckets) {
    series.set(bucketKey(b), { label: bucketLabel(b), realized: 0, forecast: 0 });
  }

  for (const sale of sales) {
    const hasFilter = !!(filters.productId || filters.flavorId);
    const matched = hasFilter ? sale.items.filter(itemMatches) : sale.items;
    const rev = matched.reduce(
      (s, i) => s + i.unitPriceSnapshot * i.quantity,
      0,
    );
    if (sale.status === "PAID") {
      const k = bucketKey(sale.paidAt ?? sale.soldAt);
      const e = series.get(k);
      if (e) e.realized += rev;
    } else {
      // previsão entra na data prevista (se dentro do range) senão na data da venda
      const fd = sale.paymentForecastDate ?? sale.soldAt;
      const k = bucketKey(fd >= from && fd <= to ? fd : sale.soldAt);
      const e = series.get(k);
      if (e) e.forecast += rev;
    }
  }

  const trend = Array.from(series.values()).map((b) => ({
    label: b.label,
    realizada: Math.round(b.realized) / 100,
    prevista: Math.round(b.forecast) / 100,
  }));

  // ─── Mix (top sabores) ───────────────────────────────────────────────────────
  const mix = Array.from(mixMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((m) => ({ label: m.label, revenueCents: m.revenue, qty: m.qty }));

  // ─── Top clientes ────────────────────────────────────────────────────────────
  const topCustomers = Array.from(customerMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6)
    .map((c) => ({
      name: c.name,
      revenueCents: c.revenue,
      count: c.count,
      avgTicketCents: c.count > 0 ? Math.round(c.revenue / c.count) : 0,
    }));

  // ─── Estoque baixo (alertas) ─────────────────────────────────────────────────
  const lowStock = await getLowStockAlerts();

  // ─── Mercado: gasto por mercado + comparativo de preços ──────────────────────
  const market = await getMarketMetrics(from, to, filters.marketId);

  return {
    kpis: {
      paidRevenueCents: paidRevenue,
      forecastRevenueCents: forecastRevenue,
      totalRevenueCents: totalRevenue,
      salesCount,
      soldCookies,
      avgTicketCents: avgTicket,
      cogsCents: cogs,
      grossProfitCents: grossProfit,
      marginPct,
      unitCostCents: unitCost != null ? Math.round(unitCost) : null,
    },
    granularity,
    trend,
    mix,
    topCustomers,
    lowStock,
    market,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Estoque baixo de ingredientes
// ─────────────────────────────────────────────────────────────────────────────

async function getLowStockAlerts() {
  const ingredients = await db.ingredient.findMany({
    where: { minStock: { gt: 0 } },
    select: { id: true, name: true, baseUnit: true, minStock: true },
  });
  if (ingredients.length === 0) return [];

  const purchaseSums = await db.ingredientPurchase.groupBy({
    by: ["ingredientId"],
    _sum: { quantity: true },
  });
  const purchasedMap = new Map(
    purchaseSums.map((r) => [r.ingredientId, r._sum.quantity ?? 0]),
  );

  // consumo via produções
  const consumed = await buildConsumptionMap();

  return ingredients
    .map((ing) => {
      const purchased = purchasedMap.get(ing.id) ?? 0;
      const used = consumed.get(ing.id) ?? 0;
      const current = purchased - used;
      return {
        id: ing.id,
        name: ing.name,
        baseUnit: ing.baseUnit as string,
        current,
        minStock: ing.minStock ?? 0,
        deficit: (ing.minStock ?? 0) - current,
      };
    })
    .filter((i) => i.current < i.minStock)
    .sort((a, b) => b.deficit - a.deficit);
}

async function buildConsumptionMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const batches = await db.productionBatch.findMany({
    where: { recipeId: { not: null } },
    select: {
      quantity: true,
      recipe: {
        select: {
          yieldQty: true,
          ingredients: { select: { ingredientId: true, quantity: true } },
        },
      },
      fillings: {
        select: {
          quantity: true,
          flavor: {
            select: {
              fillingRecipe: {
                select: {
                  ingredients: {
                    select: { ingredientId: true, quantity: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  for (const batch of batches) {
    if (!batch.recipe) continue;
    const yieldQty = batch.recipe.yieldQty || 1;
    const recipeBatches = batch.quantity / yieldQty;
    for (const ri of batch.recipe.ingredients) {
      map.set(
        ri.ingredientId,
        (map.get(ri.ingredientId) ?? 0) + ri.quantity * recipeBatches,
      );
    }
    for (const f of batch.fillings) {
      const fr = f.flavor.fillingRecipe;
      if (!fr) continue;
      for (const ri of fr.ingredients) {
        map.set(
          ri.ingredientId,
          (map.get(ri.ingredientId) ?? 0) + ri.quantity * f.quantity,
        );
      }
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Métricas de mercado (compras de ingredientes)
// ─────────────────────────────────────────────────────────────────────────────

async function getMarketMetrics(from: Date, to: Date, marketId?: string) {
  const purchases = await db.ingredientPurchase.findMany({
    where: {
      purchasedAt: { gte: from, lte: to },
      ...(marketId ? { marketId } : {}),
    },
    select: {
      marketId: true,
      pricePaidCents: true,
      quantity: true,
      market: { select: { name: true } },
      ingredient: { select: { id: true, name: true, baseUnit: true } },
    },
  });

  // Gasto por mercado no período
  const spendMap = new Map<string, { name: string; spend: number; count: number }>();
  for (const p of purchases) {
    const e = spendMap.get(p.marketId) ?? {
      name: p.market.name,
      spend: 0,
      count: 0,
    };
    e.spend += p.pricePaidCents;
    e.count += 1;
    spendMap.set(p.marketId, e);
  }
  const spendByMarket = Array.from(spendMap.values())
    .sort((a, b) => b.spend - a.spend)
    .map((m) => ({ name: m.name, spendCents: m.spend, count: m.count }));
  const totalSpendCents = spendByMarket.reduce((s, m) => s + m.spendCents, 0);

  // Comparativo: menor custo por unidade base de cada ingrediente entre mercados
  // (usa a última compra de cada ingrediente em cada mercado)
  const allPurchases = await db.ingredientPurchase.findMany({
    orderBy: { purchasedAt: "desc" },
    select: {
      pricePaidCents: true,
      quantity: true,
      market: { select: { id: true, name: true } },
      ingredient: { select: { id: true, name: true, baseUnit: true } },
    },
  });

  type PerMarket = { market: string; unitCents: number };
  const byIngredient = new Map<
    string,
    {
      name: string;
      baseUnit: string;
      seen: Set<string>;
      markets: PerMarket[];
    }
  >();
  for (const p of allPurchases) {
    if (p.quantity <= 0) continue;
    const ig = p.ingredient;
    const cur =
      byIngredient.get(ig.id) ?? {
        name: ig.name,
        baseUnit: ig.baseUnit as string,
        seen: new Set<string>(),
        markets: [],
      };
    // só a última compra por mercado
    if (!cur.seen.has(p.market.id)) {
      cur.seen.add(p.market.id);
      cur.markets.push({
        market: p.market.name,
        unitCents: p.pricePaidCents / p.quantity,
      });
    }
    byIngredient.set(ig.id, cur);
  }

  const priceComparison = Array.from(byIngredient.values())
    .filter((i) => i.markets.length >= 2)
    .map((i) => {
      const sorted = [...i.markets].sort((a, b) => a.unitCents - b.unitCents);
      const cheapest = sorted[0];
      const dearest = sorted[sorted.length - 1];
      const savingsPct =
        dearest.unitCents > 0
          ? ((dearest.unitCents - cheapest.unitCents) / dearest.unitCents) * 100
          : 0;
      return {
        name: i.name,
        baseUnit: i.baseUnit,
        cheapestMarket: cheapest.market,
        cheapestUnitCents: cheapest.unitCents,
        dearestMarket: dearest.market,
        dearestUnitCents: dearest.unitCents,
        savingsPct,
      };
    })
    .sort((a, b) => b.savingsPct - a.savingsPct);

  return { spendByMarket, totalSpendCents, priceComparison };
}
