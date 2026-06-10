"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CustomerSummary } from "@/server/queries/customers";

type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");
  return session.user;
}

export async function createCustomer(
  formData: FormData,
): Promise<ActionResult<CustomerSummary>> {
  await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const sector = String(formData.get("sector") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    const customer = await db.customer.create({
      data: { name, email, phone, sector, notes },
      select: { id: true, name: true, email: true, phone: true, sector: true },
    });
    revalidatePath("/customers");
    return { ok: true, data: customer };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint") && msg.includes("email")) {
      return { ok: false, error: "Este e-mail já está cadastrado." };
    }
    return { ok: false, error: "Erro ao criar cliente." };
  }
}

export async function updateCustomer(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const sector = String(formData.get("sector") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    await db.customer.update({ where: { id }, data: { name, email, phone, sector, notes } });
    revalidatePath("/customers");
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint") && msg.includes("email")) {
      return { ok: false, error: "Este e-mail já está cadastrado." };
    }
    return { ok: false, error: "Erro ao atualizar cliente." };
  }
}

export async function deleteCustomer(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await db.customer.delete({ where: { id } });
    revalidatePath("/customers");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir. Verifique se há vendas vinculadas." };
  }
}
