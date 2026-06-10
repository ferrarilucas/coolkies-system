"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { BaseUnit } from "@prisma/client";

export type ActionResult = { ok: boolean; error?: string };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") throw new Error("Não autorizado");
}

function parseBaseUnit(value: string): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

export async function createIngredient(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };

  try {
    await db.ingredient.create({ data: { name, baseUnit, minStock } });
  } catch {
    return { ok: false, error: "Já existe um ingrediente com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function updateIngredient(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
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
  await requireAdmin();

  try {
    await db.ingredient.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir. O ingrediente pode estar em uso." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}
