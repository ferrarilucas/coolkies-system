"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { checkoutViewState } from "@/lib/checkout-state";
import {
  PLANS,
  monthlyPriceCents,
  planLabel,
  planWorkspacesLabel,
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
  PENDING_AUTH: "Autorização pendente",
  AUTH_DENIED: "Autorização recusada",
  SUSPENDED: "Suspenso",
};

const WARNING_STATUSES = new Set(["PAST_DUE", "CANCELED", "AUTH_DENIED", "SUSPENDED"]);

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
  if (cycle === "YEARLY") return "ciclo anual";
  if (cycle === "MONTHLY") return "ciclo mensal";
  return "ciclo não identificado";
}

const QR_IMAGE_SIZE = 320;

function PixQrImage({ pixCopyPaste }: { pixCopyPaste: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    QRCode.toDataURL(pixCopyPaste, { width: QR_IMAGE_SIZE, margin: 2 })
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
        width={QR_IMAGE_SIZE}
        height={QR_IMAGE_SIZE}
        unoptimized
        className="size-64 rounded-lg border bg-white p-2"
      />
    </div>
  );
}

function PixCheckoutContent({
  pixCopyPaste,
  nextDueDate,
}: {
  pixCopyPaste: string;
  nextDueDate: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API indisponível");
      await navigator.clipboard.writeText(pixCopyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("PixCheckoutContent: falha ao copiar o código Pix", e);
      toast.error(
        "Não foi possível copiar automaticamente. Selecione o código acima e copie manualmente.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Abra o app do seu banco, escolha pagar com Pix e escaneie o QR ou cole o
        código abaixo. Isso autoriza um débito recorrente — você não está
        pagando nada agora.
      </p>
      <PixQrImage pixCopyPaste={pixCopyPaste} />
      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="select-all break-all font-mono text-xs">{pixCopyPaste}</p>
      </div>
      <Button className="w-full" onClick={onCopy} variant="outline">
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
      {nextDueDate && (
        <p className="text-xs text-muted-foreground">
          Depois de autorizado, a primeira cobrança é debitada em{" "}
          {formatDueDate(nextDueDate)}.
        </p>
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
  ownedCount,
  activeCount,
  pixCopyPaste,
  nextDueDate,
  graceUntil,
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
  graceUntil: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [cycle, setCycle] = useState<PlanCycle>("MONTHLY");
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [pixResult, setPixResult] = useState<CheckoutResult | null>(null);
  const router = useRouter();

  const overLimit = ownedCount - activeCount;
  const suggestedPlan = overLimit > 0 ? planThatCovers(ownedCount) : null;
  const checkoutState = checkoutViewState(status, pixCopyPaste, nextDueDate, graceUntil);

  function openCheckout(planId: string) {
    setPixResult(null);
    setCheckoutPlan(planId);
  }

  function closeCheckout() {
    setCheckoutPlan(null);
    setPixResult(null);
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
        <div className="space-y-4">
          {checkoutState.kind !== "none" && currentPlan && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle className="text-base">
                  {checkoutState.kind === "failed"
                    ? "Cobrança não gerada"
                    : checkoutState.kind === "expired"
                      ? "Cobrança não debitada"
                      : "Autorização pendente"}{" "}
                  — {planLabel(currentPlan)} ({cycleLabel(currentCycle)})
                </CardTitle>
                <CardDescription>
                  {checkoutState.kind === "authorize" &&
                    "Você ainda não autorizou o débito recorrente deste plano."}
                  {checkoutState.kind === "waiting" && "Sua autorização foi recebida."}
                  {checkoutState.kind === "expired" &&
                    "O prazo para debitar a primeira cobrança passou."}
                  {checkoutState.kind === "failed" &&
                    "Não foi possível gerar a cobrança Pix para este plano."}
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
                      A primeira cobrança deste plano não foi debitada dentro do prazo
                      e o acesso foi encerrado. Gere uma nova autorização para
                      recomeçar.
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setCycle(currentCycle ?? "MONTHLY");
                        openCheckout(currentPlan);
                      }}
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
                      onClick={() => {
                        setCycle(currentCycle ?? "MONTHLY");
                        openCheckout(currentPlan);
                      }}
                    >
                      Tentar novamente
                    </Button>
                  </>
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
              const isExpiredThisPlan =
                checkoutState.kind === "expired" && currentPlan === plan.id;
              const isCurrent =
                hasSubscriptionId &&
                currentPlan === plan.id &&
                currentCycle === cycle &&
                !isExpiredThisPlan;
              const isPendingThisPlan =
                checkoutState.kind !== "none" &&
                checkoutState.kind !== "expired" &&
                currentPlan === plan.id;

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
                  <CardContent className="space-y-1">
                    <p className="text-xs font-medium">{planWorkspacesLabel(plan.id)}</p>
                    {priceCents !== null && (
                      <p className="text-xs text-muted-foreground">
                        {cycle === "YEARLY"
                          ? `Total de ${formatBRL(priceCents * 12)} por ano, cobrado à vista.`
                          : "Cobrado todo mês."}
                      </p>
                    )}
                  </CardContent>
                  <CardFooter>
                    {isPendingThisPlan ? (
                      <Button className="w-full" variant="outline" disabled>
                        {checkoutState.kind === "failed"
                          ? "Tentar novamente acima"
                          : "Autorização pendente acima"}
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
                        {isExpiredThisPlan ? "Recontratar" : "Contratar"}
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
            <PixCheckoutContent
              pixCopyPaste={pixResult.pixCopyPaste}
              nextDueDate={pixResult.nextDueDate}
            />
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
