import { getWorkspaceDb } from "@/server/tenant/context";
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
import { isLowStock } from "@/lib/stock";

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
  supplierId?: string;
};

export type Granularity = "day" | "week" | "month";

function flavorKey(productId: string, flavorId: string | null) {
  return `${productId}|${flavorId ?? "null"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opções para a barra de filtros
// ─────────────────────────────────────────────────────────────────────────────

export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;

export async function getFilterOptions() {
  const db = await getWorkspaceDb();
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
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return { products, customers, suppliers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dados principais do dashboard
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData(filters: DashboardFilters) {
  const db = await getWorkspaceDb();
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
      customer: { select: { sector: true } },
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

  // ── Query 2: ingredientes ────────────────────────────────────────────────────
  const ingredients = await db.ingredient.findMany({
    select: { id: true, name: true, baseUnit: true, minStock: true, forResale: true, resaleProductId: true },
  });

  const resaleProductIds = new Set(
    ingredients
      .filter((ing) => ing.forResale && ing.resaleProductId)
      .map((ing) => ing.resaleProductId as string),
  );

  const resaleSoldByIngredientId = new Map<string, number>();
  if (resaleProductIds.size > 0) {
    const soldMovements = await db.stockMovement.groupBy({
      by: ["productId"],
      where: { productId: { in: Array.from(resaleProductIds) }, type: "SALE" },
      _sum: { quantity: true },
    });
    const soldByProductId = new Map(
      soldMovements.map((r) => [r.productId, Math.abs(r._sum.quantity ?? 0)]),
    );
    for (const ing of ingredients) {
      if (ing.forResale && ing.resaleProductId) {
        resaleSoldByIngredientId.set(ing.id, soldByProductId.get(ing.resaleProductId) ?? 0);
      }
    }
  }

  // ── Query 3: lotes de produção ──────────────────────────────────────────────
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
                  ingredients: { select: { ingredientId: true, quantity: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  // ── Query 4: itens de compra ─────────────────────────────────────────────────
  const purchaseItems = await db.purchaseItem.findMany({
    orderBy: { purchase: { purchasedAt: "desc" } },
    select: {
      pricePaidCents: true,
      quantity: true,
      purchase: {
        select: { purchasedAt: true, supplierId: true, supplier: { select: { id: true, name: true } } },
      },
      ingredient: { select: { id: true, name: true, baseUnit: true, forResale: true, resaleProductId: true } },
    },
  });

  // ─── Custo/unidade base (última compra), consumo total ───────────────────────
  const costPerBaseUnit = new Map<string, number>();
  const purchasedTotal = new Map<string, number>();
  const lastPriceBySupplier = new Map<string, Map<string, number>>();
  const resaleUnitCostByProductId = new Map<string, number>();
  for (const p of purchaseItems) {
    const ingId = p.ingredient.id;
    purchasedTotal.set(ingId, (purchasedTotal.get(ingId) ?? 0) + p.quantity);
    if (p.quantity > 0) {
      const unit = p.pricePaidCents / p.quantity;
      if (!costPerBaseUnit.has(ingId)) costPerBaseUnit.set(ingId, unit);
      if (p.ingredient.forResale && p.ingredient.resaleProductId) {
        if (!resaleUnitCostByProductId.has(p.ingredient.resaleProductId)) {
          resaleUnitCostByProductId.set(p.ingredient.resaleProductId, unit);
        }
      }
      const supplierId = p.purchase.supplierId;
      if (supplierId) {
        let bySupplier = lastPriceBySupplier.get(ingId);
        if (!bySupplier) { bySupplier = new Map(); lastPriceBySupplier.set(ingId, bySupplier); }
        if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, unit);
      }
    }
  }

  // ─── Custo médio por cookie ──────────────────────────────────────────────────
  const consumed = new Map<string, number>();
  let totalProductionCost = 0;
  let totalProduced = 0;
  for (const batch of batches) {
    if (!batch.recipe) continue;
    const yieldQty = batch.recipe.yieldQty || 1;
    const recipeBatches = batch.quantity / yieldQty;
    for (const ri of batch.recipe.ingredients) {
      consumed.set(ri.ingredientId, (consumed.get(ri.ingredientId) ?? 0) + ri.quantity * recipeBatches);
      const unit = costPerBaseUnit.get(ri.ingredientId);
      if (unit != null) totalProductionCost += unit * ri.quantity * recipeBatches;
    }
    for (const f of batch.fillings) {
      const fr = f.flavor.fillingRecipe;
      if (!fr) continue;
      for (const ri of fr.ingredients) {
        consumed.set(ri.ingredientId, (consumed.get(ri.ingredientId) ?? 0) + ri.quantity * f.quantity);
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

  // ─── KPIs + mix + clientes ───────────────────────────────────────────────────
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
    { name: string; sector: string | null; revenue: number; count: number }
  >();

  for (const sale of sales) {
    const matchedItems = hasItemFilter ? sale.items.filter(itemMatches) : sale.items;
    const saleQty = matchedItems.reduce(
      (s, i) => s + (resaleProductIds.has(i.productId) ? 0 : i.quantity),
      0,
    );

    // Receita: usa totalCents (já com desconto) quando não há filtro de item.
    // Com filtro de item, aplica proporção do desconto sobre os itens filtrados.
    let saleRevenue: number;
    if (!hasItemFilter) {
      saleRevenue = sale.totalCents;
    } else {
      const rawItemTotal = sale.items.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0);
      const matchedRaw = matchedItems.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0);
      // ratio do desconto: totalCents / rawItemTotal (≤ 1)
      const discountRatio = rawItemTotal > 0 ? sale.totalCents / rawItemTotal : 1;
      saleRevenue = Math.round(matchedRaw * discountRatio);
    }

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
    const cc = customerMap.get(cid) ?? {
      name: cname,
      sector: sale.customer?.sector ?? null,
      revenue: 0,
      count: 0,
    };
    cc.revenue += saleRevenue;
    cc.count += 1;
    customerMap.set(cid, cc);
  }

  const totalRevenue = paidRevenue + forecastRevenue;
  const avgTicket = salesCount > 0 ? Math.round(totalRevenue / salesCount) : 0;

  const productionCogs = unitCost != null ? unitCost * soldCookies : 0;
  let resaleCogs = 0;
  for (const sale of sales) {
    const matched = hasItemFilter ? sale.items.filter(itemMatches) : sale.items;
    for (const item of matched) {
      const resaleUnit = resaleUnitCostByProductId.get(item.productId);
      if (resaleUnit == null) continue;
      resaleCogs += resaleUnit * item.quantity;
    }
  }
  const cogs = unitCost != null || resaleCogs > 0
    ? Math.round(productionCogs + resaleCogs)
    : null;
  const grossProfit = cogs != null ? paidRevenue - cogs : null;
  const marginPct =
    grossProfit != null && paidRevenue > 0
      ? (grossProfit / paidRevenue) * 100
      : null;

  // ─── Série temporal ──────────────────────────────────────────────────────────
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

  const series = new Map<string, { label: string; realized: number; forecast: number }>();
  for (const b of bucketsArr) {
    series.set(bucketKey(b), { label: bucketLabel(b), realized: 0, forecast: 0 });
  }
  for (const sale of sales) {
    const matched = hasItemFilter ? sale.items.filter(itemMatches) : sale.items;
    const rawItemTotal = sale.items.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0);
    const matchedRaw = matched.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0);
    const discountRatio = rawItemTotal > 0 ? sale.totalCents / rawItemTotal : 1;
    const rev = hasItemFilter ? Math.round(matchedRaw * discountRatio) : sale.totalCents;

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
      sector: c.sector,
      revenueCents: c.revenue,
      count: c.count,
      avgTicketCents: c.count > 0 ? Math.round(c.revenue / c.count) : 0,
    }));

  // ─── Estoque baixo ───────────────────────────────────────────────────────────
  const lowStock = ingredients
    .map((ing) => {
      const purchased = purchasedTotal.get(ing.id) ?? 0;
      const used = consumed.get(ing.id) ?? 0;
      const resaleSold = resaleSoldByIngredientId.get(ing.id) ?? 0;
      const current = purchased - used - resaleSold;
      const min = ing.minStock ?? 0;
      return { id: ing.id, name: ing.name, baseUnit: ing.baseUnit as string, current, minStock: min, deficit: min - current };
    })
    .filter((i) => isLowStock(i.current, i.minStock))
    .sort((a, b) => b.deficit - a.deficit);

  // ─── Fornecedor ──────────────────────────────────────────────────────────────
  const spendMap = new Map<string, { name: string; spend: number; count: number }>();
  for (const p of purchaseItems) {
    if (p.purchase.purchasedAt < from || p.purchase.purchasedAt > to) continue;
    const supplierId = p.purchase.supplierId ?? "__none__";
    if (filters.supplierId && supplierId !== filters.supplierId) continue;
    const name = p.purchase.supplier?.name ?? "Sem fornecedor";
    const e = spendMap.get(supplierId) ?? { name, spend: 0, count: 0 };
    e.spend += p.pricePaidCents;
    e.count += 1;
    spendMap.set(supplierId, e);
  }
  const spendBySupplier = Array.from(spendMap.values())
    .sort((a, b) => b.spend - a.spend)
    .map((s) => ({ name: s.name, spendCents: s.spend, count: s.count }));
  const totalSpendCents = spendBySupplier.reduce((s, m) => s + m.spendCents, 0);

  const supplierNameById = new Map(
    purchaseItems
      .filter((p) => p.purchase.supplierId)
      .map((p) => [p.purchase.supplierId as string, p.purchase.supplier!.name]),
  );
  const ingNameById = new Map(purchaseItems.map((p) => [p.ingredient.id, p.ingredient]));
  const priceComparison = Array.from(lastPriceBySupplier.entries())
    .map(([ingId, bySupplier]) => {
      const ing = ingNameById.get(ingId);
      if (!ing || bySupplier.size < 2) return null;
      const entries = Array.from(bySupplier.entries()).sort((a, b) => a[1] - b[1]);
      const [cheapSupplier, cheapVal] = entries[0];
      const [dearSupplier, dearVal] = entries[entries.length - 1];
      return {
        name: ing.name,
        baseUnit: ing.baseUnit as string,
        cheapestSupplier: supplierNameById.get(cheapSupplier) ?? "—",
        cheapestUnitCents: cheapVal,
        dearestSupplier: supplierNameById.get(dearSupplier) ?? "—",
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
    supplier: { spendBySupplier, totalSpendCents, priceComparison },
  };
}
