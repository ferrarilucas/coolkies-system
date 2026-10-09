import Link from "next/link";
import { Tags, Plus, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCatalogOverview } from "@/server/queries/catalog";
import { ActiveToggle } from "@/components/catalog/active-toggle";
import { formatBRL } from "@/lib/money";
import { WriteGate } from "@/components/layout/read-only-context";

function priceLabel(product: Awaited<ReturnType<typeof getCatalogOverview>>[number]) {
  const variantPrices = product.variants
    .map((v) => v.priceCents ?? product.genericPriceCents)
    .filter((p): p is number => p != null && p > 0);

  if (variantPrices.length === 0) {
    return product.genericPriceCents ? formatBRL(product.genericPriceCents) : "Sem preço";
  }

  const min = Math.min(...variantPrices);
  const max = Math.max(...variantPrices);
  return min === max ? formatBRL(min) : `${formatBRL(min)} – ${formatBRL(max)}`;
}

export default async function CatalogPage() {
  const products = await getCatalogOverview();

  return (
    <div>
      <PageHeader
        title="Valores"
        description="Produtos, variações e preços de venda."
        backHref="/admin"
        action={
          <WriteGate>
            <Button asChild size="sm">
              <Link href="/admin/catalog/new">
                <Plus />
                Novo produto
              </Link>
            </Button>
          </WriteGate>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Nenhum produto"
          description="Cadastre o primeiro produto com suas variações e preços."
          action={
            <WriteGate>
              <Button asChild size="sm">
                <Link href="/admin/catalog/new">
                  <Plus />
                  Novo produto
                </Link>
              </Button>
            </WriteGate>
          }
        />
      ) : (
        <div className="space-y-2">
          {products.map((product) => {
            const activeVariants = product.variants.filter((v) => v.active);
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
                      {variantSummary(product.optionNames, activeVariants.map((v) => v.name))}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                    {priceLabel(product)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
                <ActiveToggle entity="item" id={product.id} active={product.active} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function variantSummary(optionNames: string[], names: string[]): string {
  if (names.length === 0) return "Sem variações";
  if (optionNames.length > 1) {
    return `${names.length} ${names.length === 1 ? "combinação" : "combinações"} · ${optionNames.join(" × ")}`;
  }
  return `${names.length} ${names.length === 1 ? "variação" : "variações"} · ${names.join(", ")}`;
}
