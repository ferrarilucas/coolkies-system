import Link from "next/link";
import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getShoppingListItems, getShoppingListSuggestions } from "@/server/queries/shopping-list";
import { ShoppingListAddForm } from "@/components/stock/shopping-list-add-form";
import { ShoppingListSuggestions } from "@/components/stock/shopping-list-suggestions";
import { ShoppingListItemRow } from "@/components/stock/shopping-list-item-row";
import { getWorkspaceContext, getWorkspaceDb } from "@/server/tenant/context";
import { workspaceHasFeature } from "@/server/tenant/features";

export default async function ShoppingListPage() {
  const { workspaceId } = await getWorkspaceContext();
  const [db, canSuggest] = await Promise.all([
    getWorkspaceDb(),
    workspaceHasFeature(workspaceId, "autoShoppingList"),
  ]);
  const [items, suggestions, availableItems] = await Promise.all([
    getShoppingListItems(),
    canSuggest ? getShoppingListSuggestions() : Promise.resolve([]),
    db.item.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        sellable: true,
        variants: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Lista de compras" description="Adicione o que precisar comprar." backHref="/stock" />

      <ShoppingListAddForm items={availableItems} />

      {canSuggest ? (
        <ShoppingListSuggestions suggestions={suggestions} />
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Sugestões automáticas pelo estoque mínimo fazem parte do plano Cresce.{" "}
          <Link href="/workspaces/plan" className="font-medium text-primary underline-offset-4 hover:underline">
            Ver planos
          </Link>
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState icon={ListChecks} title="Sua lista está vazia" description="Adicione um item acima." />
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Sua lista</h2>
          {items.map((item) => (
            <ShoppingListItemRow key={item.id} id={item.id} itemId={item.itemId} label={item.label} quantity={item.quantity} unit={item.unit} />
          ))}
        </div>
      )}
    </div>
  );
}
