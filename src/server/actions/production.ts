"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";

type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

type FillingInput = { flavorId: string; quantity: number };

// ─── Criar produção ───────────────────────────────────────────────────────────

export async function createProductionBatch(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId, userId } = await getScopedDb();
  await assertCanWrite();

  const productId = String(formData.get("productId") ?? "").trim();
  const recipeId = String(formData.get("recipeId") ?? "").trim() || null;
  const quantity = parseInt(String(formData.get("quantity") ?? "0"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const producedAtRaw = String(formData.get("producedAt") ?? "").trim();
  const producedAt = producedAtRaw ? new Date(`${producedAtRaw}T12:00:00`) : new Date();

  const fillingsRaw = String(formData.get("fillings") ?? "[]");
  let fillings: FillingInput[] = [];
  try { fillings = JSON.parse(fillingsRaw); } catch { /* noop */ }

  if (!productId) return { ok: false, error: "Selecione um produto." };
  if (quantity <= 0) return { ok: false, error: "Quantidade deve ser maior que zero." };

  const fillingsTotal = fillings.reduce((s, f) => s + f.quantity, 0);
  if (fillings.length > 0 && fillingsTotal !== quantity) {
    return { ok: false, error: `Total distribuído (${fillingsTotal}) deve ser igual à quantidade produzida (${quantity}).` };
  }

  try {
    const batch = await db.productionBatch.create({
      data: { productId, recipeId, userId, quantity, notes, producedAt, workspaceId },
    });

    for (const filling of fillings.filter((f) => f.flavorId && f.quantity > 0)) {
      await db.productionFilling.create({
        data: {
          productionBatchId: batch.id,
          flavorId: filling.flavorId,
          quantity: filling.quantity,
          workspaceId,
        },
      });
    }

    revalidatePath("/products");
    revalidatePath("/pantry");
    return { ok: true };
  } catch (e) {
    console.error("createProductionBatch error:", e);
    return { ok: false, error: "Erro ao registrar produção." };
  }
}

// ─── Atualizar produção ───────────────────────────────────────────────────────

export async function updateProductionBatch(id: string, formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb();
  await assertCanWrite();

  const productId = String(formData.get("productId") ?? "").trim();
  const recipeId = String(formData.get("recipeId") ?? "").trim() || null;
  const quantity = parseInt(String(formData.get("quantity") ?? "0"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const producedAtRaw = String(formData.get("producedAt") ?? "").trim();
  const producedAt = producedAtRaw ? new Date(`${producedAtRaw}T12:00:00`) : new Date();

  const fillingsRaw = String(formData.get("fillings") ?? "[]");
  let fillings: FillingInput[] = [];
  try { fillings = JSON.parse(fillingsRaw); } catch { /* noop */ }

  if (!productId) return { ok: false, error: "Selecione um produto." };
  if (quantity <= 0) return { ok: false, error: "Quantidade deve ser maior que zero." };

  const fillingsTotal = fillings.reduce((s, f) => s + f.quantity, 0);
  if (fillings.length > 0 && fillingsTotal !== quantity) {
    return { ok: false, error: `Total distribuído (${fillingsTotal}) deve ser igual à quantidade produzida (${quantity}).` };
  }

  try {
    // Remove recheios antigos e recria
    await db.productionFilling.deleteMany({ where: { productionBatchId: id } });

    await db.productionBatch.update({
      where: { id },
      data: { productId, recipeId, quantity, notes, producedAt },
    });

    for (const filling of fillings.filter((f) => f.flavorId && f.quantity > 0)) {
      await db.productionFilling.create({
        data: {
          productionBatchId: id,
          flavorId: filling.flavorId,
          quantity: filling.quantity,
          workspaceId,
        },
      });
    }

    revalidatePath("/products");
    revalidatePath("/pantry");
    return { ok: true };
  } catch (e) {
    console.error("updateProductionBatch error:", e);
    return { ok: false, error: "Erro ao atualizar produção." };
  }
}

// ─── Excluir produção ─────────────────────────────────────────────────────────

export async function deleteProductionBatch(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  try {
    await db.productionFilling.deleteMany({ where: { productionBatchId: id } });
    await db.productionBatch.delete({ where: { id } });
    revalidatePath("/products");
    revalidatePath("/pantry");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
}
