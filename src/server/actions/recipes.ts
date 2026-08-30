"use server";

import { revalidatePath } from "next/cache";
import { getScopedDb } from "@/server/tenant/context";
import { BaseUnit, Prisma } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Recipe ─────────────────────────────────────────────────────────────────

type IngredientLine = { ingredientId: string; quantity: number };

export async function saveRecipe(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");

  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const yieldQty = parseInt(String(formData.get("yieldQty") ?? "1"), 10);
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const stepsRaw = String(formData.get("steps") ?? "").trim();
  const ingredientsRaw = String(formData.get("ingredients") ?? "[]");

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (isNaN(yieldQty) || yieldQty < 1) return { ok: false, error: "Rendimento deve ser ≥ 1." };

  let steps: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  try {
    steps = stepsRaw ? (JSON.parse(stepsRaw) as Prisma.InputJsonValue) : Prisma.JsonNull;
  } catch {
    steps = Prisma.JsonNull;
  }

  let ingredients: IngredientLine[] = [];
  try {
    ingredients = JSON.parse(ingredientsRaw) as IngredientLine[];
  } catch {
    ingredients = [];
  }

  try {
    if (id) {
      // update: recria os RecipeIngredients em transação
      await db.$transaction([
        db.recipe.update({
          where: { id },
          data: { name, yieldQty, notes, steps },
        }),
        db.recipeIngredient.deleteMany({ where: { recipeId: id } }),
        ...(ingredients.length > 0
          ? [
              db.recipeIngredient.createMany({
                data: ingredients.map((ing) => ({
                  recipeId: id,
                  ingredientId: ing.ingredientId,
                  quantity: ing.quantity,
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
          ingredients: {
            create: ingredients.map((ing) => ({
              ingredientId: ing.ingredientId,
              quantity: ing.quantity,
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
  try {
    await db.recipe.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
  revalidatePath("/admin/recipes");
  return { ok: true };
}

// ─── Quick-add de ingrediente dentro do formulário de receita ────────────────

type IngredientData = { id: string; name: string; baseUnit: string };

export async function createIngredientInline(
  formData: FormData,
): Promise<ActionResult<IngredientData>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");

  const name = String(formData.get("name") ?? "").trim();
  const baseUnitRaw = String(formData.get("baseUnit") ?? "G");
  const baseUnit =
    baseUnitRaw === "ML" ? BaseUnit.ML : baseUnitRaw === "UN" ? BaseUnit.UN : BaseUnit.G;

  if (!name) return { ok: false, error: "Nome obrigatório." };

  try {
    const ingredient = await db.ingredient.create({ data: { name, baseUnit, workspaceId } });
    revalidatePath("/admin/ingredients");
    return { ok: true, data: { id: ingredient.id, name: ingredient.name, baseUnit: ingredient.baseUnit } };
  } catch {
    return { ok: false, error: "Já existe um ingrediente com esse nome." };
  }
}
