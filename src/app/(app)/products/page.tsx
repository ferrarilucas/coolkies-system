import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ChefHat, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCookieStock, getProductionBatches } from "@/server/queries/production";
import { DeleteProductionButton } from "@/components/production/delete-production-button";

export default async function CookiesPage() {
  const [stock, batches] = await Promise.all([
    getCookieStock(),
    getProductionBatches(),
  ]);

  return (
    <div>
      <PageHeader
        title="Produtos"
        description="Estoque de produto final e histórico de produções."
        action={
          <Button asChild size="sm">
            <Link href="/products/new"><Plus />Registrar produção</Link>
          </Button>
        }
      />

      <Tabs defaultValue="stock">
        <TabsList className="w-full sm:w-auto mb-4">
          <TabsTrigger value="stock" className="flex-1 sm:flex-none">Estoque</TabsTrigger>
          <TabsTrigger value="history" className="flex-1 sm:flex-none">
            Produções
            {batches.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">{batches.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab estoque ─── */}
        <TabsContent value="stock">
          {stock.length === 0 ? (
            <EmptyState
              icon={ChefHat}
              title="Nenhum cookie em estoque"
              description="Registre uma produção para ver o estoque."
              action={<Button asChild><Link href="/products/new"><Plus />Registrar produção</Link></Button>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stock.map((entry) => (
                <div key={`${entry.productId}-${entry.flavorId}`}
                  className="rounded-lg border bg-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{entry.productName}</p>
                      {entry.flavorName && (
                        <Badge variant="secondary" className="text-xs mt-0.5">{entry.flavorName}</Badge>
                      )}
                    </div>
                    <span className={`text-2xl font-bold tabular-nums ${entry.current <= 0 ? "text-destructive" : "text-primary"}`}>
                      {entry.current}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>↑ {entry.produced} produzidos</span>
                    <span>↓ {entry.sold} vendidos</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tab histórico ─── */}
        <TabsContent value="history">
          {batches.length === 0 ? (
            <EmptyState
              icon={ChefHat}
              title="Nenhuma produção registrada"
              action={<Button asChild><Link href="/products/new"><Plus />Registrar produção</Link></Button>}
            />
          ) : (
            <div className="space-y-2">
              {batches.map((b) => (
                <div key={b.id} className="rounded-lg border bg-card px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{b.product.name}</span>
                      <Badge variant="outline" className="tabular-nums text-xs">{b.quantity} un.</Badge>
                      {b.recipe && <Badge variant="secondary" className="text-xs">{b.recipe.name}</Badge>}
                    </div>
                    {b.fillings.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {b.fillings.map((f) => (
                          <span key={f.id} className="text-xs text-muted-foreground">
                            {f.quantity}× {f.flavor.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {format(b.producedAt, "d 'de' MMMM yyyy", { locale: ptBR })}
                      {b.notes && ` · ${b.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
                      <Link href={`/products/${b.id}/edit`}>
                        <Pencil className="size-4" />
                        <span className="sr-only">Editar</span>
                      </Link>
                    </Button>
                    <DeleteProductionButton id={b.id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
