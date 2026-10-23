import type { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createWebPushSender } from "@/server/notifications/web-push";
import { sendDueTodayReminders } from "@/server/tenant/push";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const send = createWebPushSender();
  if (!send) {
    return Response.json({ error: "Chaves VAPID não configuradas." }, { status: 500 });
  }

  const summary = await sendDueTodayReminders(send);

  console.log("cron/due-reminders", JSON.stringify(summary));

  return Response.json(summary, { status: summary.failed > 0 ? 500 : 200 });
}
