import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export default function ShoppingListPage() {
  return (
    <div>
      <PageHeader
        title="Lista de compras"
        description="Ingredientes a comprar (manuais e por estoque baixo)."
      />
      {/* TODO: itens manuais + auto-gerados quando ingrediente < minStock */}
      <EmptyState
        icon={ListChecks}
        title="Lista vazia"
        description="Itens aparecem aqui quando um ingrediente fica abaixo do estoque mínimo."
      />
    </div>
  );
}
