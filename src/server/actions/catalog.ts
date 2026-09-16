"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Ativar / desativar ─────────────────────────────

export async function toggleItemActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.item.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function toggleVariantActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.variant.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function togglePriceActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.priceListItem.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

// ─── Cadastro unificado (item + variantes + preços) ─────────────────────────

export type ItemVariantInput = {
  id: string | null;
  name: string;
  priceCents: number | null;
  recipeId: string | null;
  active: boolean;
};

export type SaveItemInput = {
  name: string;
  genericPriceCents: number | null;
  variants: ItemVariantInput[];
  removedVariantIds: string[];
};

type PriceClient = Awaited<ReturnType<typeof getScopedDb>>["db"];

async function applyPrice(
  db: PriceClient,
  workspaceId: string,
  itemId: string,
  variantId: string | null,
  priceCents: number | null,
) {
  const existing = await db.priceListItem.findFirst({
    where: { itemId, variantId },
  });

  if (priceCents == null || priceCents <= 0) {
    if (existing) await db.priceListItem.delete({ where: { id: existing.id } });
    return;
  }

  if (!existing) {
    await db.priceListItem.create({
      data: { itemId, variantId, priceCents, workspaceId },
    });
    return;
  }

  if (existing.priceCents !== priceCents) {
    await db.priceHistory.create({
      data: { priceListItemId: existing.id, priceCents: existing.priceCents, workspaceId },
    });
    await db.priceListItem.update({
      where: { id: existing.id },
      data: { priceCents, active: true },
    });
  }
}

export async function saveItem(
  itemId: string | null,
  input: SaveItemInput,
): Promise<ActionResult<{ id: string; deactivated: string[] }>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: "Nome do produto é obrigatório." };

  const variants = input.variants
    .map((v) => ({ ...v, name: normalizeName(v.name) }))
    .filter((v) => v.name);

  const seen = new Set<string>();
  for (const v of variants) {
    const key = v.name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Sabor "${v.name}" está duplicado.` };
    seen.add(key);
  }

  if (variants.length === 0 && (input.genericPriceCents ?? 0) <= 0) {
    return { ok: false, error: "Defina um preço para o produto ou cadastre ao menos um sabor." };
  }

  const duplicateName = await db.item.findFirst({
    where: { name, ...(itemId ? { id: { not: itemId } } : {}) },
    select: { id: true },
  });
  if (duplicateName) return { ok: false, error: "Já existe um produto com esse nome." };

  const item = itemId
    ? await db.item.update({ where: { id: itemId }, data: { name } })
    : await db.item.create({ data: { name, sellable: true, workspaceId } });

  const deactivated: string[] = [];

  for (const variantId of input.removedVariantIds) {
    const used = await db.saleItem.count({ where: { variantId } });
    const produced = await db.productionBatch.count({ where: { variantId } });
    if (used > 0 || produced > 0) {
      const variant = await db.variant.update({
        where: { id: variantId },
        data: { active: false },
      });
      deactivated.push(variant.name);
    } else {
      await db.priceListItem.deleteMany({ where: { variantId } });
      await db.variant.delete({ where: { id: variantId } });
    }
  }

  for (const variant of variants) {
    const saved = variant.id
      ? await db.variant.update({
          where: { id: variant.id },
          data: {
            name: variant.name,
            recipeId: variant.recipeId,
            active: variant.active,
          },
        })
      : await db.variant.create({
          data: {
            name: variant.name,
            itemId: item.id,
            recipeId: variant.recipeId,
            active: variant.active,
            workspaceId,
          },
        });

    await applyPrice(db, workspaceId, item.id, saved.id, variant.priceCents);
  }

  await applyPrice(db, workspaceId, item.id, null, input.genericPriceCents);

  revalidatePath("/admin/catalog");
  revalidatePath("/sales/new");
  return { ok: true, data: { id: item.id, deactivated } };
}
