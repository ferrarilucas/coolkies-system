"use server";

import { acceptCurrentTerms } from "@/server/tenant/account";
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
