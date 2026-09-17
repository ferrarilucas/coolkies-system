import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, ChefHat } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getProductionBatches } from "@/server/queries/production";
import { RowActions } from "@/components/shared/row-actions";
import { deleteProductionBatch } from "@/server/actions/production";

export default async function ProductionPage() {
  const batches = await getProductionBatches();

  return (
    <div>
      <PageHeader
        title="Produção"
        description="Histórico de produções"
        action={
          <Button asChild size="sm">
            <Link href="/products/new"><Plus />Registrar produção</Link>
          </Button>
        }
      />

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
                  <span className="font-medium">{b.item.name}</span>
                  <Badge variant="outline" className="tabular-nums text-xs">{b.quantity} un.</Badge>
                  {b.recipe && <Badge variant="secondary" className="text-xs">{b.recipe.name}</Badge>}
                </div>
                {b.variantLines.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {b.variantLines.map((f) => (
                      <span key={f.id} className="text-xs text-muted-foreground">
                        {f.quantity}× {f.variant.name}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {format(b.producedAt, "d 'de' MMMM yyyy", { locale: ptBR })}
                  {b.notes && ` · ${b.notes}`}
                </p>
              </div>
              <RowActions
                editHref={`/products/${b.id}/edit`}
                deleteTitle="Excluir produção"
                deleteDescription="Isso irá reverter o estoque adicionado por esta produção. Não é possível desfazer."
                deleteSuccessMessage="Produção excluída."
                onDelete={deleteProductionBatch.bind(null, b.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
