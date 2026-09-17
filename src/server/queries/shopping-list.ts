import { getWorkspaceDb } from "@/server/tenant/context";
import { getItemStock } from "./production";

export type ShoppingListEntry = {
  id: string;
  itemId: string | null;
  label: string;
  quantity: number | null;
  unit: string | null;
};

export async function getShoppingListItems(): Promise<ShoppingListEntry[]> {
  const db = await getWorkspaceDb();
  const items = await db.shoppingListItem.findMany({
    where: { done: false },
    orderBy: { createdAt: "asc" },
  });
  return items.map((i) => ({ id: i.id, itemId: i.itemId, label: i.label, quantity: i.quantity, unit: i.unit }));
}

export type ShoppingListSuggestion = {
  itemId: string;
  itemName: string;
  unit: string;
  deficit: number;
  estimatedCents: number | null;
};

export async function getShoppingListSuggestions(): Promise<ShoppingListSuggestion[]> {
  const db = await getWorkspaceDb();
  const stock = await getItemStock();
  const pending = await db.shoppingListItem.findMany({ where: { done: false, itemId: { not: null } }, select: { itemId: true } });
  const pendingIds = new Set(pending.map((p) => p.itemId));

  return stock
    .filter((s) => s.variantId == null && s.belowMin && s.minStock != null && !pendingIds.has(s.itemId))
    .map((s) => {
      const deficit = Math.max(0, (s.minStock ?? 0) - s.current);
      const estimatedCents = s.latestPriceCents != null ? Math.round(deficit * s.latestPriceCents) : null;
      return { itemId: s.itemId, itemName: s.itemName, unit: s.unit, deficit, estimatedCents };
    });
}
