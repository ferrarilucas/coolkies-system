import { NextRequest, NextResponse } from "next/server";
import { applyStripeEvent } from "@/server/tenant/stripe-events";
import { constructStripeEvent, StripeConfigError } from "@/server/tenant/stripe";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  let event;
  try {
    event = constructStripeEvent(raw, signature);
  } catch (error) {
    if (error instanceof StripeConfigError) {
      console.error("webhook Stripe:", error.message);
      return NextResponse.json({ error: "configuração ausente" }, { status: 500 });
    }
    console.error(
      "webhook Stripe com assinatura inválida",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "assinatura inválida" }, { status: 400 });
  }

  const outcome = await applyStripeEvent(event);

  switch (outcome) {
    case "unknown":
      return NextResponse.json({ outcome }, { status: 404 });
    case "applied":
    case "duplicate":
    case "stale":
    case "ignored":
      return NextResponse.json({ outcome }, { status: 200 });
    default: {
      const exhaustive: never = outcome;
      throw new Error(`outcome de Stripe não tratado: ${exhaustive}`);
    }
  }
}
