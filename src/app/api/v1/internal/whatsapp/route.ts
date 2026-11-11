import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { handleWhatsAppRequest } from "@/server/tenant/whatsapp/query";
import { saleInput } from "@/server/tenant/whatsapp/sale-input";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("access"), messageId: z.string().min(1).max(200), switchWorkspace: z.boolean().optional() }),
  z.object({ action: z.literal("select_workspace"), option: z.number().int().min(1).max(9999), menuId: z.string().uuid().optional() }),
  z.object({ action: z.literal("customer_balance"), name: z.string().trim().min(1).max(120), identify: z.boolean().optional() }),
  z.object({ action: z.literal("sale_start"), messageId: z.string().min(1).max(200), sale: saleInput }),
  z.object({ action: z.literal("sale_reply"), messageId: z.string().min(1).max(200), text: z.string().trim().min(1).max(1500) }),
  z.object({ action: z.literal("month_receivables") }),
  z.object({ action: z.literal("confirm"), option: z.number().int().min(0).max(99) }),
]).and(z.object({ workspaceId: z.string().min(1).max(200).optional(), phone: z.string().regex(/^55[1-9][0-9]9[0-9]{8}$/) }));

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
