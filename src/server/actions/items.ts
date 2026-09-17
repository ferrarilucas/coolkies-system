"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";
import { BaseUnit } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function parseUnit(value: string): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

function parseRoleFlags(formData: FormData): { productionInput: boolean; sellable: boolean } {
  return {
    productionInput: formData.get("productionInput") === "on",
    sellable: formData.get("sellable") === "on",
  };
}

function validateRoles(productionInput: boolean, sellable: boolean, unit: BaseUnit): string | null {
  if (!productionInput && !sellable) return "Marque insumo de produção e/ou venda.";
  if (sellable && unit !== BaseUnit.UN) return "Venda só é permitida para itens com unidade \"Unidade (un)\".";
  return null;
}

export async function createItem(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const unit = parseUnit(String(formData.get("unit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { productionInput, sellable } = parseRoleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  const roleError = validateRoles(productionInput, sellable, unit);
  if (roleError) return { ok: false, error: roleError };

  try {
    await db.item.create({ data: { name, unit, minStock, productionInput, sellable, workspaceId } });
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function updateItem(id: string, formData: FormData): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const unit = parseUnit(String(formData.get("unit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { productionInput, sellable } = parseRoleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  const roleError = validateRoles(productionInput, sellable, unit);
  if (roleError) return { ok: false, error: roleError };

  try {
    await db.item.update({ where: { id }, data: { name, unit, minStock, productionInput, sellable } });
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function deleteItem(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  try {
    await db.item.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir. O item pode estar em uso." };
  }
  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export type ItemInlineData = {
  id: string;
  name: string;
  unit: BaseUnit;
  productionInput: boolean;
  sellable: boolean;
};

export async function createItemForPurchase(
  formData: FormData,
): Promise<ActionResult<ItemInlineData>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const unit = parseUnit(String(formData.get("unit") ?? "G"));
  const { productionInput, sellable } = parseRoleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  const roleError = validateRoles(productionInput, sellable, unit);
  if (roleError) return { ok: false, error: roleError };

  try {
    const item = await db.item.create({ data: { name, unit, productionInput, sellable, workspaceId } });
    revalidatePath("/admin/ingredients");
    return { ok: true, data: { id: item.id, name: item.name, unit: item.unit, productionInput, sellable } };
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }
}
