import { format } from "date-fns";
import { formatBRL } from "@/lib/money";
import type { CustomerReport } from "@/server/queries/customers";

export function CustomerReportDocument({
  report,
  fromLabel,
  toLabel,
  generatedAtLabel,
}: {
  report: CustomerReport;
  fromLabel: string;
  toLabel: string;
  generatedAtLabel: string;
}) {
  const { customer, sales, totalCents, paidCents, pendingCents } = report;

  return (
    <div className="print-area overflow-hidden rounded-lg border bg-card">
      <header className="border-b p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Relatório de compras
        </p>
        <h1 className="mt-0.5 text-lg font-semibold leading-tight">{customer.name}</h1>
        <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {customer.sector && <MetaLine label="Setor" value={customer.sector} />}
          {customer.email && <MetaLine label="E-mail" value={customer.email} />}
          {customer.phone && <MetaLine label="Telefone" value={customer.phone} />}
          <MetaLine label="Período" value={`${fromLabel} a ${toLabel}`} />
          <MetaLine label="Gerado em" value={generatedAtLabel} />
        </dl>
      </header>

      {sales.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma compra encontrada no período.
        </p>
      ) : (
        <>
          <ul className="divide-y">
            {sales.map((sale) => (
              <li key={sale.id} className="p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium tabular-nums">
                    {format(sale.soldAt, "dd/MM/yyyy")}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatBRL(sale.totalCents)}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  {sale.items.map((item) => (
                    <li key={item.id}>
                      <span className="tabular-nums">{item.quantity}x</span>{" "}
                      {item.productNameSnapshot}
                      {item.flavorNameSnapshot ? ` — ${item.flavorNameSnapshot}` : ""}
                    </li>
                  ))}
                </ul>
                {sale.status === "PENDING" && (
                  <span className="mt-1.5 inline-flex rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning-text">
                    Em aberto
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="space-y-1 border-t bg-muted/30 p-4 text-sm">
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
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="shrink-0">{label}:</dt>
      <dd className="min-w-0 break-words">{value}</dd>
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
    <div className="flex items-baseline justify-between gap-4">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`shrink-0 tabular-nums ${strong ? "font-semibold" : ""}`}>
        {value}
      </span>
    </div>
  );
}
