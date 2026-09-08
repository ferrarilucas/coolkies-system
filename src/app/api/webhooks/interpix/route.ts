import { NextRequest, NextResponse } from "next/server";
import { isValidInterPixSignature } from "@/server/tenant/interpix-signature";
import { applyInterPixEvent, type InterPixEvent } from "@/server/tenant/interpix-events";

export async function POST(request: NextRequest) {
  const secret = process.env.INTERPIX_WEBHOOK_SECRET;
  const raw = await request.text();
  const signature = request.headers.get("x-signature") ?? "";
  const timestamp = request.headers.get("x-timestamp") ?? "";

  if (!secret || !isValidInterPixSignature({ raw, timestamp, signature, secret })) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let event: InterPixEvent;
  try {
    event = JSON.parse(raw) as InterPixEvent;
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  if (!event.type || !event.eventId || !event.data?.subscriptionId) {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const outcome = await applyInterPixEvent(event);

  if (outcome === "unknown") {
    return NextResponse.json({ outcome }, { status: 404 });
  }

  if (outcome === "invalid") {
    console.error("webhook InterPix com eventId fora do formato numérico", {
      type: event.type,
      eventId: event.eventId,
    });
  }

  return NextResponse.json({ outcome });
}
