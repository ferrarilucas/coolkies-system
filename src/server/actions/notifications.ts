"use server";

import { z } from "zod";
import { getWorkspaceContext } from "@/server/tenant/context";
import { removePushSubscription, savePushSubscription } from "@/server/tenant/push";
import type { ActionResult } from "./workspaces";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});

export async function subscribeToPush(input: unknown): Promise<ActionResult> {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Inscrição de notificação inválida." };
  const { userId } = await getWorkspaceContext();
  await savePushSubscription(userId, { endpoint: parsed.data.endpoint, ...parsed.data.keys });
  return { ok: true };
}

export async function unsubscribeFromPush(endpoint: string): Promise<ActionResult> {
  const { userId } = await getWorkspaceContext();
  await removePushSubscription(userId, endpoint);
  return { ok: true };
}
