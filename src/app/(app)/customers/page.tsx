import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getCustomersWithBalance,
  getCustomerSectors,
} from "@/server/queries/customers";
import { CustomerList } from "@/components/customers/customer-list";
import { CustomerCreateDialog } from "@/components/customers/customer-create-dialog";
import { CustomersFilters } from "@/components/customers/customers-filters";
import { formatBRL } from "@/lib/money";
import { parseForecastCutoff, type CustomerSituation } from "@/lib/customer-balance";

type SearchParams = Promise<{
  q?: string;
  situation?: string;
  sector?: string;
  mindue?: string;
  pto?: string;
}>;

const SITUATIONS: CustomerSituation[] = ["all", "pending", "overdue", "clear"];

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const sector = (sp.sector ?? "").trim();
  const minDue = Math.max(0, parseInt(sp.mindue ?? "0") || 0);
  const forecastToRaw = (sp.pto ?? "").trim();
  const forecastTo = parseForecastCutoff(forecastToRaw) ? forecastToRaw : "";
  const situation = SITUATIONS.includes(sp.situation as CustomerSituation)
    ? (sp.situation as CustomerSituation)
    : "all";

  const [customers, sectors] = await Promise.all([
    getCustomersWithBalance({
      q: q || undefined,
      sector: sector || undefined,
      situation,
      minDueCents: minDue || undefined,
      forecastTo: forecastTo || undefined,
    }),
    getCustomerSectors(),
  ]);

  const hasFilters = Boolean(q || sector || minDue || forecastTo || situation !== "all");
  const totalPendingCents = customers.reduce((sum, c) => sum + c.pendingCents, 0);
  const debtorCount = customers.filter((c) => c.pendingCents > 0).length;
  const overdueCount = customers.filter((c) => c.isOverdue).length;

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Gerencie sua base de clientes."
        action={<CustomerCreateDialog />}
      />

      <CustomersFilters
        values={{ q, situation, sector, minDue, forecastTo }}
        sectors={sectors}
      />

      {totalPendingCents > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SummaryStat
            className="col-span-2 sm:col-span-1"
            label="A receber"
            value={formatBRL(totalPendingCents)}
            hint={forecastTo ? `previsto até ${formatShortDate(forecastTo)}` : undefined}
            valueClass="text-warning-text"
          />
          <SummaryStat
            label="Devendo"
            value={String(debtorCount)}
            hint={debtorCount === 1 ? "cliente" : "clientes"}
          />
          <SummaryStat
            label="Em atraso"
            value={String(overdueCount)}
            hint={overdueCount === 1 ? "cliente" : "clientes"}
            valueClass={overdueCount > 0 ? "text-destructive" : "text-muted-foreground"}
          />
        </div>
      )}

      {customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
          description={
            hasFilters
              ? "Ajuste os filtros para ver outros clientes."
              : "Adicione clientes para vincular às suas vendas."
          }
          action={hasFilters ? undefined : <CustomerCreateDialog />}
        />
      ) : (
        <CustomerList customers={customers} forecastTo={forecastTo || undefined} />
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  valueClass,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border bg-card p-3 ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${valueClass ?? ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
