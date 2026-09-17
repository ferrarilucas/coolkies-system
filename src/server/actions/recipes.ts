"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { BaseUnit, Prisma } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Recipe ─────────────────────────────────────────────────────────────────

type ItemLine = { itemId: string; quantity: number };

export async function saveRecipe(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const yieldQty = parseInt(String(formData.get("yieldQty") ?? "1"), 10);
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const stepsRaw = String(formData.get("steps") ?? "").trim();
  const itemsRaw = String(formData.get("items") ?? "[]");

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (isNaN(yieldQty) || yieldQty < 1) return { ok: false, error: "Rendimento deve ser ≥ 1." };

  let steps: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  try {
    steps = stepsRaw ? (JSON.parse(stepsRaw) as Prisma.InputJsonValue) : Prisma.JsonNull;
  } catch {
    steps = Prisma.JsonNull;
  }

  let items: ItemLine[] = [];
  try {
    items = JSON.parse(itemsRaw) as ItemLine[];
  } catch {
    items = [];
  }

  try {
    if (id) {
      // update: recria os RecipeItems em transação
      await db.$transaction([
        db.recipe.update({
          where: { id },
          data: { name, yieldQty, notes, steps },
        }),
        db.recipeItem.deleteMany({ where: { recipeId: id } }),
        ...(items.length > 0
          ? [
              db.recipeItem.createMany({
                data: items.map((it) => ({
                  recipeId: id,
                  itemId: it.itemId,
                  quantity: it.quantity,
                  workspaceId,
                })),
              }),
            ]
          : []),
      ]);
      revalidatePath("/admin/recipes");
      return { ok: true, data: { id } };
    } else {
      const recipe = await db.recipe.create({
        data: {
          name,
          yieldQty,
          notes,
          steps,
          workspaceId,
          items: {
            create: items.map((it) => ({
              itemId: it.itemId,
              quantity: it.quantity,
              workspaceId,
            })),
          },
        },
      });
      revalidatePath("/admin/recipes");
      return { ok: true, data: { id: recipe.id } };
    }
  } catch {
    return { ok: false, error: "Erro ao salvar. Verifique se o nome já existe." };
  }
}

export async function deleteRecipe(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  try {
    await db.recipe.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
  revalidatePath("/admin/recipes");
  return { ok: true };
}

// ─── Quick-add de item dentro do formulário de receita ───────────────────────

type ItemData = { id: string; name: string; unit: string };

export async function createItemInline(formData: FormData): Promise<ActionResult<ItemData>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = String(formData.get("name") ?? "").trim();
  const unitRaw = String(formData.get("unit") ?? "G");
  const unit = unitRaw === "ML" ? BaseUnit.ML : unitRaw === "UN" ? BaseUnit.UN : BaseUnit.G;

  if (!name) return { ok: false, error: "Nome obrigatório." };

  try {
    const item = await db.item.create({ data: { name, unit, productionInput: true, workspaceId } });
    revalidatePath("/admin/ingredients");
    return { ok: true, data: { id: item.id, name: item.name, unit: item.unit } };
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }
}
