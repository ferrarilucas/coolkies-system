"use server";

import { revalidatePath } from "next/cache";
import { getScopedDb } from "@/server/tenant/context";
import { toBaseUnit, type InputUnit } from "@/lib/units";

type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Mercados ─────────────────────────────────────────────────────────────────

export async function createMarket(
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    const market = await db.market.create({ data: { name, workspaceId } });
    revalidatePath("/markets");
    return { ok: true, data: { id: market.id, name: market.name } };
  } catch {
    return { ok: false, error: "Já existe um mercado com esse nome." };
  }
}

export async function updateMarket(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    await db.market.update({ where: { id }, data: { name } });
    revalidatePath("/markets");
    return { ok: true };
  } catch {
    return { ok: false, error: "Já existe um mercado com esse nome." };
  }
}

export async function deleteMarket(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  try {
    await db.market.delete({ where: { id } });
    revalidatePath("/markets");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
}

// ─── Compras ──────────────────────────────────────────────────────────────────

export async function createPurchase(
  formData: FormData,
): Promise<ActionResult> {
  const { db, workspaceId, userId } = await getScopedDb();

  const marketId = String(formData.get("marketId") ?? "").trim();
  const ingredientId = String(formData.get("ingredientId") ?? "").trim();
  const qtyRaw = parseFloat(String(formData.get("quantity") ?? "0"));
  const inputUnit = String(formData.get("unit") ?? "G") as InputUnit;
  const pricePaidCents = parseInt(String(formData.get("pricePaidCents") ?? "0"));
  const purchasedAtRaw = String(formData.get("purchasedAt") ?? "").trim();
  const purchasedAt = purchasedAtRaw
    ? new Date(`${purchasedAtRaw}T12:00:00`)
    : new Date();

  if (!marketId) return { ok: false, error: "Selecione um mercado." };
  if (!ingredientId) return { ok: false, error: "Selecione um ingrediente." };
  if (isNaN(qtyRaw) || qtyRaw <= 0) return { ok: false, error: "Quantidade inválida." };
  if (pricePaidCents <= 0) return { ok: false, error: "Informe o preço pago." };

  const { quantity, unit } = toBaseUnit(qtyRaw, inputUnit);

  await db.ingredientPurchase.create({
    data: {
      marketId,
      ingredientId,
      userId,
      quantity,
      unit,
      pricePaidCents,
      purchasedAt,
      workspaceId,
    },
  });

  revalidatePath("/markets");
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await db.ingredientPurchase.delete({ where: { id } });
  revalidatePath("/markets");
  return { ok: true };
}
