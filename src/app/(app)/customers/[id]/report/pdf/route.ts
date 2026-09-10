import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getCustomerReport } from "@/server/queries/customers";
import { buildCustomerReportPdf } from "@/server/pdf/customer-report";
import { formatRangeLabel, parseReportRange } from "@/lib/report-range";

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const range = parseReportRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined);

  const report = await getCustomerReport(id, range.from, range.to);
  if (!report) {
    return NextResponse.json({ error: "cliente não encontrado" }, { status: 404 });
  }

  const saleDateLabels = Object.fromEntries(
    report.sales.map((sale) => [sale.id, format(sale.soldAt, "dd/MM/yyyy")]),
  );

  const bytes = await buildCustomerReportPdf({
    report,
    fromLabel: formatRangeLabel(range.fromStr),
    toLabel: formatRangeLabel(range.toStr),
    generatedAtLabel: format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }),
    saleDateLabels,
  });

  const filename = `relatorio-${slugify(report.customer.name)}-${range.fromStr}-a-${range.toStr}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
