"use server";

import { revalidatePath } from "next/cache";
import { BaseUnit } from "@prisma/client";
import { getScopedDb, assertCanWrite } from "@/server/tenant/context";
import { getShoppingListSuggestions } from "@/server/queries/shopping-list";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function createShoppingListItem(formData: FormData): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    const itemId = String(formData.get("itemId") ?? "").trim() || null;
    const label = String(formData.get("label") ?? "").trim();
    const quantityRaw = String(formData.get("quantity") ?? "").trim();
    const quantity = quantityRaw ? parseFloat(quantityRaw.replace(",", ".")) : null;
    const unitRaw = String(formData.get("unit") ?? "").trim();
    const unit = unitRaw ? (unitRaw as BaseUnit) : null;

    if (!label) return { ok: false, error: "Descreva o item." };

    await db.shoppingListItem.create({ data: { workspaceId, itemId, label, quantity, unit } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function updateShoppingListItem(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    const label = String(formData.get("label") ?? "").trim();
    const quantityRaw = String(formData.get("quantity") ?? "").trim();
    const quantity = quantityRaw ? parseFloat(quantityRaw.replace(",", ".")) : null;
    const unitRaw = String(formData.get("unit") ?? "").trim();
    const unit = unitRaw ? (unitRaw as BaseUnit) : null;

    if (!label) return { ok: false, error: "Descreva o item." };

    await db.shoppingListItem.updateMany({ where: { id, workspaceId }, data: { label, quantity, unit } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function deleteShoppingListItem(id: string): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();
    await db.shoppingListItem.deleteMany({ where: { id, workspaceId } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function toggleShoppingListItem(id: string, done: boolean): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();
    await db.shoppingListItem.updateMany({ where: { id, workspaceId }, data: { done } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function addSuggestedItem(itemId: string): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    const suggestions = await getShoppingListSuggestions();
    const suggestion = suggestions.find((s) => s.itemId === itemId);
    if (!suggestion) return { ok: false, error: "Sugestão não encontrada." };

    await db.shoppingListItem.create({
      data: {
        workspaceId,
        itemId: suggestion.itemId,
        label: suggestion.itemName,
        quantity: suggestion.deficit,
        unit: suggestion.unit as BaseUnit,
      },
    });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
