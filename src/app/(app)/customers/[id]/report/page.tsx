import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCustomerReport } from "@/server/queries/customers";
import { formatBRL } from "@/lib/money";
import { CustomerReportToolbar } from "@/components/customers/customer-report-toolbar";

type SearchParams = Promise<{ from?: string; to?: string }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function defaultRange() {
  const now = new Date();
  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDate(now),
  };
}

export default async function CustomerReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fallback = defaultRange();
  const fromStr = DATE_RE.test(sp.from ?? "") ? sp.from! : fallback.from;
  const toStr = DATE_RE.test(sp.to ?? "") ? sp.to! : fallback.to;

  const report = await getCustomerReport(
    id,
    new Date(`${fromStr}T00:00:00`),
    new Date(`${toStr}T23:59:59.999`),
  );
  if (!report) notFound();

  const { customer, sales, totalCents, paidCents, pendingCents } = report;
  const generatedAt = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

  return (
    <div>
      <div className="print-hidden mb-4 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/customers">
            <ArrowLeft />
            Clientes
          </Link>
        </Button>
      </div>

      <CustomerReportToolbar customerId={customer.id} from={fromStr} to={toStr} />

      <div className="print-area rounded-lg border bg-card p-4 sm:p-6">
        <header className="border-b pb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Relatório de compras
          </p>
          <h1 className="mt-1 text-xl font-semibold">{customer.name}</h1>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {customer.sector && <p>Setor: {customer.sector}</p>}
            {customer.email && <p>E-mail: {customer.email}</p>}
            {customer.phone && <p>Telefone: {customer.phone}</p>}
            <p>
              Período: {format(new Date(`${fromStr}T00:00:00`), "dd/MM/yyyy")} a{" "}
              {format(new Date(`${toStr}T00:00:00`), "dd/MM/yyyy")}
            </p>
            <p>Gerado em: {generatedAt}</p>
          </div>
        </header>

        {sales.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma compra encontrada no período.
          </p>
        ) : (
          <>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Data</th>
                  <th className="py-2 pr-2 font-medium">Produto</th>
                  <th className="py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-2 whitespace-nowrap tabular-nums">
                      {format(sale.soldAt, "dd/MM/yyyy")}
                    </td>
                    <td className="py-2 pr-2">
                      <ul>
                        {sale.items.map((item) => (
                          <li key={item.id}>
                            {item.quantity}x {item.productNameSnapshot}
                            {item.flavorNameSnapshot ? ` — ${item.flavorNameSnapshot}` : ""}
                          </li>
                        ))}
                      </ul>
                      {sale.status === "PENDING" && (
                        <span className="text-xs text-muted-foreground">Em aberto</span>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap tabular-nums">
                      {formatBRL(sale.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 space-y-1 border-t pt-3 text-sm">
              <SummaryLine
                label={`Compras no período (${sales.length})`}
                value={formatBRL(totalCents)}
                strong
              />
              <SummaryLine label="Pago" value={formatBRL(paidCents)} />
              <SummaryLine label="Em aberto" value={formatBRL(pendingCents)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
