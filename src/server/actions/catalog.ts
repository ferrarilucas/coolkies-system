"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeName } from "@/lib/text";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") throw new Error("Não autorizado");
}

// ─── Products ───────────────────────────────────────

export async function createProduct(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) return { ok: false, error: "Nome obrigatório." };

  try {
    await db.product.create({ data: { name } });
  } catch {
    return { ok: false, error: "Já existe um produto com esse nome." };
  }

  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function updateProduct(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) return { ok: false, error: "Nome obrigatório." };

  try {
    await db.product.update({ where: { id }, data: { name } });
  } catch {
    return { ok: false, error: "Já existe um produto com esse nome." };
  }

  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function toggleProductActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  await db.product.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

// ─── Flavors ────────────────────────────────────────

export async function createFlavor(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = normalizeName(String(formData.get("name") ?? ""));
  const productId = String(formData.get("productId") ?? "").trim();
  const fillingRecipeId = String(formData.get("fillingRecipeId") ?? "").trim() || null;
  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (!productId) return { ok: false, error: "Produto obrigatório." };

  try {
    await db.flavor.create({ data: { name, productId, fillingRecipeId } });
  } catch {
    return { ok: false, error: "Já existe um sabor com esse nome para este produto." };
  }

  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function updateFlavor(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = normalizeName(String(formData.get("name") ?? ""));
  const fillingRecipeId = String(formData.get("fillingRecipeId") ?? "").trim() || null;
  if (!name) return { ok: false, error: "Nome obrigatório." };

  try {
    await db.flavor.update({ where: { id }, data: { name, fillingRecipeId } });
  } catch {
    return { ok: false, error: "Já existe um sabor com esse nome para este produto." };
  }

  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function toggleFlavorActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  await db.flavor.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

// ─── Prices ─────────────────────────────────────────

export async function upsertPrice(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const productId = String(formData.get("productId") ?? "").trim();
  const flavorId = String(formData.get("flavorId") ?? "").trim() || null;
  const priceCents = parseInt(String(formData.get("priceCents") ?? "0"), 10);

  if (!productId) return { ok: false, error: "Produto obrigatório." };
  if (isNaN(priceCents) || priceCents < 0) return { ok: false, error: "Preço inválido." };

  // upsert PriceListItem — findFirst lida melhor com flavorId nullable
  const existing = await db.priceListItem.findFirst({
    where: { productId, flavorId: flavorId ?? null },
  });

  if (existing) {
    if (existing.priceCents !== priceCents) {
      // save history before update
      await db.priceHistory.create({
        data: { priceListItemId: existing.id, priceCents: existing.priceCents },
      });
      await db.priceListItem.update({
        where: { id: existing.id },
        data: { priceCents, active: true },
      });
    }
  } else {
    await db.priceListItem.create({
      data: { productId, flavorId, priceCents },
    });
  }

  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function togglePriceActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  await db.priceListItem.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}
