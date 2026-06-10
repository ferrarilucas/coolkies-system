"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/allowlist";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") throw new Error("Não autorizado");
}

export type ActionResult = { ok: boolean; error?: string };

export async function addAllowedEmail(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = String(formData.get("role") ?? "USER") === "ADMIN" ? "ADMIN" : "USER";
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!email || !email.includes("@")) {
    return { ok: false, error: "E-mail inválido." };
  }

  try {
    await db.allowedEmail.upsert({
      where: { email },
      update: { role, note },
      create: { email, role, note },
    });
  } catch {
    return { ok: false, error: "Não foi possível salvar." };
  }

  revalidatePath("/admin/access");
  return { ok: true };
}

export async function removeAllowedEmail(id: string): Promise<ActionResult> {
  await requireAdmin();
  await db.allowedEmail.delete({ where: { id } });
  revalidatePath("/admin/access");
  return { ok: true };
}
