"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { checkoutViewState } from "@/lib/checkout-state";
import { PLANS, monthlyPriceCents, planLabel, type PlanCycle } from "@/lib/plans";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { subscribe, type CheckoutResult } from "@/server/actions/subscription";

const STATUS_LABEL: Record<string, string> = {
  TRIALING: "Em teste",
  ACTIVE: "Ativo",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelado",
  PENDING_AUTH: "Aguardando pagamento",
};

const CONTACT_EMAIL = "contato@coolkies.com.br";

function applyCpfCnpjMask(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function planThatCovers(count: number) {
  return PLANS.find((p) => p.maxWorkspaces >= count) ?? PLANS[PLANS.length - 1];
}

function formatDueDate(isoDate: string): string {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function cycleLabel(cycle: PlanCycle | null): string {
  return cycle === "YEARLY" ? "ciclo anual" : "ciclo mensal";
}

function PixQrImage({ pixCopyPaste }: { pixCopyPaste: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    QRCode.toDataURL(pixCopyPaste)
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((e) => {
        console.error("PixQrImage: falha ao gerar o QR do Pix", e);
      });
    return () => {
      cancelled = true;
    };
  }, [pixCopyPaste]);

  if (!dataUrl) return null;

  return (
    <div className="flex justify-center">
      <Image
        src={dataUrl}
        alt="QR code do Pix para autorizar o débito recorrente"
        width={192}
        height={192}
        unoptimized
        className="size-48 rounded-lg border bg-white p-2"
      />
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
  ownedCount,
  activeCount,
  pixCopyPaste,
  nextDueDate,
}: {
  currentPlan: string | null;
  currentCycle: PlanCycle | null;
  status: string | null;
  trialExpired: boolean;
  provider: string | null;
  hasSubscriptionId: boolean;
  ownedCount: number;
  activeCount: number;
  pixCopyPaste: string | null;
  nextDueDate: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [cycle, setCycle] = useState<PlanCycle>("MONTHLY");
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [pixResult, setPixResult] = useState<CheckoutResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [bannerCopied, setBannerCopied] = useState(false);
  const router = useRouter();

  const overLimit = ownedCount - activeCount;
  const suggestedPlan = overLimit > 0 ? planThatCovers(ownedCount) : null;
  const checkoutState = checkoutViewState(status, pixCopyPaste, nextDueDate);

  function openCheckout(planId: string) {
    setPixResult(null);
    setCopied(false);
    setCheckoutPlan(planId);
  }

  function closeCheckout() {
    setCheckoutPlan(null);
    setPixResult(null);
    setCopied(false);
  }

  function onSubscribe(formData: FormData) {
    startTransition(async () => {
      const result = await subscribe(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível contratar o plano.");
        return;
      }
      router.refresh();
      if (result.data) setPixResult(result.data);
    });
  }

  async function onCopyPix() {
    if (!pixResult) return;
    await navigator.clipboard.writeText(pixResult.pixCopyPaste);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function onCopyBannerPix() {
    if (checkoutState.kind !== "authorize") return;
    await navigator.clipboard.writeText(checkoutState.pixCopyPaste);
    setBannerCopied(true);
    setTimeout(() => setBannerCopied(false), 2000);
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
                    : status === "PAST_DUE" || status === "CANCELED" || trialExpired
                      ? "warning"
                      : "secondary"
                }
              >
                {trialExpired ? "Teste encerrado" : (STATUS_LABEL[status] ?? status)}
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
      </Card>

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
        <div className="space-y-4">
          {checkoutState.kind !== "none" && currentPlan && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle className="text-base">
                  Autorização pendente — {planLabel(currentPlan)} ({cycleLabel(currentCycle)})
                </CardTitle>
                <CardDescription>
                  {checkoutState.kind === "authorize"
                    ? "Você ainda não autorizou o débito recorrente deste plano."
                    : "Sua autorização foi recebida."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {checkoutState.kind === "authorize" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Abra o app do seu banco, escolha pagar com Pix e escaneie o QR
                      ou cole o código abaixo. Isso autoriza um débito recorrente —
                      você não está pagando nada agora.
                    </p>
                    <PixQrImage pixCopyPaste={checkoutState.pixCopyPaste} />
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <p className="break-all font-mono text-xs">
                        {checkoutState.pixCopyPaste}
                      </p>
                    </div>
                    <Button className="w-full" onClick={onCopyBannerPix} variant="outline">
                      {bannerCopied ? (
                        <>
                          <Check className="size-4" /> Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="size-4" /> Copiar código Pix
                        </>
                      )}
                    </Button>
                    {checkoutState.nextDueDate && (
                      <p className="text-xs text-muted-foreground">
                        Depois de autorizado, a primeira cobrança é debitada em{" "}
                        {formatDueDate(checkoutState.nextDueDate)}.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    O plano ativa quando a primeira cobrança for debitada
                    {checkoutState.nextDueDate
                      ? ` em ${formatDueDate(checkoutState.nextDueDate)}`
                      : ""}
                    . Isso pode levar alguns dias — nenhuma ação é necessária da sua
                    parte até lá.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Tabs value={cycle} onValueChange={(v) => setCycle(v as PlanCycle)}>
            <TabsList>
              <TabsTrigger value="MONTHLY">Mensal</TabsTrigger>
              <TabsTrigger value="YEARLY">Anual</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => {
              const priceCents = monthlyPriceCents(plan.id, cycle, "PIX");
              const isCurrent =
                hasSubscriptionId && currentPlan === plan.id && currentCycle === cycle;
              const isPendingThisPlan = checkoutState.kind !== "none" && currentPlan === plan.id;

              return (
                <Card
                  key={plan.id}
                  className={isCurrent || isPendingThisPlan ? "border-primary" : undefined}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      {plan.label}
                      {isCurrent && <Badge>Atual</Badge>}
                    </CardTitle>
                    <CardDescription>
                      {priceCents === null
                        ? "Sob consulta"
                        : `${formatBRL(priceCents)}/mês${
                            cycle === "YEARLY" ? " no plano anual" : ""
                          }`}
                    </CardDescription>
                  </CardHeader>
                  {priceCents !== null && (
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        {cycle === "YEARLY"
                          ? `Total de ${formatBRL(priceCents * 12)} por ano, cobrado à vista.`
                          : "Cobrado todo mês."}
                      </p>
                    </CardContent>
                  )}
                  <CardFooter>
                    {isPendingThisPlan ? (
                      <Button className="w-full" variant="outline" disabled>
                        Autorização pendente acima
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
                      <Button className="w-full" onClick={() => openCheckout(plan.id)}>
                        Contratar
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={checkoutPlan !== null} onOpenChange={(open) => !open && closeCheckout()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pixResult
                ? "Autorize o débito recorrente"
                : `Contratar ${checkoutPlan ? planLabel(checkoutPlan) : ""}`}
            </DialogTitle>
          </DialogHeader>

          {pixResult ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Abra o app do seu banco, escolha pagar com Pix e escaneie o QR ou
                cole o código abaixo. Isso autoriza um débito recorrente — você
                não está pagando nada agora.
                {pixResult.nextDueDate
                  ? ` A primeira cobrança é debitada em ${formatDueDate(pixResult.nextDueDate)}.`
                  : ""}
              </p>
              <PixQrImage pixCopyPaste={pixResult.pixCopyPaste} />
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="break-all font-mono text-xs">{pixResult.pixCopyPaste}</p>
              </div>
              <Button className="w-full" onClick={onCopyPix} variant="outline">
                {copied ? (
                  <>
                    <Check className="size-4" /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="size-4" /> Copiar código Pix
                  </>
                )}
              </Button>
            </div>
          ) : (
            <form action={onSubscribe} className="space-y-4">
              <input type="hidden" name="plan" value={checkoutPlan ?? ""} />
              <input type="hidden" name="cycle" value={cycle} />

              <div className="space-y-2">
                <Label htmlFor="cpfCnpj">CPF ou CNPJ</Label>
                <Input
                  id="cpfCnpj"
                  name="cpfCnpj"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  onChange={(e) => {
                    e.currentTarget.value = applyCpfCnpjMask(e.currentTarget.value);
                  }}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Usado para gerar a cobrança Pix em seu nome.
                </p>
              </div>

              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Gerando o Pix..." : "Gerar código Pix"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
