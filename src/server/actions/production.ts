"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { StockMovementType } from "@prisma/client";

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
  const flavorId = String(formData.get("flavorId") ?? "").trim() || null;
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

  try {
    await db.$transaction(async (tx) => {
      const batch = await tx.productionBatch.create({
        data: { productId, flavorId, recipeId, userId: user.id, quantity, notes, producedAt },
      });

      // Movimento principal: todos os cookies vão para o sabor base (ou null se não informado)
      await tx.stockMovement.create({
        data: {
          productId,
          flavorId,
          type: StockMovementType.PRODUCTION,
          quantity,
          productionBatchId: batch.id,
        },
      });

      // Recheios: adicionam ao estoque do sabor do recheio e descontam do sabor base
      for (const filling of fillings) {
        if (!filling.flavorId || filling.quantity <= 0) continue;

        await tx.productionFilling.create({
          data: { productionBatchId: batch.id, flavorId: filling.flavorId, quantity: filling.quantity },
        });

        // Entrada no estoque com o sabor do recheio
        await tx.stockMovement.create({
          data: {
            productId,
            flavorId: filling.flavorId,
            type: StockMovementType.PRODUCTION,
            quantity: filling.quantity,
          },
        });

        // Saída do sabor base (ou null)
        await tx.stockMovement.create({
          data: {
            productId,
            flavorId,
            type: StockMovementType.ADJUSTMENT,
            quantity: -filling.quantity,
            reason: `Convertidos para sabor ${filling.flavorId}`,
          },
        });
      }
    });

    revalidatePath("/products");
    revalidatePath("/pantry");
    return { ok: true };
  } catch {
    return { ok: false, error: "Erro ao registrar produção." };
  }
}

// ─── Atualizar produção ───────────────────────────────────────────────────────

export async function updateProductionBatch(id: string, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const productId = String(formData.get("productId") ?? "").trim();
  const flavorId = String(formData.get("flavorId") ?? "").trim() || null;
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

  try {
    await db.$transaction(async (tx) => {
      // Remove movimentos e recheios antigos
      await tx.stockMovement.deleteMany({ where: { productionBatchId: id } });
      await tx.productionFilling.deleteMany({ where: { productionBatchId: id } });

      // Atualiza o lote
      await tx.productionBatch.update({
        where: { id },
        data: { productId, flavorId, recipeId, quantity, notes, producedAt },
      });

      // Recria movimento principal
      await tx.stockMovement.create({
        data: {
          productId,
          flavorId,
          type: StockMovementType.PRODUCTION,
          quantity,
          productionBatchId: id,
        },
      });

      // Recria recheios
      for (const filling of fillings) {
        if (!filling.flavorId || filling.quantity <= 0) continue;

        await tx.productionFilling.create({
          data: { productionBatchId: id, flavorId: filling.flavorId, quantity: filling.quantity },
        });

        await tx.stockMovement.create({
          data: {
            productId,
            flavorId: filling.flavorId,
            type: StockMovementType.PRODUCTION,
            quantity: filling.quantity,
          },
        });

        await tx.stockMovement.create({
          data: {
            productId,
            flavorId,
            type: StockMovementType.ADJUSTMENT,
            quantity: -filling.quantity,
            reason: `Convertidos para sabor ${filling.flavorId}`,
          },
        });
      }
    });

    revalidatePath("/products");
    revalidatePath("/pantry");
    return { ok: true };
  } catch {
    return { ok: false, error: "Erro ao atualizar produção." };
  }
}

// ─── Excluir produção ─────────────────────────────────────────────────────────

export async function deleteProductionBatch(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await db.$transaction([
      db.stockMovement.deleteMany({ where: { productionBatchId: id } }),
      db.productionBatch.delete({ where: { id } }),
    ]);
    revalidatePath("/products");
    revalidatePath("/pantry");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
}
