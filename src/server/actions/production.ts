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

  try {
    await db.$transaction(async (tx) => {
      // Cria o lote
      const batch = await tx.productionBatch.create({
        data: {
          productId,
          recipeId,
          userId: user.id,
          quantity,
          notes,
          producedAt,
        },
      });

      // Cria o StockMovement principal (produto sem sabor específico, ou soma geral)
      await tx.stockMovement.create({
        data: {
          productId,
          flavorId: null,
          type: StockMovementType.PRODUCTION,
          quantity,
          productionBatchId: batch.id,
        },
      });

      // Cria os recheios e StockMovements por sabor (os recheados)
      for (const filling of fillings) {
        if (!filling.flavorId || filling.quantity <= 0) continue;

        await tx.productionFilling.create({
          data: {
            productionBatchId: batch.id,
            flavorId: filling.flavorId,
            quantity: filling.quantity,
          },
        });

        // Adiciona ao estoque com sabor (são cookies distintos)
        await tx.stockMovement.create({
          data: {
            productId,
            flavorId: filling.flavorId,
            type: StockMovementType.PRODUCTION,
            quantity: filling.quantity,
          },
        });

        // Desconta os recheados do movimento genérico (sem sabor)
        // já que eles agora têm identidade própria
        await tx.stockMovement.create({
          data: {
            productId,
            flavorId: null,
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
