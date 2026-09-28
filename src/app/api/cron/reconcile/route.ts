import type { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { reconcileInterPixSubscriptions } from "@/server/tenant/reconcile";
import { pruneRateLimits } from "@/server/tenant/rate-limit";

export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const summary = await reconcileInterPixSubscriptions();
  const prunedRateLimits = await pruneRateLimits(new Date(Date.now() - DAY_MS));

  console.log("cron/reconcile", JSON.stringify({ ...summary, prunedRateLimits }));

  return Response.json(
    { ...summary, prunedRateLimits },
    { status: summary.failed > 0 ? 500 : 200 },
  );
}
