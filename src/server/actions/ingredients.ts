"use server";

import { revalidatePath } from "next/cache";
import { getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";
import { BaseUnit } from "@prisma/client";

export type ActionResult = { ok: boolean; error?: string };

function parseBaseUnit(value: string): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

export async function createIngredient(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };

  try {
    await db.ingredient.create({ data: { name, baseUnit, minStock, workspaceId } });
  } catch {
    return { ok: false, error: "Já existe um ingrediente com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function updateIngredient(id: string, formData: FormData): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };

  try {
    await db.ingredient.update({ where: { id }, data: { name, baseUnit, minStock } });
  } catch {
    return { ok: false, error: "Já existe um ingrediente com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function deleteIngredient(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");

  try {
    await db.ingredient.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir. O ingrediente pode estar em uso." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}
