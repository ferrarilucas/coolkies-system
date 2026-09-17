import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getShoppingListItems, getShoppingListSuggestions } from "@/server/queries/shopping-list";
import { ShoppingListAddForm } from "@/components/stock/shopping-list-add-form";
import { ShoppingListSuggestions } from "@/components/stock/shopping-list-suggestions";
import { ShoppingListItemRow } from "@/components/stock/shopping-list-item-row";
import { getWorkspaceDb } from "@/server/tenant/context";

export default async function ShoppingListPage() {
  const db = await getWorkspaceDb();
  const [items, suggestions, availableItems] = await Promise.all([
    getShoppingListItems(),
    getShoppingListSuggestions(),
    db.item.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true, sellable: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Lista de compras" description="Adicione o que precisar comprar." backHref="/stock" />

      <ShoppingListAddForm items={availableItems} />

      <ShoppingListSuggestions suggestions={suggestions} />

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
