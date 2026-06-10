import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ShoppingCart, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getSales } from "@/server/queries/sales";
import { formatBRL } from "@/lib/money";
import { MarkAsPaidButton } from "@/components/sales/mark-as-paid-button";
import { DeleteSaleButton } from "@/components/sales/delete-sale-button";

export default async function SalesPage() {
  const [all, paid, pending] = await Promise.all([
    getSales(),
    getSales("PAID"),
    getSales("PENDING"),
  ]);

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

      <Tabs defaultValue="all">
        <TabsList className="w-full sm:w-auto mb-4">
          <TabsTrigger value="all" className="flex-1 sm:flex-none">
            Todas
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">{all.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="pending" className="flex-1 sm:flex-none">
            Pendentes
            {pending.length > 0 && (
              <Badge className="ml-1.5 h-5 px-1.5 text-xs bg-warning text-warning-foreground">{pending.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="paid" className="flex-1 sm:flex-none">
            Pagas
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">{paid.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {(["all", "pending", "paid"] as const).map((tab) => {
          const sales = tab === "all" ? all : tab === "paid" ? paid : pending;
          return (
            <TabsContent key={tab} value={tab}>
              {sales.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="Nenhuma venda"
                  description={tab === "pending" ? "Sem vendas pendentes." : tab === "paid" ? "Sem vendas pagas." : "Cadastre sua primeira venda."}
                  action={tab === "all" ? (
                    <Button asChild><Link href="/sales/new"><Plus />Nova venda</Link></Button>
                  ) : undefined}
                />
              ) : (
                <SaleList sales={sales} />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

// ─── Lista responsiva ────────────────────────────────────────────────────────

type Sale = Awaited<ReturnType<typeof getSales>>[number];

function SaleList({ sales }: { sales: Sale[] }) {
  return (
    <>
      {/* Cards — mobile e desktop */}
      <div className="space-y-3">
        {sales.map((sale) => (
          <SaleCard key={sale.id} sale={sale} />
        ))}
      </div>
    </>
  );
}

function SaleCard({ sale }: { sale: Sale }) {
  const isPending = sale.status === "PENDING";
  const itemsSummary = sale.items
    .map((i) =>
      `${i.quantity}× ${i.productNameSnapshot}${i.flavorNameSnapshot ? ` ${i.flavorNameSnapshot}` : ""}`,
    )
    .join(", ");

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Linha 1: cliente + data + total */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">
            {sale.customerName ?? <span className="text-muted-foreground italic">Sem identificação</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(sale.soldAt, "d 'de' MMMM yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold tabular-nums">{formatBRL(sale.totalCents)}</p>
          <StatusBadge sale={sale} />
        </div>
      </div>

      {/* Linha 2: itens */}
      <p className="text-sm text-muted-foreground truncate">{itemsSummary}</p>

      {/* Linha 3: ações */}
      <div className="flex items-center gap-2 pt-1 border-t">
        {isPending && <MarkAsPaidButton id={sale.id} />}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link href={`/sales/${sale.id}/edit`}>
              <Pencil className="size-4" />
              <span className="sr-only">Editar</span>
            </Link>
          </Button>
          <DeleteSaleButton id={sale.id} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ sale }: { sale: Sale }) {
  if (sale.status === "PAID") {
    return (
      <Badge className="text-xs bg-success/15 text-success border-success/30 mt-1">
        Pago
      </Badge>
    );
  }
  return (
    <div className="mt-1">
      <Badge className="text-xs bg-warning/15 text-warning-foreground border-warning/30">
        Pendente
      </Badge>
      {sale.paymentForecastDate && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Prev. {format(sale.paymentForecastDate, "dd/MM/yyyy")}
        </p>
      )}
    </div>
  );
}
