import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { handleWhatsAppRequest } from "@/server/whatsapp/query";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("access"), messageId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("customer_balance"), name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("month_receivables") }),
  z.object({ action: z.literal("confirm"), option: z.number().int().min(0).max(99) }),
]).and(z.object({ phone: z.string().regex(/^55[1-9][0-9]9[0-9]{8}$/) }));

export type WhatsAppRequest = z.infer<typeof requestSchema>;

export async function POST(request: Request) {
  const secret = process.env.CIPRI_BOT_SECRET;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || secret.length < 32 || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const result = await handleWhatsAppRequest(parsed.data);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
