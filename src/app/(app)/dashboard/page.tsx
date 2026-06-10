import { TrendingUp, Clock, ShoppingCart, Receipt } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/money";

// TODO: substituir por queries reais (server/queries/dashboard.ts) com filtros.
const kpis = [
  { label: "Receita recebida", value: 0, icon: TrendingUp, hint: "no período" },
  { label: "Receita prevista", value: 0, icon: Clock, hint: "a receber" },
  { label: "Vendas", value: null, icon: ShoppingCart, hint: "no período" },
  { label: "Ticket médio", value: 0, icon: Receipt, hint: "por venda" },
];

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Painel"
        description="Visão geral de receita realizada e prevista."
      />

      {/* TODO: barra de filtros avançados (período, status, produto, sabor, cliente) */}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon, hint }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold tabular-nums">
                {value === null ? "0" : formatBRL(value)}
              </p>
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Receita: realizada x prevista</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            {/* TODO: <RevenueChart /> com Recharts */}
            Gráfico em breve
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
