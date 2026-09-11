"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkoutViewState } from "@/lib/checkout-state";
import { isCurrentPlanCard } from "@/lib/plan-card-state";
import {
  PENDING_AUTH_BADGE_LABEL,
  PENDING_AUTH_BUTTON_LABEL,
  planCheckoutCardCopy,
} from "@/lib/plan-checkout-card-copy";
import {
  PLANS,
  chargeAmountCents,
  monthlyPriceCents,
  planLabel,
  type PlanCycle,
} from "@/lib/plans";
import { formatBRL } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PixCheckoutContent,
  formatDueDate,
} from "@/components/checkout/pix-checkout-content";

const STATUS_LABEL: Record<string, string> = {
  TRIALING: "Em teste",
  ACTIVE: "Ativo",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelado",
  PENDING_AUTH: "Autorização pendente",
  AUTH_DENIED: "Autorização recusada",
  SUSPENDED: "Suspenso",
};

const WARNING_STATUSES = new Set(["PAST_DUE", "CANCELED", "AUTH_DENIED", "SUSPENDED"]);

const CONTACT_EMAIL = "contato@coolkies.com.br";

const GUARANTEES = [
  "14 dias grátis com todos os recursos",
  "Sem cartão de crédito para testar",
  "Sem fidelidade — cancele quando quiser",
  "Troque de plano ou forma de pagamento quando quiser",
];

function planThatCovers(count: number) {
  return PLANS.find((p) => p.maxWorkspaces >= count) ?? PLANS[PLANS.length - 1];
}

function cycleLabel(cycle: PlanCycle | null): string {
  if (cycle === "YEARLY") return "ciclo anual";
  if (cycle === "MONTHLY") return "ciclo mensal";
  return "ciclo não identificado";
}

function PriceBlock({
  planId,
  baseCents,
  cycle,
}: {
  planId: string;
  baseCents: number | null;
  cycle: PlanCycle;
}) {
  const pixMonthly = monthlyPriceCents(planId, cycle, "PIX");

  if (baseCents === null || pixMonthly === null) {
    return (
      <div className="space-y-1">
        <p className="text-2xl font-semibold tracking-tight">Sob medida</p>
        <p className="text-xs text-muted-foreground">
          Preço fechado conforme o tamanho da sua operação.
        </p>
      </div>
    );
  }

  const offPct = Math.round((1 - pixMonthly / baseCents) * 100);
  const annualTotal = chargeAmountCents(planId, "YEARLY", "PIX");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground line-through">
          {formatBRL(baseCents)}
        </span>
        {offPct > 0 && <Badge variant="secondary">−{offPct}%</Badge>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatBRL(pixMonthly)}
        </span>
        <span className="text-sm text-muted-foreground">/mês</span>
      </div>
      {cycle === "YEARLY" && annualTotal !== null ? (
        <p className="text-xs text-muted-foreground">
          {formatBRL(annualTotal)} por ano, em uma cobrança só
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Cobrado todo mês</p>
      )}
    </div>
  );
}

export function PlanPanel({
  currentPlan,
  currentCycle,
  status,
  trialExpired,
  provider,
  hasSubscriptionId,
  cardBrand,
  cardLast4,
  ownedCount,
  activeCount,
  pixCopyPaste,
  nextDueDate,
  authorizedAt,
  graceUntil,
  pendingChargeDueAt,
}: {
  currentPlan: string | null;
  currentCycle: PlanCycle | null;
  status: string | null;
  trialExpired: boolean;
  provider: string | null;
  hasSubscriptionId: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  ownedCount: number;
  activeCount: number;
  pixCopyPaste: string | null;
  nextDueDate: string | null;
  authorizedAt: string | null;
  graceUntil: string | null;
  pendingChargeDueAt: string | null;
}) {
  const [cycle, setCycle] = useState<PlanCycle>("MONTHLY");
  const router = useRouter();

  const overLimit = ownedCount - activeCount;
  const suggestedPlan = overLimit > 0 ? planThatCovers(ownedCount) : null;
  const checkoutState = checkoutViewState(
    provider,
    status,
    pixCopyPaste,
    nextDueDate,
    authorizedAt,
    graceUntil,
  );

  function goToCheckout(planId: string, planCycle: PlanCycle = cycle) {
    router.push(`/checkout?plan=${planId}&cycle=${planCycle}`);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Plano atual
            {status && (
              <Badge
                variant={
                  status === "ACTIVE"
                    ? "success"
                    : WARNING_STATUSES.has(status) || trialExpired
                      ? "warning"
                      : "secondary"
                }
              >
                {trialExpired
                  ? "Teste encerrado"
                  : status === "PENDING_AUTH"
                    ? (PENDING_AUTH_BADGE_LABEL[checkoutState.kind] ?? STATUS_LABEL[status])
                    : (STATUS_LABEL[status] ?? status)}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {currentPlan ? planLabel(currentPlan) : "Nenhuma assinatura ativa."}
          </CardDescription>
        </CardHeader>
        {trialExpired && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Seu teste de 14 dias terminou e o cadastro está em modo somente
              leitura — dá para ver tudo, mas não registrar vendas nem alterar
              dados. Assinar um plano aqui embaixo destrava a escrita assim que o
              pagamento for confirmado.
            </p>
          </CardContent>
        )}
        {provider === "STRIPE" && cardBrand && cardLast4 && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Pagamento no cartão {cardBrand} •••• {cardLast4}. Para trocar o
              cartão, fale com a gente em{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium underline underline-offset-4"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </CardContent>
        )}
      </Card>

      {pendingChargeDueAt !== null && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-warning">
            Uma cobrança da sua assinatura anterior já foi enviada ao banco e
            será debitada em {formatDueDate(pendingChargeDueAt)} mesmo com o
            cancelamento — regra do Banco Central, cancelamento não impede a
            cobrança já em andamento.
          </p>
        </div>
      )}

      {overLimit > 0 && suggestedPlan && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-warning">
            {overLimit === 1
              ? "1 workspace está em modo somente leitura"
              : `${overLimit} workspaces estão em modo somente leitura`}{" "}
            porque passaram do limite do seu plano. O plano{" "}
            <strong>{planLabel(suggestedPlan.id)}</strong> resolveria.
          </p>
        </div>
      )}

      {(status === "AUTH_DENIED" || status === "SUSPENDED") && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-destructive">
            {status === "AUTH_DENIED"
              ? "Seu banco recusou a autorização do débito recorrente. Escolha um plano abaixo para gerar uma nova autorização."
              : "Sua assinatura foi suspensa. Escolha um plano abaixo para gerar uma nova autorização ou fale com a gente."}
          </p>
        </div>
      )}

      {provider === "MANUAL" ? (
        <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Esta assinatura foi atribuída manualmente pela equipe Coolkies e não é
            gerenciada por aqui. Fale com a gente em{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>{" "}
            para fazer alterações.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {checkoutState.kind !== "none" && currentPlan && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle className="text-base">
                  {planCheckoutCardCopy(checkoutState.kind).title} —{" "}
                  {planLabel(currentPlan)} ({cycleLabel(currentCycle)})
                </CardTitle>
                <CardDescription>
                  {planCheckoutCardCopy(checkoutState.kind).description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {checkoutState.kind === "authorize" && (
                  <PixCheckoutContent
                    pixCopyPaste={checkoutState.pixCopyPaste}
                    nextDueDate={checkoutState.nextDueDate}
                  />
                )}
                {checkoutState.kind === "waiting" && (
                  <p className="text-sm text-muted-foreground">
                    O plano ativa quando a primeira cobrança for debitada
                    {checkoutState.nextDueDate
                      ? ` em ${formatDueDate(checkoutState.nextDueDate)}`
                      : ""}
                    . Isso pode levar alguns dias — nenhuma ação é necessária da sua
                    parte até lá.
                  </p>
                )}
                {checkoutState.kind === "expired" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      O prazo desta autorização passou sem confirmação de pagamento e
                      o acesso foi encerrado. Gere uma nova autorização para
                      recomeçar.
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => goToCheckout(currentPlan, currentCycle ?? "MONTHLY")}
                    >
                      Recomeçar
                    </Button>
                  </>
                )}
                {checkoutState.kind === "failed" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      A cobrança Pix deste plano não chegou a ser gerada. Nenhuma
                      autorização foi recebida — tente novamente para gerar um novo
                      código Pix.
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => goToCheckout(currentPlan, currentCycle ?? "MONTHLY")}
                    >
                      Tentar novamente
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">
              Escolha o seu plano
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Todos os planos vêm com os recursos completos do Coolkies — o que
              muda é quantos workspaces e quantas pessoas trabalham com você. O
              plano anual pago com Pix recorrente junta o desconto por assinar o
              ano inteiro com o do Pix; o percentual de cada plano aparece no
              cartão.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={cycle} onValueChange={(v) => setCycle(v as PlanCycle)}>
              <TabsList>
                <TabsTrigger value="MONTHLY">Mensal</TabsTrigger>
                <TabsTrigger value="YEARLY">Anual</TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="text-xs font-medium text-muted-foreground">
              Pix recorrente sai mais barato que no cartão
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => {
              const priceCents = monthlyPriceCents(plan.id, cycle, "PIX");
              const cardMonthly = monthlyPriceCents(plan.id, cycle, "CARD");
              const isExpiredThisPlan =
                checkoutState.kind === "expired" &&
                currentPlan === plan.id &&
                currentCycle === cycle;
              const isCurrent = isCurrentPlanCard({
                hasSubscriptionId,
                currentPlan,
                currentCycle,
                planId: plan.id,
                cycle,
                status,
                isExpiredThisPlan,
              });
              const isPendingThisPlan =
                checkoutState.kind !== "none" &&
                checkoutState.kind !== "expired" &&
                currentPlan === plan.id;

              return (
                <Card
                  key={plan.id}
                  className={cn(
                    "flex h-full flex-col overflow-hidden",
                    (plan.highlight || isCurrent || isPendingThisPlan) &&
                      "border-primary",
                  )}
                >
                  <CardHeader className="gap-3">
                    {plan.highlight && (
                      <div className="-mx-4 -mt-4 mb-1 bg-primary px-4 py-1.5 text-center text-xs font-semibold text-primary-foreground">
                        Mais escolhido
                      </div>
                    )}
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {plan.categoryLabel}
                    </p>
                    <div className="space-y-1">
                      <CardTitle className="flex items-center justify-between gap-2 text-lg">
                        {plan.label}
                        {isCurrent && <Badge>Atual</Badge>}
                      </CardTitle>
                      <CardDescription>{plan.tagline}</CardDescription>
                    </div>
                    <PriceBlock
                      planId={plan.id}
                      baseCents={plan.baseMonthlyCents}
                      cycle={cycle}
                    />
                  </CardHeader>

                  <CardContent className="flex-1 space-y-3">
                    {plan.inheritsFrom && (
                      <p className="text-xs font-medium text-muted-foreground">
                        Tudo do {plan.inheritsFrom}, mais:
                      </p>
                    )}
                    <ul className="space-y-2 text-sm">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>

                  <CardFooter className="flex-col items-stretch gap-2">
                    {isPendingThisPlan ? (
                      <Button className="w-full" variant="outline" disabled>
                        {PENDING_AUTH_BUTTON_LABEL[checkoutState.kind] ??
                          "Autorização pendente acima"}
                      </Button>
                    ) : isCurrent ? (
                      <Button className="w-full" variant="outline" disabled>
                        Plano atual
                      </Button>
                    ) : priceCents === null ? (
                      <Button asChild variant="outline" className="w-full">
                        <a href={`mailto:${CONTACT_EMAIL}`}>Fale com a gente</a>
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        onClick={() => goToCheckout(plan.id)}
                      >
                        {isExpiredThisPlan ? "Recontratar" : "Assinar"}
                      </Button>
                    )}
                    {priceCents !== null && cardMonthly !== null && (
                      <p className="text-center text-xs text-muted-foreground">
                        No cartão, {formatBRL(cardMonthly)}/mês
                      </p>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            {GUARANTEES.map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="size-3.5 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
