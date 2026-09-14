import type { Cycle } from "./period";

export type PlanCycle = Cycle;
export type PaymentMethod = "PIX" | "CARD";

type PlanDefinition = {
  id: string;
  label: string;
  workspacesLabel: string;
  maxWorkspaces: number;
  maxMembers: number;
  baseMonthlyCents: number | null;
  categoryLabel: string;
  tagline: string;
  inheritsFrom: string | null;
  highlight: boolean;
  features: string[];
};

const YEARLY_DISCOUNT_CENTS = 1000;
const PIX_DISCOUNT_CENTS = 500;
const MONTHS_IN_YEAR = 12;

export const PLANS: PlanDefinition[] = [
  {
    id: "corre",
    label: "Corre",
    workspacesLabel: "1 workspace",
    maxWorkspaces: 1,
    maxMembers: 2,
    baseMonthlyCents: 3950,
    categoryLabel: "Vendedor individual",
    tagline: "Para quem toca tudo sozinho e quer sair do caderninho hoje.",
    inheritsFrom: null,
    highlight: false,
    features: [
      "1 workspace com até 2 usuários",
      "Vendas e pedidos ilimitados",
      "Fiado com previsão de recebimento (dia 5, 5º dia útil ou data sua)",
      "Estoque e produção com histórico de movimentação",
      "Receitas com custo real e custo por unidade produzida",
      "Clientes com histórico de compras e pendências",
      "Painel de faturamento, ticket médio e filtros por período",
      "App na tela do celular, sem loja de aplicativos",
      "Suporte por WhatsApp em horário comercial",
    ],
  },
  {
    id: "cresce",
    label: "Cresce",
    workspacesLabel: "Até 4 workspaces",
    maxWorkspaces: 4,
    maxMembers: Number.POSITIVE_INFINITY,
    baseMonthlyCents: 9990,
    categoryLabel: "Negócio em crescimento",
    tagline:
      "Para quem já produz em escala, tem equipe e mais de uma frente de venda.",
    inheritsFrom: "Corre",
    highlight: true,
    features: [
      "Até 4 workspaces — separe lojas, marcas, pontos ou sócios",
      "Usuários ilimitados com níveis de acesso",
      "Painel consolidado somando todos os workspaces",
      "Comparação de preços entre mercados por unidade base",
      "Lista de compras automática pelo estoque mínimo",
      "Relatórios comparativos por produto, sabor e cliente",
      "Exportação dos dados em CSV para contador e sócio",
      "Link público do painel para quem precisa só olhar",
      "Parcelado na Palavra incluído assim que for lançado",
      "Suporte prioritário no WhatsApp",
    ],
  },
  {
    id: "escala",
    label: "Escala",
    workspacesLabel: "Workspaces ilimitados",
    maxWorkspaces: Number.POSITIVE_INFINITY,
    maxMembers: Number.POSITIVE_INFINITY,
    baseMonthlyCents: null,
    categoryLabel: "Operação multiunidade",
    tagline: "Para operações com várias unidades, franquias ou times grandes.",
    inheritsFrom: "Cresce",
    highlight: false,
    features: [
      "Workspaces e usuários ilimitados",
      "Migração dos seus dados feita junto com você",
      "Treinamento da equipe na implantação",
      "Papéis e permissões personalizados",
      "Gerente de conta e canal direto de suporte",
      "SLA de atendimento acordado em contrato",
      "Nota fiscal, faturamento por CNPJ e pagamento por boleto",
      "Integrações e acesso à API sob demanda",
    ],
  },
];

function findPlan(plan: string): PlanDefinition {
  return PLANS.find((p) => p.id === plan) ?? PLANS[0];
}

export function isKnownPlan(plan: string): boolean {
  return PLANS.some((p) => p.id === plan);
}

export function isKnownCycle(cycle: string): cycle is PlanCycle {
  return cycle === "MONTHLY" || cycle === "YEARLY";
}

export function monthlyPriceCents(
  plan: string,
  cycle: PlanCycle,
  method: PaymentMethod,
): number | null {
  const base = findPlan(plan).baseMonthlyCents;
  if (base === null) return null;

  const yearly = cycle === "YEARLY" ? YEARLY_DISCOUNT_CENTS : 0;
  const pix = method === "PIX" ? PIX_DISCOUNT_CENTS : 0;
  return base - yearly - pix;
}

export function chargeAmountCents(
  plan: string,
  cycle: PlanCycle,
  method: PaymentMethod,
): number | null {
  const monthly = monthlyPriceCents(plan, cycle, method);
  if (monthly === null) return null;
  return cycle === "YEARLY" ? monthly * MONTHS_IN_YEAR : monthly;
}

export function planLimit(plan: string): number {
  return findPlan(plan).maxWorkspaces;
}

export function effectiveLimit(plan: string, status: string, hasPaid = false): number {
  if (status === "TRIALING" || status === "PENDING_AUTH") return 1;
  if ((status === "PAST_DUE" || status === "CANCELED") && !hasPaid) return 1;
  return planLimit(plan);
}

export function planLabel(plan: string): string {
  return findPlan(plan).label;
}

export function planWorkspacesLabel(plan: string): string {
  return findPlan(plan).workspacesLabel;
}

export function planMemberLimit(plan: string): number {
  return findPlan(plan).maxMembers;
}
