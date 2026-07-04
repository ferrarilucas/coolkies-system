import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import { getSales, getSalesCounts } from "@/server/queries/sales";
import { formatBRL } from "@/lib/money";
import { MarkAsPaidButton } from "@/components/sales/mark-as-paid-button";
import { RowActions } from "@/components/shared/row-actions";
import { deleteSale } from "@/server/actions/sales";
import { SalesSearch } from "@/components/sales/sales-search";

// ─── Page ────────────────────────────────────────────────────────────────────

type SearchParams = Promise<{ page?: string; tab?: string; q?: string }>;

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = (sp.tab as "all" | "paid" | "pending") ?? "all";
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const q = (sp.q ?? "").trim();

  const filter = tab === "paid" ? "PAID" : tab === "pending" ? "PENDING" : undefined;
  const result = await getSales(filter, page, q || undefined);

  const counts = await getSalesCounts();
  const { all: allCount, pending: pendingCount, paid: paidCount } = counts;

  function buildHref(p: number) {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/sales${qs ? `?${qs}` : ""}`;
  }

  function tabHref(t: string) {
    const params = new URLSearchParams();
    if (t !== "all") params.set("tab", t);
    if (q) params.set("q", q);
    const qs = params.toString();
    return `/sales${qs ? `?${qs}` : ""}`;
  }

  return (
    <div>
      <PageHeader
        title="Vendas"
        description="Cadastre e acompanhe seus pedidos."
        action={
          <Button asChild size="sm">
            <Link href="/sales/new">
              <Plus />
              Nova venda
            </Link>
          </Button>
        }
      />

      <SalesSearch initialValue={q} tab={tab} />

      <Tabs value={tab}>
        <TabsList className="w-full sm:w-auto mb-4">
          <TabsTrigger value="all" className="flex-1 sm:flex-none" asChild>
            <Link href={tabHref("all")}>
              Todas
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">{allCount}</Badge>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="pending" className="flex-1 sm:flex-none" asChild>
            <Link href={tabHref("pending")}>
              Pendentes
              {pendingCount > 0 && (
                <Badge className="ml-1.5 h-5 px-1.5 text-xs bg-warning text-warning-foreground">{pendingCount}</Badge>
              )}
            </Link>
          </TabsTrigger>
          <TabsTrigger value="paid" className="flex-1 sm:flex-none" asChild>
            <Link href={tabHref("paid")}>
              Pagas
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">{paidCount}</Badge>
            </Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} forceMount>
          {result.items.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title={q ? "Nenhum resultado" : "Nenhuma venda"}
              description={
                q ? `Nada encontrado para "${q}".` :
                tab === "pending" ? "Sem vendas pendentes." :
                tab === "paid" ? "Sem vendas pagas." :
                "Cadastre sua primeira venda."
              }
              action={tab === "all" && !q ? (
                <Button asChild><Link href="/sales/new"><Plus />Nova venda</Link></Button>
              ) : undefined}
            />
          ) : (
            <>
              <div className="space-y-3">
                {result.items.map((sale) => (
                  <SaleCard key={sale.id} sale={sale} />
                ))}
              </div>
              <Pagination
                page={result.page}
                pageCount={result.pageCount}
                buildHref={buildHref}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Card de venda ───────────────────────────────────────────────────────────

type Sale = Awaited<ReturnType<typeof getSales>>["items"][number];

function SaleCard({ sale }: { sale: Sale }) {
  const isPending = sale.status === "PENDING";
  const itemsSummary = sale.items
    .map((i) =>
      `${i.quantity}× ${i.productNameSnapshot}${i.flavorNameSnapshot ? ` ${i.flavorNameSnapshot}` : ""}`,
    )
    .join(", ");

  const hasDiscount = sale.discountType && sale.discountValue > 0;

  return (
    <div className="rounded-lg border bg-card p-4 pb-2 space-y-2">
      {/* Linha 1: cliente + status + total */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">
              {sale.customerName ?? <span className="text-muted-foreground italic">Sem identificação</span>}
            </p>
            <StatusBadge sale={sale} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(sale.soldAt, "d 'de' MMM yyyy", { locale: ptBR })}
            {isPending && sale.paymentForecastDate &&
              ` · Prev. ${format(sale.paymentForecastDate, "dd/MM/yyyy")}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold tabular-nums">{formatBRL(sale.totalCents)}</p>
          {hasDiscount && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Desconto:{" "}
              {sale.discountType === "PERCENTAGE"
                ? `${sale.discountValue}%`
                : formatBRL(sale.discountValue)}
            </p>
          )}
        </div>
      </div>

      {/* Linha 2: itens */}
      <p className="text-sm text-muted-foreground truncate">{itemsSummary}</p>

      {/* Linha 3: ações */}
      <div className="flex items-center justify-between gap-2 border-t pt-1">
        {isPending ? <MarkAsPaidButton id={sale.id} /> : <span />}
        <RowActions
          editHref={`/sales/${sale.id}/edit`}
          deleteTitle="Excluir venda"
          deleteDescription="Tem certeza? Esta ação não pode ser desfeita e irá reverter a movimentação de estoque."
          deleteSuccessMessage="Venda excluída."
          onDelete={deleteSale.bind(null, sale.id)}
        />
      </div>
    </div>
  );
}

function StatusBadge({ sale }: { sale: Sale }) {
  if (sale.status === "PAID") {
    return (
      <Badge className="text-xs bg-success/15 text-success border-success/30 shrink-0">
        Pago
      </Badge>
    );
  }
  return (
    <Badge className="text-xs bg-warning/15 text-warning-text border-warning/30 shrink-0">
      Pendente
    </Badge>
  );
}
