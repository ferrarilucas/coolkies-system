"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import type { Prisma } from "@prisma/client";

type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

type VariantLineInput = { variantId: string; quantity: number };

async function computeRecipeConsumption(
  tx: Prisma.TransactionClient,
  recipeId: string,
  quantity: number,
  variantLines: VariantLineInput[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, include: { items: true } });
  if (!recipe) return map;
  const yieldQty = recipe.yieldQty || 1;
  const batchesCount = quantity / yieldQty;
  for (const ri of recipe.items) {
    map.set(ri.itemId, (map.get(ri.itemId) ?? 0) + ri.quantity * batchesCount);
  }

  for (const line of variantLines) {
    const variant = await tx.variant.findUnique({
      where: { id: line.variantId },
      include: { recipe: { include: { items: true } } },
    });
    if (!variant?.recipe) continue;
    for (const ri of variant.recipe.items) {
      map.set(ri.itemId, (map.get(ri.itemId) ?? 0) + ri.quantity * line.quantity);
    }
  }
  return map;
}

async function writeProductionMovements(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  batchId: string,
  itemId: string,
  recipeId: string | null,
  quantity: number,
  variantLines: VariantLineInput[],
) {
  const activeLines = variantLines.filter((l) => l.variantId && l.quantity > 0);

  for (const line of activeLines) {
    await tx.productionVariantLine.create({
      data: { productionBatchId: batchId, variantId: line.variantId, quantity: line.quantity, workspaceId },
    });
    await tx.stockMovement.create({
      data: { itemId, variantId: line.variantId, type: "PRODUCTION", quantity: line.quantity, productionBatchId: batchId, workspaceId },
    });
  }
  if (activeLines.length === 0) {
    await tx.stockMovement.create({
      data: { itemId, type: "PRODUCTION", quantity, productionBatchId: batchId, workspaceId },
    });
  }

  if (recipeId) {
    const consumption = await computeRecipeConsumption(tx, recipeId, quantity, activeLines);
    for (const [consumedItemId, consumedQty] of consumption) {
      if (consumedQty <= 0) continue;
      await tx.stockMovement.create({
        data: { itemId: consumedItemId, type: "CONSUMPTION", quantity: -Math.round(consumedQty), productionBatchId: batchId, workspaceId },
      });
    }
  }
}

function parseForm(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "").trim();
  const recipeId = String(formData.get("recipeId") ?? "").trim() || null;
  const quantity = parseInt(String(formData.get("quantity") ?? "0"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const producedAtRaw = String(formData.get("producedAt") ?? "").trim();
  const producedAt = producedAtRaw ? new Date(`${producedAtRaw}T12:00:00`) : new Date();
  let variantLines: VariantLineInput[] = [];
  try {
    variantLines = JSON.parse(String(formData.get("variantLines") ?? "[]"));
  } catch {
    variantLines = [];
  }
  return { itemId, recipeId, quantity, notes, producedAt, variantLines };
}

function validate(itemId: string, quantity: number, variantLines: VariantLineInput[]): string | null {
  if (!itemId) return "Selecione um item.";
  if (quantity <= 0) return "Quantidade deve ser maior que zero.";
  const total = variantLines.reduce((s, l) => s + l.quantity, 0);
  if (variantLines.length > 0 && total !== quantity) {
    return `Total distribuído (${total}) deve ser igual à quantidade produzida (${quantity}).`;
  }
  return null;
}

export async function createProductionBatch(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId, userId } = await getScopedDb();
  await assertCanWrite();

  const { itemId, recipeId, quantity, notes, producedAt, variantLines } = parseForm(formData);
  const error = validate(itemId, quantity, variantLines);
  if (error) return { ok: false, error };

  try {
    await db.$transaction(async (tx) => {
      const batch = await tx.productionBatch.create({
        data: { itemId, recipeId, userId, quantity, notes, producedAt, workspaceId },
      });
      await writeProductionMovements(tx, workspaceId, batch.id, itemId, recipeId, quantity, variantLines);
    });
    revalidatePath("/products");
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    console.error("createProductionBatch error:", e);
    return { ok: false, error: "Erro ao registrar produção." };
  }
}

export async function updateProductionBatch(id: string, formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb();
  await assertCanWrite();

  const { itemId, recipeId, quantity, notes, producedAt, variantLines } = parseForm(formData);
  const error = validate(itemId, quantity, variantLines);
  if (error) return { ok: false, error };

  try {
    await db.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { productionBatchId: id } });
      await tx.productionVariantLine.deleteMany({ where: { productionBatchId: id } });
      await tx.productionBatch.update({ where: { id }, data: { itemId, recipeId, quantity, notes, producedAt } });
      await writeProductionMovements(tx, workspaceId, id, itemId, recipeId, quantity, variantLines);
    });
    revalidatePath("/products");
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    console.error("updateProductionBatch error:", e);
    return { ok: false, error: "Erro ao atualizar produção." };
  }
}

export async function deleteProductionBatch(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  try {
    await db.$transaction([
      db.stockMovement.deleteMany({ where: { productionBatchId: id } }),
      db.productionVariantLine.deleteMany({ where: { productionBatchId: id } }),
      db.productionBatch.delete({ where: { id } }),
    ]);
    revalidatePath("/products");
    revalidatePath("/stock");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
}
