import Link from "next/link";
import {
  TrendingUp,
  Clock,
  Receipt,
  Boxes,
  Percent,
  Wallet,
  AlertTriangle,
  Store,
  Users,
  ArrowDownRight,
  Plus,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CustomerName } from "@/components/customers/customer-name";
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
import { VariantMixChart } from "@/components/charts/variant-mix-chart";
import { SupplierSpendChart } from "@/components/charts/supplier-spend-chart";
import { WriteGate } from "@/components/layout/read-only-context";

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
    itemId: s("itemId"),
    variantId: s("variantId"),
    customerId: s("customerId"),
    supplierId: s("supplierId"),
  } as const;

  // Sequencial de propósito: com connection_limit=1 (serverless), rodar em
  // paralelo só enfileira queries na mesma conexão e arrisca o pool_timeout.
  const data = await getDashboardData(filters);
  const options = await getFilterOptions();

  const { kpis, trend, mix, topCustomers, lowStock, supplier } = data;

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Visão geral do negócio"
        action={
          <WriteGate className="hidden md:inline-flex">
            <Button asChild size="sm">
              <Link href="/sales/new">
                <Plus />
                Nova venda
              </Link>
            </Button>
          </WriteGate>
        }
      />

      <DashboardFilters
        options={options}
        current={{
          from: format(from, "yyyy-MM-dd"),
          to: format(to, "yyyy-MM-dd"),
          status: filters.status,
          itemId: filters.itemId,
          variantId: filters.variantId,
          customerId: filters.customerId,
          supplierId: filters.supplierId,
        }}
      />

      <KpiSection title="Realizado" description="Só vendas pagas">
        <Kpi
          label="Receita bruta"
          value={formatBRL(kpis.paidRevenueCents)}
          hint="vendas pagas"
          icon={Wallet}
          highlight
        />
        <Kpi
          label="Receita líquida"
          value={formatBRL(kpis.netRevenueCents)}
          hint={uncostedHint(kpis.paidUncostedUnits, "bruta − custo de produção e revenda")}
          icon={TrendingUp}
          tone={signTone(kpis.netRevenueCents)}
          highlight
        />
        <Kpi
          label="Margem líquida"
          value={pct(kpis.marginPct)}
          hint={uncostedHint(kpis.paidUncostedUnits, "sobre a receita bruta")}
          icon={Percent}
          tone={kpis.marginPct != null && kpis.marginPct < 0 ? "destructive" : undefined}
        />
        <Kpi
          label="A receber"
          value={formatBRL(kpis.forecastRevenueCents)}
          hint="vendas pendentes"
          icon={Clock}
          tone={kpis.forecastRevenueCents > 0 ? "warning" : undefined}
        />
      </KpiSection>

      <KpiSection title="Presumido" description="Inclui o que ainda falta receber">
        <Kpi
          label="Receita bruta presumida"
          value={formatBRL(kpis.totalRevenueCents)}
          hint="pagas + a receber"
          icon={Wallet}
        />
        <Kpi
          label="Receita líquida presumida"
          value={formatBRL(kpis.presumedNetRevenueCents)}
          hint={uncostedHint(kpis.uncostedUnits, "presumida − custo de todas as vendas")}
          icon={TrendingUp}
          tone={signTone(kpis.presumedNetRevenueCents)}
        />
        <Kpi
          label="Margem presumida"
          value={pct(kpis.presumedMarginPct)}
          hint={uncostedHint(kpis.uncostedUnits, "sobre a receita presumida")}
          icon={Percent}
          tone={kpis.presumedMarginPct != null && kpis.presumedMarginPct < 0 ? "destructive" : undefined}
        />
        <Kpi
          label="Unidades vendidas"
          value={String(kpis.soldUnits)}
          hint={`em ${kpis.salesCount} venda${kpis.salesCount !== 1 ? "s" : ""}`}
          icon={Boxes}
        />
      </KpiSection>

      <KpiSection title="Custos" description="Das vendas pagas no período">
        <Kpi
          label="Custo de produção"
          value={formatBRL(kpis.productionCogsCents)}
          hint={
            kpis.unitCostCents == null
              ? "sem custo cadastrado"
              : uncostedHint(kpis.paidUncostedUnits, `${formatBRL(kpis.unitCostCents)}/un vendida`)
          }
          icon={Receipt}
        />
        <Kpi
          label="Custo de revenda"
          value={formatBRL(kpis.resaleCogsCents)}
          hint="última compra × qtd. vendida"
          icon={Receipt}
        />
        <Kpi
          label="CMV total"
          value={formatBRL(kpis.cogsCents)}
          hint="produção + revenda"
          icon={Receipt}
        />
        <Kpi
          label="Gasto em compras"
          value={formatBRL(supplier.totalSpendCents)}
          hint="insumos no período"
          icon={Store}
        />
      </KpiSection>

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
            <CardTitle className="text-base">Mix de variações</CardTitle>
          </CardHeader>
          <CardContent className="pr-2">
            {mix.length > 0 ? <VariantMixChart data={mix} /> : <ChartEmpty />}
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
                        <CustomerName
                          name={c.name}
                          sector={c.sector}
                          className="text-sm font-medium"
                        />
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
              <AlertTriangle className="size-4 text-warning-text" />
              Estoque baixo
            </CardTitle>
            <Link
              href="/stock/shopping-list"
              className="text-xs font-medium text-primary hover:underline"
            >
              Lista de compras
            </Link>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Tudo certo — nenhum insumo abaixo do mínimo.
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
                        Atual {formatQty(Math.max(i.current, 0), i.unit as BaseUnit)} ·
                        mín {formatQty(i.minStock, i.unit as BaseUnit)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                      faltam {formatQty(i.deficit, i.unit as BaseUnit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Fornecedor: gasto + comparativo de preços ─── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4 text-muted-foreground" />
              Gasto por fornecedor
            </CardTitle>
          </CardHeader>
          <CardContent>
            {supplier.spendBySupplier.length > 0 ? (
              <SupplierSpendChart data={supplier.spendBySupplier} />
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
            {supplier.priceComparison.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Registre o mesmo insumo em 2+ fornecedores para comparar.
              </p>
            ) : (
              <ul className="divide-y">
                {supplier.priceComparison.slice(0, 6).map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.cheapestSupplier} ·{" "}
                        {formatBRL(Math.round(p.cheapestUnitCents))}/
                        {p.unit.toLowerCase()}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">
                      −{p.savingsPct.toFixed(0)}% vs {p.dearestSupplier}
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

function uncostedHint(units: number, fallback: string): string {
  if (units <= 0) return fallback;
  return `${units} un sem custo cadastrado (conta como 0)`;
}

function signTone(cents: number | null): "success" | "destructive" | undefined {
  if (cents == null) return undefined;
  return cents < 0 ? "destructive" : "success";
}

function KpiSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

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
        ? "text-warning-text"
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
