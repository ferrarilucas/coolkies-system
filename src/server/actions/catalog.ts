"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Ativar / desativar ─────────────────────────────

export async function toggleProductActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.product.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function toggleFlavorActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.flavor.update({ where: { id }, data: { active } });
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

// ─── Cadastro unificado (produto + sabores + preços) ─────────────────────────

export type ProductFlavorInput = {
  id: string | null;
  name: string;
  priceCents: number | null;
  fillingRecipeId: string | null;
  active: boolean;
};

export type SaveProductInput = {
  name: string;
  genericPriceCents: number | null;
  flavors: ProductFlavorInput[];
  removedFlavorIds: string[];
};

type PriceClient = Awaited<ReturnType<typeof getScopedDb>>["db"];

async function applyPrice(
  db: PriceClient,
  workspaceId: string,
  productId: string,
  flavorId: string | null,
  priceCents: number | null,
) {
  const existing = await db.priceListItem.findFirst({
    where: { productId, flavorId },
  });

  if (priceCents == null || priceCents <= 0) {
    if (existing) await db.priceListItem.delete({ where: { id: existing.id } });
    return;
  }

  if (!existing) {
    await db.priceListItem.create({
      data: { productId, flavorId, priceCents, workspaceId },
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

export async function saveProduct(
  productId: string | null,
  input: SaveProductInput,
): Promise<ActionResult<{ id: string; deactivated: string[] }>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: "Nome do produto é obrigatório." };

  const flavors = input.flavors
    .map((f) => ({ ...f, name: normalizeName(f.name) }))
    .filter((f) => f.name);

  const seen = new Set<string>();
  for (const f of flavors) {
    const key = f.name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Sabor "${f.name}" está duplicado.` };
    seen.add(key);
  }

  if (flavors.length === 0 && (input.genericPriceCents ?? 0) <= 0) {
    return { ok: false, error: "Defina um preço para o produto ou cadastre ao menos um sabor." };
  }

  const duplicateName = await db.product.findFirst({
    where: { name, ...(productId ? { id: { not: productId } } : {}) },
    select: { id: true },
  });
  if (duplicateName) return { ok: false, error: "Já existe um produto com esse nome." };

  const product = productId
    ? await db.product.update({ where: { id: productId }, data: { name } })
    : await db.product.create({ data: { name, workspaceId } });

  const deactivated: string[] = [];

  for (const flavorId of input.removedFlavorIds) {
    const used = await db.saleItem.count({ where: { flavorId } });
    const produced = await db.productionBatch.count({ where: { flavorId } });
    if (used > 0 || produced > 0) {
      const flavor = await db.flavor.update({
        where: { id: flavorId },
        data: { active: false },
      });
      deactivated.push(flavor.name);
    } else {
      await db.priceListItem.deleteMany({ where: { flavorId } });
      await db.flavor.delete({ where: { id: flavorId } });
    }
  }

  for (const flavor of flavors) {
    const saved = flavor.id
      ? await db.flavor.update({
          where: { id: flavor.id },
          data: {
            name: flavor.name,
            fillingRecipeId: flavor.fillingRecipeId,
            active: flavor.active,
          },
        })
      : await db.flavor.create({
          data: {
            name: flavor.name,
            productId: product.id,
            fillingRecipeId: flavor.fillingRecipeId,
            active: flavor.active,
            workspaceId,
          },
        });

    await applyPrice(db, workspaceId, product.id, saved.id, flavor.priceCents);
  }

  await applyPrice(db, workspaceId, product.id, null, input.genericPriceCents);

  revalidatePath("/admin/catalog");
  revalidatePath("/sales/new");
  return { ok: true, data: { id: product.id, deactivated } };
}
