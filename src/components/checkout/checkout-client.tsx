"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Cookie, CreditCard, Lock } from "lucide-react";
import { toast } from "sonner";
import { maskCpf, isCompleteCpf, onlyDigits } from "@/lib/cpf";
import { formatBRL } from "@/lib/money";
import {
  chargeAmountCents,
  monthlyPriceCents,
  type PlanCycle,
} from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PixCheckoutContent } from "@/components/checkout/pix-checkout-content";
import { CardCheckoutContent } from "@/components/checkout/card-checkout-content";
import { subscribe, type CheckoutResult } from "@/server/actions/subscription";

const CYCLE_NOTE: Record<PlanCycle, string> = {
  MONTHLY: "Cobrado todo mês",
  YEARLY: "Cobrado uma vez por ano",
};

type CheckoutMethod = "pix" | "card";

export function CheckoutClient({
  plan,
  cycle,
  planName,
  workspacesLabel,
  defaultCpf,
  stripeEnabled,
}: {
  plan: string;
  cycle: PlanCycle;
  planName: string;
  workspacesLabel: string;
  defaultCpf: string | null;
  stripeEnabled: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<CheckoutMethod>("pix");
  const [cpf, setCpf] = useState(defaultCpf ? maskCpf(defaultCpf) : "");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [pending, startTransition] = useTransition();

  const pixMonthly = monthlyPriceCents(plan, cycle, "PIX") ?? 0;
  const cardMonthly = monthlyPriceCents(plan, cycle, "CARD") ?? 0;
  const pixOffPct =
    cardMonthly > 0 ? Math.round((1 - pixMonthly / cardMonthly) * 100) : 0;

  const monthlyCents = method === "pix" ? pixMonthly : cardMonthly;
  const totalCents =
    (method === "pix"
      ? chargeAmountCents(plan, cycle, "PIX")
      : chargeAmountCents(plan, cycle, "CARD")) ?? monthlyCents;

  function onGeneratePix(formData: FormData) {
    formData.set("plan", plan);
    formData.set("cycle", cycle);
    formData.set("cpfCnpj", onlyDigits(cpf));
    startTransition(async () => {
      const res = await subscribe(formData);
      if (!res.ok || !res.data) {
        toast.error(res.error ?? "Não foi possível gerar o Pix.");
        return;
      }
      router.refresh();
      setResult(res.data);
    });
  }

  return (
    <div className="relative min-h-dvh bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,hsl(var(--primary)/0.12),transparent)]"
      />

      <div className="relative mx-auto max-w-5xl px-5 py-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
              <Cookie className="size-5 text-primary" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Coolkies</span>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/workspaces/plan">
              <ArrowLeft className="size-4" />
              Voltar ao plano
            </Link>
          </Button>
        </header>
      </div>

      <main className="relative mx-auto flex max-w-5xl flex-col-reverse gap-8 px-5 pb-20 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:gap-10">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">
            Finalizar assinatura
          </h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
            O pagamento é um débito recorrente autorizado no app do seu banco.
            Nada é cobrado agora — a primeira cobrança entra na data de
            vencimento.
          </p>

          <Tabs
            value={method}
            onValueChange={(v) => setMethod(v as CheckoutMethod)}
            className="mt-6"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pix" className="gap-1.5">
                Pix recorrente
                {pixOffPct > 0 && (
                  <Badge
                    variant="secondary"
                    className="hidden sm:inline-flex"
                  >
                    −{pixOffPct}%
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="card" className="gap-1.5">
                Cartão de crédito
                {!stripeEnabled && (
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    Em breve
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pix">
              <div className="rounded-xl border bg-card p-5">
                {result ? (
                  <div className="space-y-5">
                    <PixCheckoutContent
                      pixCopyPaste={result.pixCopyPaste}
                      nextDueDate={result.nextDueDate}
                      previousPendingCharge={result.previousPendingCharge}
                    />
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/workspaces/plan">Voltar ao plano</Link>
                    </Button>
                  </div>
                ) : (
                  <form action={onGeneratePix} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF do titular</Label>
                      <Input
                        id="cpf"
                        name="cpf"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="000.000.000-00"
                        value={cpf}
                        onChange={(e) => setCpf(maskCpf(e.target.value))}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Usado para gerar a cobrança Pix em seu nome e guardado
                        para as próximas renovações.
                      </p>
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={pending || !isCompleteCpf(cpf)}
                    >
                      {pending ? "Gerando o Pix..." : "Gerar QR Code Pix"}
                    </Button>
                  </form>
                )}
              </div>
            </TabsContent>

            <TabsContent value="card">
              {stripeEnabled ? (
                <div className="rounded-xl border bg-card p-5">
                  {method === "card" && (
                    <CardCheckoutContent
                      plan={plan}
                      cycle={cycle}
                      monthlyCents={cardMonthly}
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-5 py-12 text-center">
                  <span className="flex size-11 items-center justify-center rounded-full bg-muted">
                    <CreditCard className="size-5 text-muted-foreground" />
                  </span>
                  <p className="font-medium">Em breve</p>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    O pagamento com cartão de crédito ainda está em
                    desenvolvimento. Ele não tem o desconto do Pix recorrente —
                    por enquanto, assine pelo Pix.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </section>

        <aside className="rounded-xl border bg-card p-5 lg:sticky lg:top-6">
          <p className="text-sm font-medium text-muted-foreground">
            Resumo do pedido
          </p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">
              {formatBRL(monthlyCents)}
            </span>
            <span className="text-sm text-muted-foreground">/mês</span>
          </div>
          {pixOffPct > 0 && method === "pix" && (
            <p className="mt-1 text-xs font-medium text-success">
              Desconto do Pix recorrente aplicado (−{pixOffPct}%)
            </p>
          )}
          {pixOffPct > 0 && method === "card" && (
            <p className="mt-1 text-xs text-muted-foreground">
              No Pix recorrente sai{" "}
              <span className="font-medium text-foreground">
                {formatBRL(pixMonthly)}/mês
              </span>{" "}
              — {pixOffPct}% mais barato.
            </p>
          )}

          <dl className="mt-5 space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Plano</dt>
              <dd className="font-medium">{planName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Workspaces</dt>
              <dd className="text-right font-medium">{workspacesLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Ciclo</dt>
              <dd className="font-medium">
                {cycle === "YEARLY" ? "Anual" : "Mensal"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Forma de pagamento</dt>
              <dd className="font-medium">
                {method === "pix" ? "Pix recorrente" : "Cartão de crédito"}
              </dd>
            </div>
            {cycle === "YEARLY" && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Total por ano</dt>
                <dd className="font-medium tabular-nums">
                  {formatBRL(totalCents)}
                </dd>
              </div>
            )}
          </dl>

          <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
            {method === "pix"
              ? `${CYCLE_NOTE[cycle]} via Pix recorrente. Você pode cancelar quando quiser, direto na página do plano.`
              : stripeEnabled
                ? `${CYCLE_NOTE[cycle]} no cartão de crédito. O valor não tem o desconto do Pix recorrente. Cancele quando quiser na página do plano.`
                : "O pagamento com cartão ainda não está disponível. O valor acima é sem o desconto do Pix."}
          </p>
          {method === "pix" && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Autorização feita no app do seu banco.
            </p>
          )}
        </aside>
      </main>
    </div>
  );
}
