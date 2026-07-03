import Link from "next/link";
import {
  TrendingUp,
  Clock,
  Receipt,
  Cookie,
  Percent,
  Wallet,
  AlertTriangle,
  Store,
  Users,
  ArrowDownRight,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { formatBRL } from "@/lib/money";
import { formatQty } from "@/lib/units";
import { BaseUnit } from "@prisma/client";
import {
  getDashboardData,
  getFilterOptions,
  type DashboardStatus,
} from "@/server/queries/dashboard";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { FlavorMixChart } from "@/components/charts/flavor-mix-chart";
import { MarketSpendChart } from "@/components/charts/market-spend-chart";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function parseDate(v: string | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

const pct = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "" : ""}${v.toFixed(1)}%`;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const today = new Date();
  const from = parseDate(s("from"), subDays(today, 29));
  const to = parseDate(s("to"), today);
  const status = (s("status") as DashboardStatus) ?? "ALL";

  const filters = {
    from,
    to,
    status: ["ALL", "PAID", "PENDING"].includes(status) ? status : "ALL",
    productId: s("productId"),
    flavorId: s("flavorId"),
    customerId: s("customerId"),
    marketId: s("marketId"),
  } as const;

  // Sequencial de propósito: com connection_limit=1 (serverless), rodar em
  // paralelo só enfileira queries na mesma conexão e arrisca o pool_timeout.
  const data = await getDashboardData(filters);
  const options = await getFilterOptions();

  const { kpis, trend, mix, topCustomers, lowStock, market } = data;

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Visão geral do negócio"
      />

      <DashboardFilters
        options={options}
        current={{
          from: format(from, "yyyy-MM-dd"),
          to: format(to, "yyyy-MM-dd"),
          status: filters.status,
          productId: filters.productId,
          flavorId: filters.flavorId,
          customerId: filters.customerId,
          marketId: filters.marketId,
        }}
      />

      {/* ─── KPI total (pago + pendente) ─── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-3">
        <Kpi
          label="Total geral"
          value={formatBRL(kpis.totalRevenueCents)}
          hint="pago + pendente"
          icon={Wallet}
          highlight
        />
        <Kpi
          label="Cookies vendidos"
          value={String(kpis.soldCookies)}
          hint={`em ${kpis.salesCount} venda${kpis.salesCount !== 1 ? "s" : ""}`}
          icon={Cookie}
          highlight
        />
        <Kpi
          label="Receita recebida"
          value={formatBRL(kpis.paidRevenueCents)}
          hint="vendas pagas"
          icon={TrendingUp}
          tone="success"
        />
        <Kpi
          label="A receber"
          value={formatBRL(kpis.forecastRevenueCents)}
          hint="pendente"
          icon={Clock}
          tone={kpis.forecastRevenueCents > 0 ? "warning" : undefined}
        />
      </div>

      {/* ─── KPIs de lucro / CMV ─── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="CMV estimado"
          value={kpis.cogsCents == null ? "—" : formatBRL(kpis.cogsCents)}
          hint={
            kpis.unitCostCents == null
              ? "sem dados de custo"
              : `${formatBRL(kpis.unitCostCents)}/cookie`
          }
          icon={Receipt}
        />
        <Kpi
          label="Lucro bruto"
          value={kpis.grossProfitCents == null ? "—" : formatBRL(kpis.grossProfitCents)}
          hint="recebida − CMV"
          icon={TrendingUp}
          tone={
            kpis.grossProfitCents != null && kpis.grossProfitCents < 0
              ? "destructive"
              : "success"
          }
        />
        <Kpi
          label="Margem bruta"
          value={pct(kpis.marginPct)}
          hint="sobre recebida"
          icon={Percent}
          tone={kpis.marginPct != null && kpis.marginPct < 0 ? "destructive" : undefined}
        />
        <Kpi
          label="Gasto em compras"
          value={formatBRL(market.totalSpendCents)}
          hint="ingredientes no período"
          icon={Store}
        />
      </div>

      {/* ─── Gráficos ─── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Receita: realizada × prevista
            </CardTitle>
          </CardHeader>
          <CardContent className="pl-0">
            {trend.some((t) => t.realizada > 0 || t.prevista > 0) ? (
              <RevenueTrendChart data={trend} />
            ) : (
              <ChartEmpty />
            )}
          </CardContent>
        </Card>

        <Card className="overflow-visible">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mix de sabores</CardTitle>
          </CardHeader>
          <CardContent className="pr-2">
            {mix.length > 0 ? <FlavorMixChart data={mix} /> : <ChartEmpty />}
          </CardContent>
        </Card>
      </div>

      {/* ─── Top clientes + Estoque baixo ─── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" />
              Top clientes
            </CardTitle>
            <Link
              href="/customers"
              className="text-xs font-medium text-primary hover:underline"
            >
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {topCustomers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma venda no período.
              </p>
            ) : (
              <ul className="divide-y">
                {topCustomers.map((c, i) => (
                  <li
                    key={c.name + i}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.count} venda{c.count > 1 ? "s" : ""} ·{" "}
                          {formatBRL(c.avgTicketCents)}/venda
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatBRL(c.revenueCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" />
              Estoque baixo
            </CardTitle>
            <Link
              href="/pantry/shopping-list"
              className="text-xs font-medium text-primary hover:underline"
            >
              Lista de compras
            </Link>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Tudo certo — nenhum ingrediente abaixo do mínimo.
              </p>
            ) : (
              <ul className="divide-y">
                {lowStock.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Atual {formatQty(Math.max(i.current, 0), i.baseUnit as BaseUnit)} ·
                        mín {formatQty(i.minStock, i.baseUnit as BaseUnit)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                      faltam {formatQty(i.deficit, i.baseUnit as BaseUnit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Mercado: gasto + comparativo de preços ─── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4 text-muted-foreground" />
              Gasto por mercado
            </CardTitle>
          </CardHeader>
          <CardContent>
            {market.spendByMarket.length > 0 ? (
              <MarketSpendChart data={market.spendByMarket} />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma compra registrada no período.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowDownRight className="size-4 text-success" />
              Onde comprar mais barato
            </CardTitle>
          </CardHeader>
          <CardContent>
            {market.priceComparison.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Registre o mesmo ingrediente em 2+ mercados para comparar.
              </p>
            ) : (
              <ul className="divide-y">
                {market.priceComparison.slice(0, 6).map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.cheapestMarket} ·{" "}
                        {formatBRL(Math.round(p.cheapestUnitCents))}/
                        {p.baseUnit.toLowerCase()}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">
                      −{p.savingsPct.toFixed(0)}% vs {p.dearestMarket}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Auxiliares ──────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "success" | "warning" | "destructive";
  highlight?: boolean;
}) {
  const valueClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning-foreground"
        : tone === "destructive"
          ? "text-destructive"
          : "";
  return (
    <Card className={highlight ? "border-primary/30 bg-primary/5" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            {label}
          </CardTitle>
          <Icon className={`size-4 ${highlight ? "text-primary/60" : "text-muted-foreground"}`} />
        </div>
      </CardHeader>
      <CardContent>
        <p className={`tabular-nums font-bold ${highlight ? "text-2xl" : "text-xl"} ${valueClass}`}>
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
      Sem dados no período selecionado.
    </div>
  );
}
