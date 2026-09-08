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
  } catch (error) {
    console.error("webhook InterPix com corpo que não é JSON válido", {
      length: raw.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ outcome: "invalid" }, { status: 200 });
  }

  if (!event.type || !event.eventId || !event.data?.subscriptionId) {
    console.error("webhook InterPix com payload sem os campos obrigatórios", {
      type: event.type,
      eventId: event.eventId,
      subscriptionId: event.data?.subscriptionId,
    });
    return NextResponse.json({ outcome: "invalid" }, { status: 200 });
  }

  const outcome = await applyInterPixEvent(event);

  switch (outcome) {
    case "unknown":
      return NextResponse.json({ outcome }, { status: 404 });
    case "invalid":
      console.error("webhook InterPix com eventId fora do formato numérico", {
        type: event.type,
        eventId: event.eventId,
      });
      return NextResponse.json({ outcome }, { status: 200 });
    case "applied":
    case "duplicate":
    case "stale":
      return NextResponse.json({ outcome }, { status: 200 });
    default: {
      const exhaustive: never = outcome;
      throw new Error(`outcome de InterPix não tratado: ${exhaustive}`);
    }
  }
}
