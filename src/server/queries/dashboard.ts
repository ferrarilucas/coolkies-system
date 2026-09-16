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
import { getItemStock } from "./production";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de filtro
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardStatus = "ALL" | "PAID" | "PENDING";

export type DashboardFilters = {
  from: Date;
  to: Date;
  status: DashboardStatus;
  itemId?: string;
  variantId?: string;
  customerId?: string;
  supplierId?: string;
};

export type Granularity = "day" | "week" | "month";

function mixKey(itemId: string, variantId: string | null) {
  return `${itemId}|${variantId ?? "null"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opções para a barra de filtros
// ─────────────────────────────────────────────────────────────────────────────

export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;

export async function getFilterOptions() {
  const db = await getWorkspaceDb();
  const products = await db.item.findMany({
    where: { sellable: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      variants: {
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
  if (filters.itemId || filters.variantId) {
    where.items = {
      some: {
        ...(filters.itemId ? { itemId: filters.itemId } : {}),
        ...(filters.variantId ? { variantId: filters.variantId } : {}),
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
          itemId: true,
          variantId: true,
          quantity: true,
          unitPriceSnapshot: true,
          productNameSnapshot: true,
          flavorNameSnapshot: true,
        },
      },
    },
  });

  // ── Query 2: lotes de produção ──────────────────────────────────────────────
  const batches = await db.productionBatch.findMany({
    where: { recipeId: { not: null } },
    select: {
      quantity: true,
      recipe: {
        select: {
          yieldQty: true,
          items: { select: { itemId: true, quantity: true } },
        },
      },
      variantLines: {
        select: {
          quantity: true,
          variant: {
            select: {
              recipe: {
                select: {
                  items: { select: { itemId: true, quantity: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  // ── Query 3: itens de compra ─────────────────────────────────────────────────
  const purchaseItems = await db.purchaseItem.findMany({
    orderBy: { purchase: { purchasedAt: "desc" } },
    select: {
      pricePaidCents: true,
      quantity: true,
      purchase: {
        select: { purchasedAt: true, supplierId: true, supplier: { select: { id: true, name: true } } },
      },
      item: { select: { id: true, name: true, unit: true } },
    },
  });

  // ─── Custo/unidade base (última compra) ──────────────────────────────────────
  const costPerBaseUnit = new Map<string, number>();
  const lastPriceBySupplier = new Map<string, Map<string, number>>();
  for (const p of purchaseItems) {
    const itemId = p.item.id;
    if (p.quantity > 0) {
      const unit = p.pricePaidCents / p.quantity;
      if (!costPerBaseUnit.has(itemId)) costPerBaseUnit.set(itemId, unit);
      const supplierId = p.purchase.supplierId;
      if (supplierId) {
        let bySupplier = lastPriceBySupplier.get(itemId);
        if (!bySupplier) { bySupplier = new Map(); lastPriceBySupplier.set(itemId, bySupplier); }
        if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, unit);
      }
    }
  }

  // ─── Custo médio por cookie ──────────────────────────────────────────────────
  let totalProductionCost = 0;
  let totalProduced = 0;
  for (const batch of batches) {
    if (!batch.recipe) continue;
    const yieldQty = batch.recipe.yieldQty || 1;
    const recipeBatches = batch.quantity / yieldQty;
    for (const ri of batch.recipe.items) {
      const unit = costPerBaseUnit.get(ri.itemId);
      if (unit != null) totalProductionCost += unit * ri.quantity * recipeBatches;
    }
    for (const line of batch.variantLines) {
      const vr = line.variant.recipe;
      if (!vr) continue;
      for (const ri of vr.items) {
        const unit = costPerBaseUnit.get(ri.itemId);
        if (unit != null) totalProductionCost += unit * ri.quantity * line.quantity;
      }
    }
    totalProduced += batch.quantity;
  }
  const unitCost =
    totalProduced > 0 && totalProductionCost > 0
      ? totalProductionCost / totalProduced
      : null;

  // ─── KPIs + mix + clientes ───────────────────────────────────────────────────
  const hasItemFilter = !!(filters.itemId || filters.variantId);
  const itemMatches = (i: { itemId: string; variantId: string | null }) =>
    (!filters.itemId || i.itemId === filters.itemId) &&
    (!filters.variantId || i.variantId === filters.variantId);

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
      (s, i) => s + (costPerBaseUnit.has(i.itemId) ? 0 : i.quantity),
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
      const key = mixKey(i.itemId, i.variantId);
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
      const directUnit = costPerBaseUnit.get(item.itemId);
      if (directUnit == null) continue;
      resaleCogs += directUnit * item.quantity;
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
  const itemStock = await getItemStock();
  const lowStock = itemStock
    .filter((s) => s.belowMin && s.productionInput)
    .map((s) => ({
      id: s.itemId,
      name: s.itemName,
      unit: s.unit,
      current: s.current,
      minStock: s.minStock ?? 0,
      deficit: (s.minStock ?? 0) - s.current,
    }))
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
  const itemNameById = new Map(purchaseItems.map((p) => [p.item.id, p.item]));
  const priceComparison = Array.from(lastPriceBySupplier.entries())
    .map(([itemId, bySupplier]) => {
      const item = itemNameById.get(itemId);
      if (!item || bySupplier.size < 2) return null;
      const entries = Array.from(bySupplier.entries()).sort((a, b) => a[1] - b[1]);
      const [cheapSupplier, cheapVal] = entries[0];
      const [dearSupplier, dearVal] = entries[entries.length - 1];
      return {
        name: item.name,
        unit: item.unit as string,
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
