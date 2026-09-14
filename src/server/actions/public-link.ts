"use server";

import { revalidatePath } from "next/cache";
import { getScopedDb } from "@/server/tenant/context";
import { enablePublicLink, disablePublicLink } from "@/server/tenant/public-link";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function togglePublicLink(
  enabled: boolean,
): Promise<ActionResult<{ token: string | null }>> {
  try {
    const { workspaceId } = await getScopedDb("OWNER");

    if (!enabled) {
      await disablePublicLink(workspaceId);
      revalidatePath("/workspaces/public-link");
      return { ok: true, data: { token: null } };
    }

    const token = await enablePublicLink(workspaceId);
    revalidatePath("/workspaces/public-link");
    return { ok: true, data: { token } };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
