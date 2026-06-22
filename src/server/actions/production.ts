"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");
  return session.user;
}

type FillingInput = { flavorId: string; quantity: number };

// ─── Criar produção ───────────────────────────────────────────────────────────

export async function createProductionBatch(formData: FormData): Promise<ActionResult> {
  const user = await requireSession();

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
      data: { productId, recipeId, userId: user.id, quantity, notes, producedAt },
    });

    for (const filling of fillings.filter((f) => f.flavorId && f.quantity > 0)) {
      await db.productionFilling.create({
        data: { productionBatchId: batch.id, flavorId: filling.flavorId, quantity: filling.quantity },
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
  await requireSession();

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
        data: { productionBatchId: id, flavorId: filling.flavorId, quantity: filling.quantity },
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
  await requireSession();
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
