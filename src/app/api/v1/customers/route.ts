import { NextRequest } from "next/server";
import { normalizeName } from "@/lib/text";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const q = request.nextUrl.searchParams.get("q")?.trim();

    const customers = await db.customer.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { name: "asc" },
      take: 20,
      select: { id: true, name: true, email: true, phone: true, sector: true },
    });
    return Response.json({ customers });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const name = normalizeName(String(body.name ?? ""));
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    const sector = typeof body.sector === "string" && body.sector.trim() ? body.sector.trim() : null;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    if (!name) return Response.json({ error: "Nome é obrigatório." }, { status: 400 });

    try {
      const customer = await context.db.customer.create({
        data: { name, email, phone, sector, notes },
        select: { id: true, name: true, email: true, phone: true, sector: true },
      });
      return Response.json({ customer }, { status: 201 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Unique constraint") && msg.includes("email")) {
        return Response.json({ error: "Este e-mail já está cadastrado." }, { status: 409 });
      }
      return Response.json({ error: "Erro ao criar cliente." }, { status: 400 });
    }
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
