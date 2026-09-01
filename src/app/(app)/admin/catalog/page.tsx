import Link from "next/link";
import { Tags, Plus, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCatalogOverview } from "@/server/queries/catalog";
import { ActiveToggle } from "@/components/catalog/active-toggle";
import { formatBRL } from "@/lib/money";

function priceLabel(product: Awaited<ReturnType<typeof getCatalogOverview>>[number]) {
  const flavorPrices = product.flavors
    .map((f) => f.priceCents ?? product.genericPriceCents)
    .filter((p): p is number => p != null && p > 0);

  if (flavorPrices.length === 0) {
    return product.genericPriceCents ? formatBRL(product.genericPriceCents) : "Sem preço";
  }

  const min = Math.min(...flavorPrices);
  const max = Math.max(...flavorPrices);
  return min === max ? formatBRL(min) : `${formatBRL(min)} – ${formatBRL(max)}`;
}

export default async function CatalogPage() {
  const products = await getCatalogOverview();

  return (
    <div>
      <PageHeader
        title="Valores"
        description="Produtos, sabores e preços de venda."
        backHref="/admin"
        action={
          <Button asChild size="sm">
            <Link href="/admin/catalog/new">
              <Plus />
              Novo produto
            </Link>
          </Button>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Nenhum produto"
          description="Cadastre o primeiro produto com seus sabores e preços."
          action={
            <Button asChild size="sm">
              <Link href="/admin/catalog/new">
                <Plus />
                Novo produto
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {products.map((product) => {
            const activeFlavors = product.flavors.filter((f) => f.active);
            return (
              <div
                key={product.id}
                className="flex items-center gap-2 rounded-lg border bg-card pr-3"
              >
                <Link
                  href={`/admin/catalog/${product.id}/edit`}
                  className="flex min-w-0 flex-1 items-center gap-3 p-4 transition-colors hover:bg-muted/50 active:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{product.name}</span>
                      {!product.active && (
                        <Badge variant="secondary" className="text-xs">Inativo</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {activeFlavors.length > 0
                        ? `${activeFlavors.length} ${activeFlavors.length === 1 ? "sabor" : "sabores"} · ${activeFlavors.map((f) => f.name).join(", ")}`
                        : "Sem sabores"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                    {priceLabel(product)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
                <ActiveToggle entity="product" id={product.id} active={product.active} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
