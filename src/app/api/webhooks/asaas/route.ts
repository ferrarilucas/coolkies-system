import { NextRequest, NextResponse } from "next/server";
import { applyPaymentEvent } from "@/server/tenant/asaas-events";

export async function POST(request: NextRequest) {
  const token = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!token || request.headers.get("asaas-access-token") !== token) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const body = (await request.json()) as {
    id?: string;
    event?: string;
    payment?: { subscription?: string; dueDate?: string };
  };

  if (!body.id || !body.event) {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const outcome = await applyPaymentEvent({
    id: body.id,
    event: body.event,
    subscriptionId: body.payment?.subscription ?? null,
    dueDate: body.payment?.dueDate ?? null,
  });

  return NextResponse.json({ outcome });
}
