import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCustomerReport } from "@/server/queries/customers";
import { formatRangeLabel, parseReportRange } from "@/lib/report-range";
import { CustomerReportToolbar } from "@/components/customers/customer-report-toolbar";
import { CustomerReportDocument } from "@/components/customers/customer-report-document";

type SearchParams = Promise<{ from?: string; to?: string }>;

export default async function CustomerReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const range = parseReportRange(sp.from, sp.to);

  const report = await getCustomerReport(id, range.from, range.to);
  if (!report) notFound();

  return (
    <div>
      <div className="print-hidden mb-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/customers">
            <ArrowLeft />
            Clientes
          </Link>
        </Button>
      </div>

      <CustomerReportToolbar
        customerId={report.customer.id}
        from={range.fromStr}
        to={range.toStr}
      />

      <CustomerReportDocument
        report={report}
        fromLabel={formatRangeLabel(range.fromStr)}
        toLabel={formatRangeLabel(range.toStr)}
        generatedAtLabel={format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
      />
    </div>
  );
}
