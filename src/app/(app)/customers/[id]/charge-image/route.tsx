import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getChargeSettings } from "@/server/tenant/charge-settings";
import { CHARGE_IMAGE_MAX_IDS, getChargeSelection } from "@/server/queries/charge-selection";
import { createChargeImageResponse, loadChargeImageAssets } from "@/server/charge-image/charge-summary-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIds(raw: string | null): string[] | null {
  const ids = [...new Set((raw ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > CHARGE_IMAGE_MAX_IDS) return null;
  return ids;
}

function serverError(stage: string, error: unknown) {
  console.error(`[charge-image] falha ${stage}`, error);
  return NextResponse.json({ error: "falha ao gerar imagem" }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext());
  } catch (error) {
    if (error instanceof Error && error.message === "Não autenticado") {
      return NextResponse.json({ error: "não autenticado" }, { status: 401 });
    }
    return serverError("ao resolver o workspace", error);
  }

  const ids = parseIds(request.nextUrl.searchParams.get("i"));
  if (!ids) return NextResponse.json({ error: "parcelas inválidas" }, { status: 400 });

  const { id } = await params;

  try {
    const result = await getChargeSelection(id, ids);
    if (result.status === "no-customer") return NextResponse.json({ error: "cliente não encontrado" }, { status: 404 });
    if (result.status === "empty") return NextResponse.json({ error: "nenhuma parcela em aberto" }, { status: 400 });
    const { selection } = result;

    const [settings, assets] = await Promise.all([getChargeSettings(workspaceId), loadChargeImageAssets()]);
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });

    const { response } = createChargeImageResponse(
      { selection, workspaceName: settings.workspaceName, pixKey: settings.pixKey, generatedAt: new Date() },
      assets,
    );
    const body = await response.arrayBuffer();
    return new NextResponse(body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "x-charge-total-cents": String(selection.totalCents),
      },
    });
  } catch (error) {
    return serverError("ao gerar imagem", error);
  }
}
