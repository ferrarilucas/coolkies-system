"use server";

import { db } from "@/lib/db";
import { acceptCurrentTerms, deleteUserAccount } from "@/server/tenant/account";
import { requireUserId } from "@/server/tenant/workspaces";

export type ActionResult = { ok: boolean; error?: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function acceptTerms(): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await acceptCurrentTerms(userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

const CONFIRM_EMAIL_ERROR = "Digite o e-mail da sua conta para confirmar.";

export async function deleteAccount(confirmEmail: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      return { ok: false, error: CONFIRM_EMAIL_ERROR };
    }
    await deleteUserAccount(userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
