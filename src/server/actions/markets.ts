"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toBaseUnit, type InputUnit } from "@/lib/units";

type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");
  return session.user;
}

// ─── Mercados ─────────────────────────────────────────────────────────────────

export async function createMarket(
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    const market = await db.market.create({ data: { name } });
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
  await requireSession();
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
  await requireSession();
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
  const user = await requireSession();

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
      userId: user.id,
      quantity,
      unit,
      pricePaidCents,
      purchasedAt,
    },
  });

  revalidatePath("/markets");
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<ActionResult> {
  await requireSession();
  await db.ingredientPurchase.delete({ where: { id } });
  revalidatePath("/markets");
  return { ok: true };
}
