import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { buildPersonalDataExport } from "@/server/tenant/account";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const data = await buildPersonalDataExport(session.user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meus-dados-cipri.json"',
      "Cache-Control": "no-store",
    },
  });
}
