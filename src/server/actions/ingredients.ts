"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";
import { BaseUnit, type PrismaClient } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function parseBaseUnit(value: string): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

function parseResaleFlags(formData: FormData): { isRawMaterial: boolean; forResale: boolean } {
  return {
    isRawMaterial: formData.get("isRawMaterial") === "on",
    forResale: formData.get("forResale") === "on",
  };
}

type ProductClient = Pick<PrismaClient, "product">;

/**
 * Garante que o Product vinculado a um insumo reflita a finalidade "revenda":
 * cria na primeira vez, reativa se já existia, desativa (sem apagar) quando
 * o insumo deixa de ser revenda.
 */
async function syncResaleProduct(
  db: ProductClient,
  workspaceId: string,
  existingProductId: string | null,
  forResale: boolean,
  name: string,
): Promise<string | null> {
  if (forResale) {
    if (existingProductId) {
      await db.product.update({ where: { id: existingProductId }, data: { name, active: true } });
      return existingProductId;
    }
    const product = await db.product.create({ data: { name, workspaceId } });
    return product.id;
  }
  if (existingProductId) {
    await db.product.update({ where: { id: existingProductId }, data: { active: false } });
  }
  return existingProductId;
}

export async function createIngredient(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { isRawMaterial, forResale } = parseResaleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  if (!isRawMaterial && !forResale) return { ok: false, error: "Marque matéria-prima e/ou revenda." };
  if (forResale && baseUnit !== BaseUnit.UN) {
    return { ok: false, error: "Revenda só é permitida para insumos com unidade \"Unidade (un)\"." };
  }

  try {
    await db.$transaction(async (tx) => {
      const resaleProductId = await syncResaleProduct(tx, workspaceId, null, forResale, name);
      await tx.ingredient.create({
        data: { name, baseUnit, minStock, isRawMaterial, forResale, resaleProductId, workspaceId },
      });
    });
  } catch {
    return { ok: false, error: "Já existe um ingrediente ou produto com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function updateIngredient(id: string, formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { isRawMaterial, forResale } = parseResaleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  if (!isRawMaterial && !forResale) return { ok: false, error: "Marque matéria-prima e/ou revenda." };
  if (forResale && baseUnit !== BaseUnit.UN) {
    return { ok: false, error: "Revenda só é permitida para insumos com unidade \"Unidade (un)\"." };
  }

  try {
    const existing = await db.ingredient.findUniqueOrThrow({
      where: { id },
      select: { resaleProductId: true },
    });
    const resaleProductId = await syncResaleProduct(db, workspaceId, existing.resaleProductId, forResale, name);
    await db.ingredient.update({
      where: { id },
      data: { name, baseUnit, minStock, isRawMaterial, forResale, resaleProductId },
    });
  } catch {
    return { ok: false, error: "Já existe um ingrediente ou produto com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function deleteIngredient(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  try {
    await db.ingredient.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir. O ingrediente pode estar em uso." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export type IngredientInlineData = {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  isRawMaterial: boolean;
  forResale: boolean;
};

/** Criação inline usada pelo formulário de compra (Task 4/10) — permite já marcar revenda. */
export async function createIngredientForPurchase(
  formData: FormData,
): Promise<ActionResult<IngredientInlineData>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const { isRawMaterial, forResale } = parseResaleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (!isRawMaterial && !forResale) return { ok: false, error: "Marque matéria-prima e/ou revenda." };
  if (forResale && baseUnit !== BaseUnit.UN) {
    return { ok: false, error: "Revenda só é permitida para insumos com unidade \"Unidade (un)\"." };
  }

  try {
    const ingredient = await db.$transaction(async (tx) => {
      const resaleProductId = await syncResaleProduct(tx, workspaceId, null, forResale, name);
      return tx.ingredient.create({
        data: { name, baseUnit, isRawMaterial, forResale, resaleProductId, workspaceId },
      });
    });
    revalidatePath("/admin/ingredients");
    return {
      ok: true,
      data: { id: ingredient.id, name: ingredient.name, baseUnit: ingredient.baseUnit, isRawMaterial, forResale },
    };
  } catch {
    return { ok: false, error: "Já existe um ingrediente ou produto com esse nome." };
  }
}
