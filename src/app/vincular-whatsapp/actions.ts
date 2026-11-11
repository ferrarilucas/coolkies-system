"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAcceptedCurrentTerms } from "@/server/tenant/account";
import { linkTokenPattern, redeemWhatsAppLink } from "@/server/tenant/whatsapp/link";

export async function linkWhatsApp(form: FormData) {
  const token = form.get("token");
  if (typeof token !== "string" || !linkTokenPattern.test(token)) {
    redirect("/vincular-whatsapp?status=invalid");
  }
  const next = encodeURIComponent(`/vincular-whatsapp?token=${token}`);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${next}`);
  if (!(await hasAcceptedCurrentTerms(session.user.id))) redirect(`/accept-terms?next=${next}`);
  const linked = await redeemWhatsAppLink(session.user.id, token);
  redirect(`/vincular-whatsapp?status=${linked ? "linked" : "invalid"}`);
}
