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

function flavorKey(productId: string, flavorId: string | null) {
  return `${productId}|${flavorId ?? "null"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opções para a barra de filtros
//   Serverless + connection_limit=1: queries SEQUENCIAIS (sem Promise.all) para
//   não disputar a única conexão e estourar o pool_timeout.
// ─────────────────────────────────────────────────────────────────────────────

export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;

export async function getFilterOptions() {
  const products = await db.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      flavors: {
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      },
    },
  });
  const customers = await db.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const markets = await db.market.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return { products, customers, markets };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dados principais do dashboard
//
//   Tudo é resolvido com apenas 4 leituras sequenciais (sales, ingredients,
//   production batches, purchases) e o resto é computado em memória. Isso evita
//   o P2024 ("Timed out fetching a new connection") em ambiente serverless com
//   connection_limit=1, onde dezenas de queries paralelas se enfileiram.
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData(filters: DashboardFilters) {
  const from = startOfDay(filters.from);
  const to = endOfDay(filters.to);

  // ── Query 1: vendas do período ──────────────────────────────────────────────
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

  // ── Query 2: ingredientes (cadastro) ────────────────────────────────────────
  const ingredients = await db.ingredient.findMany({
    select: { id: true, name: true, baseUnit: true, minStock: true },
  });

  // ── Query 3: lotes de produção (para custo e consumo, em uma única passada) ──
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

  // ── Query 4: todas as compras de ingredientes (custo, estoque e mercado) ─────
  const purchases = await db.ingredientPurchase.findMany({
    orderBy: { purchasedAt: "desc" },
    select: {
      marketId: true,
      pricePaidCents: true,
      quantity: true,
      purchasedAt: true,
      market: { select: { id: true, name: true } },
      ingredient: { select: { id: true, name: true, baseUnit: true } },
    },
  });

  // ─── Derivações de compras: custo/unidade base, total comprado, por mercado ──
  const costPerBaseUnit = new Map<string, number>(); // última compra
  const purchasedTotal = new Map<string, number>(); // soma de quantidades
  const lastPriceByMarket = new Map<string, Map<string, number>>(); // ing → mkt → unitCents
  for (const p of purchases) {
    const ingId = p.ingredient.id;
    purchasedTotal.set(ingId, (purchasedTotal.get(ingId) ?? 0) + p.quantity);
    if (p.quantity > 0) {
      // purchases vem ordenado desc → o primeiro visto é o mais recente
      if (!costPerBaseUnit.has(ingId)) {
        costPerBaseUnit.set(ingId, p.pricePaidCents / p.quantity);
      }
      let mkt = lastPriceByMarket.get(ingId);
      if (!mkt) {
        mkt = new Map();
        lastPriceByMarket.set(ingId, mkt);
      }
      if (!mkt.has(p.marketId)) {
        mkt.set(p.marketId, p.pricePaidCents / p.quantity);
      }
    }
  }

  // ─── Consumo + custo médio por cookie (uma passada sobre os lotes) ───────────
  const consumed = new Map<string, number>();
  let totalProductionCost = 0;
  let totalProduced = 0;
  for (const batch of batches) {
    if (!batch.recipe) continue;
    const yieldQty = batch.recipe.yieldQty || 1;
    const recipeBatches = batch.quantity / yieldQty;
    for (const ri of batch.recipe.ingredients) {
      consumed.set(
        ri.ingredientId,
        (consumed.get(ri.ingredientId) ?? 0) + ri.quantity * recipeBatches,
      );
      const unit = costPerBaseUnit.get(ri.ingredientId);
      if (unit != null) totalProductionCost += unit * ri.quantity * recipeBatches;
    }
    for (const f of batch.fillings) {
      const fr = f.flavor.fillingRecipe;
      if (!fr) continue;
      for (const ri of fr.ingredients) {
        consumed.set(
          ri.ingredientId,
          (consumed.get(ri.ingredientId) ?? 0) + ri.quantity * f.quantity,
        );
        const unit = costPerBaseUnit.get(ri.ingredientId);
        if (unit != null) totalProductionCost += unit * ri.quantity * f.quantity;
      }
    }
    totalProduced += batch.quantity;
  }
  const unitCost =
    totalProduced > 0 && totalProductionCost > 0
      ? totalProductionCost / totalProduced
      : null;

  // ─── KPIs + mix + clientes (em memória) ──────────────────────────────────────
  const hasItemFilter = !!(filters.productId || filters.flavorId);
  const itemMatches = (i: { productId: string; flavorId: string | null }) =>
    (!filters.productId || i.productId === filters.productId) &&
    (!filters.flavorId || i.flavorId === filters.flavorId);

  let paidRevenue = 0;
  let forecastRevenue = 0;
  let salesCount = 0;
  let soldCookies = 0;

  const mixMap = new Map<string, { label: string; revenue: number; qty: number }>();
  const customerMap = new Map<
    string,
    { name: string; revenue: number; count: number }
  >();

  for (const sale of sales) {
    const matchedItems = hasItemFilter
      ? sale.items.filter(itemMatches)
      : sale.items;
    const saleRevenue = matchedItems.reduce(
      (s, i) => s + i.unitPriceSnapshot * i.quantity,
      0,
    );
    const saleQty = matchedItems.reduce((s, i) => s + i.quantity, 0);

    salesCount += 1;
    soldCookies += saleQty;
    if (sale.status === "PAID") paidRevenue += saleRevenue;
    else forecastRevenue += saleRevenue;

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

    const cid = sale.customerId ?? "__none__";
    const cname = sale.customerName ?? "Sem identificação";
    const cc = customerMap.get(cid) ?? { name: cname, revenue: 0, count: 0 };
    cc.revenue += saleRevenue;
    cc.count += 1;
    customerMap.set(cid, cc);
  }

  const totalRevenue = paidRevenue + forecastRevenue;
  const avgTicket = salesCount > 0 ? Math.round(totalRevenue / salesCount) : 0;
  const cogs = unitCost != null ? Math.round(unitCost * soldCookies) : null;
  const grossProfit = cogs != null ? paidRevenue - cogs : null;
  const marginPct =
    grossProfit != null && paidRevenue > 0
      ? (grossProfit / paidRevenue) * 100
      : null;

  // ─── Série temporal realizada × prevista ─────────────────────────────────────
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

  const bucketsArr =
    granularity === "day"
      ? eachDayOfInterval({ start: from, end: to })
      : granularity === "week"
        ? eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 1 })
        : eachMonthOfInterval({ start: from, end: to });

  const series = new Map<
    string,
    { label: string; realized: number; forecast: number }
  >();
  for (const b of bucketsArr) {
    series.set(bucketKey(b), { label: bucketLabel(b), realized: 0, forecast: 0 });
  }
  for (const sale of sales) {
    const matched = hasItemFilter ? sale.items.filter(itemMatches) : sale.items;
    const rev = matched.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0);
    if (sale.status === "PAID") {
      const e = series.get(bucketKey(sale.paidAt ?? sale.soldAt));
      if (e) e.realized += rev;
    } else {
      const fd = sale.paymentForecastDate ?? sale.soldAt;
      const e = series.get(bucketKey(fd >= from && fd <= to ? fd : sale.soldAt));
      if (e) e.forecast += rev;
    }
  }
  const trend = Array.from(series.values()).map((b) => ({
    label: b.label,
    realizada: Math.round(b.realized) / 100,
    prevista: Math.round(b.forecast) / 100,
  }));

  // ─── Mix + top clientes ──────────────────────────────────────────────────────
  const mix = Array.from(mixMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((m) => ({ label: m.label, revenueCents: m.revenue, qty: m.qty }));

  const topCustomers = Array.from(customerMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6)
    .map((c) => ({
      name: c.name,
      revenueCents: c.revenue,
      count: c.count,
      avgTicketCents: c.count > 0 ? Math.round(c.revenue / c.count) : 0,
    }));

  // ─── Estoque baixo (em memória) ──────────────────────────────────────────────
  const lowStock = ingredients
    .filter((ing) => (ing.minStock ?? 0) > 0)
    .map((ing) => {
      const purchased = purchasedTotal.get(ing.id) ?? 0;
      const used = consumed.get(ing.id) ?? 0;
      const current = purchased - used;
      const min = ing.minStock ?? 0;
      return {
        id: ing.id,
        name: ing.name,
        baseUnit: ing.baseUnit as string,
        current,
        minStock: min,
        deficit: min - current,
      };
    })
    .filter((i) => i.current < i.minStock)
    .sort((a, b) => b.deficit - a.deficit);

  // ─── Mercado: gasto no período + comparativo de preços (em memória) ──────────
  const spendMap = new Map<string, { name: string; spend: number; count: number }>();
  for (const p of purchases) {
    if (p.purchasedAt < from || p.purchasedAt > to) continue;
    if (filters.marketId && p.marketId !== filters.marketId) continue;
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

  const marketNameById = new Map(
    purchases.map((p) => [p.marketId, p.market.name]),
  );
  const ingNameById = new Map(
    purchases.map((p) => [p.ingredient.id, p.ingredient]),
  );
  const priceComparison = Array.from(lastPriceByMarket.entries())
    .map(([ingId, byMkt]) => {
      const ing = ingNameById.get(ingId);
      if (!ing || byMkt.size < 2) return null;
      const entries = Array.from(byMkt.entries()).sort(
        (a, b) => a[1] - b[1],
      );
      const [cheapMkt, cheapVal] = entries[0];
      const [dearMkt, dearVal] = entries[entries.length - 1];
      return {
        name: ing.name,
        baseUnit: ing.baseUnit as string,
        cheapestMarket: marketNameById.get(cheapMkt) ?? "—",
        cheapestUnitCents: cheapVal,
        dearestMarket: marketNameById.get(dearMkt) ?? "—",
        dearestUnitCents: dearVal,
        savingsPct: dearVal > 0 ? ((dearVal - cheapVal) / dearVal) * 100 : 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.savingsPct - a.savingsPct);

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
    market: { spendByMarket, totalSpendCents, priceComparison },
  };
}
