import { NextRequest, NextResponse } from "next/server";
import { getSalesForExport } from "@/server/queries/sales";
import { toCsv } from "@/lib/csv";
import { formatBRL } from "@/lib/money";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") ? new Date(sp.get("from")!) : undefined;
  const to = sp.get("to") ? new Date(sp.get("to")!) : undefined;

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
