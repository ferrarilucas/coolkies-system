import { NextRequest, NextResponse } from "next/server";
import { getSalesForExport } from "@/server/queries/sales";
import { toCsv } from "@/lib/csv";
import { formatBRL } from "@/lib/money";

export function parseDateParam(value: string | null): Date | undefined | null {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = parseDateParam(sp.get("from"));
  const to = parseDateParam(sp.get("to"));

  if (from === null || to === null) {
    return NextResponse.json(
      { error: "Data inválida. Use o formato AAAA-MM-DD." },
      { status: 400 },
    );
  }

  const rows = await getSalesForExport({ from, to });
  const csv = toCsv(
    rows.map((r) => ({ ...r, totalReais: formatBRL(r.totalCents) })),
    [
      { key: "soldAt", label: "Data da venda" },
      { key: "customerName", label: "Cliente" },
      { key: "status", label: "Status" },
      { key: "totalReais", label: "Total" },
      { key: "paymentForecastDate", label: "Previsão de recebimento" },
    ],
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="vendas.csv"',
      "Cache-Control": "no-store",
    },
  });
}
