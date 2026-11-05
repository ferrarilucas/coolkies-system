"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Loader2, MessageCircle, QrCode, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InstallmentPicker, useOpenInstallments } from "@/components/customers/installment-picker";
import type { ChargeSettings } from "@/server/tenant/charge-settings";
import { formatChargeAmount, renderChargeMessage } from "@/lib/charge-message";
import { buildPixCopyPaste, isPixConfigured } from "@/lib/pix";
import { shareToWhatsApp, type ShareResult } from "@/lib/share-charge";
import { whatsappUrl } from "@/lib/whatsapp";
import {
  CHARGE_IMAGE_MAX_INSTALLMENTS,
  chargeImageKey,
  chargeImageReducer,
  initialChargeImageState,
  isChargeImageReady,
  validateChargeImageResponse,
} from "@/lib/charge-image-state";

type ActionKind = "message" | "pix";

type ActionFlow = {
  needsGesture: number;
  stage: "idle" | "cancelled" | "failed" | "image-ready";
  imageCopied: boolean;
  readyFor: string;
};

const IDLE_FLOW: ActionFlow = { needsGesture: 0, stage: "idle", imageCopied: false, readyFor: "" };
const IDLE_FLOWS: Record<ActionKind, ActionFlow> = { message: IDLE_FLOW, pix: IDLE_FLOW };
const IDLE_BUSY: Record<ActionKind, boolean> = { message: false, pix: false };

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyImage(file: File): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
    return true;
  } catch {
    downloadFile(file);
    return false;
  }
}

function openTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function CustomerChargeDialog({
  customerId,
  customerName,
  customerSector,
  customerPhone,
  pendingCents,
  pendingCount,
  forecastTo,
  settings,
  canConfigure,
  triggerClassName,
}: {
  customerId: string;
  customerName: string;
  customerSector?: string | null;
  customerPhone?: string | null;
  pendingCents: number;
  pendingCount: number;
  forecastTo?: string;
  settings: ChargeSettings;
  canConfigure: boolean;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sendImage, setSendImage] = useState(settings.sendImage);
  const [image, dispatchImage] = useReducer(chargeImageReducer<File>, undefined, initialChargeImageState<File>);
  const [messageSent, setMessageSent] = useState(false);
  const [flows, setFlows] = useState<Record<ActionKind, ActionFlow>>(IDLE_FLOWS);
  const [busy, setBusy] = useState<Record<ActionKind, boolean>>(IDLE_BUSY);
  const session = useRef(0);

  const picker = useOpenInstallments(customerId, forecastTo, open);
  const { selectedIds, selectedCents } = picker;
  const hasSelection = selectedIds.length > 0;
  const tooManyForImage = sendImage && selectedIds.length > CHARGE_IMAGE_MAX_INSTALLMENTS;
  const imageKey = chargeImageKey({ open, sendImage, selectedIds });
  const expectedCents = useRef(selectedCents);

  useEffect(() => {
    expectedCents.current = selectedCents;
  }, [selectedCents]);

  const message = useMemo(
    () =>
      renderChargeMessage({
        template: settings.template,
        customerName,
        totalCents: selectedCents,
        pixKey: settings.pixKey,
      }),
    [settings.template, settings.pixKey, customerName, selectedCents],
  );

  const pixReady = isPixConfigured(settings);
  const pixCode = useMemo(() => {
    if (!pixReady || !hasSelection) return null;
    try {
      return buildPixCopyPaste({
        key: settings.pixKey!,
        name: settings.pixRecipientName!,
        city: settings.pixCity!,
        amountCents: selectedCents,
      });
    } catch (error) {
      console.error("[charge-dialog] falha ao gerar Pix copia e cola", error);
      return null;
    }
  }, [pixReady, hasSelection, settings.pixKey, settings.pixRecipientName, settings.pixCity, selectedCents]);

  useEffect(() => {
    dispatchImage({ type: "request", key: imageKey });
  }, [imageKey]);

  useEffect(() => {
    if (image.status !== "loading") return;
    const { key, token } = image;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/customers/${customerId}/charge-image?i=${encodeURIComponent(key)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const verdict = validateChargeImageResponse(
          {
            ok: res.ok,
            redirected: res.redirected,
            contentType: res.headers.get("content-type"),
            totalCentsHeader: res.headers.get("x-charge-total-cents"),
          },
          expectedCents.current,
        );
        if (!verdict.ok) {
          if (!controller.signal.aborted) dispatchImage({ type: "reject", token, reason: verdict.reason });
          return;
        }
        const blob = await res.blob();
        const file = new File([blob], `cobranca-${slug(customerName) || "cliente"}.png`, { type: "image/png" });
        if (!controller.signal.aborted) dispatchImage({ type: "resolve", token, file });
      } catch {
        if (controller.signal.aborted) return;
        dispatchImage({ type: "reject", token, reason: "failed" });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [image, customerId, customerName]);

  const imageReady = !imageKey || isChargeImageReady(image, imageKey);
  const imageFailed = Boolean(imageKey) && image.status === "error" && image.key === imageKey;
  const imageStale = imageFailed && image.reason === "stale";
  const readyFor = `${imageKey}|${message}`;
  const awaitingOpen = flows.message.stage === "image-ready" && flows.message.readyFor === readyFor;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        session.current += 1;
        dispatchImage({ type: "reset" });
        setMessageSent(false);
        setFlows(IDLE_FLOWS);
        setBusy(IDLE_BUSY);
        setSendImage(settings.sendImage);
      }
    },
    [settings.sendImage],
  );

  function setFlow(kind: ActionKind, update: (prev: ActionFlow) => ActionFlow) {
    setFlows((prev) => ({ ...prev, [kind]: update(prev[kind]) }));
  }

  function markSent(kind: ActionKind) {
    setFlow(kind, () => IDLE_FLOW);
    if (kind === "pix") {
      toast.success("Pix copia e cola copiado.");
      return;
    }
    setMessageSent(true);
    toast.success("Mensagem copiada — se ela não aparecer no WhatsApp, é só colar.");
  }

  function handleResult(kind: ActionKind, result: ShareResult, sentFor: string) {
    switch (result.outcome) {
      case "needs-gesture":
        setFlow(kind, (prev) => ({ ...IDLE_FLOW, needsGesture: prev.needsGesture + 1 }));
        return;
      case "cancelled":
        setFlow(kind, () => ({ ...IDLE_FLOW, stage: "cancelled" }));
        return;
      case "failed":
        setFlow(kind, () => ({ ...IDLE_FLOW, stage: "failed" }));
        return;
      case "image-ready":
        setFlow(kind, () => ({ ...IDLE_FLOW, stage: "image-ready", imageCopied: result.imageCopied, readyFor: sentFor }));
        if (result.imageCopied) toast.success("Imagem copiada — agora abra o WhatsApp e cole (Ctrl/Cmd+V).");
        else toast.success("Imagem baixada — anexe na conversa do WhatsApp.");
        return;
      case "shared":
      case "fallback-opened":
        markSent(kind);
        return;
    }
  }

  function send(kind: ActionKind, forceFallback = false) {
    const text = kind === "message" ? message : pixCode;
    if (!text || busy[kind]) return;
    const file = kind === "message" && imageKey ? image.file : null;
    const flow = flows[kind];
    const current = session.current;
    const sentFor = readyFor;
    setBusy((prev) => ({ ...prev, [kind]: true }));
    shareToWhatsApp({
      text,
      file,
      phone: customerPhone,
      nav: navigator,
      open: openTab,
      clipboardImage: copyImage,
      forceFallback: forceFallback || flow.needsGesture >= 2,
      skipTextCopy: flow.needsGesture > 0,
    })
      .then((result) => {
        if (session.current === current) handleResult(kind, result, sentFor);
      })
      .catch(() => {
        if (session.current === current) setFlow(kind, () => ({ ...IDLE_FLOW, stage: "failed" }));
      })
      .finally(() => {
        if (session.current === current) setBusy((prev) => ({ ...prev, [kind]: false }));
      });
  }

  function openWhatsApp() {
    const copied = flows.message.imageCopied;
    openTab(whatsappUrl(message, customerPhone));
    setFlow("message", () => IDLE_FLOW);
    setMessageSent(true);
    toast.success(
      copied
        ? "WhatsApp aberto — cole a imagem na conversa (Ctrl/Cmd+V)."
        : "WhatsApp aberto — anexe a imagem baixada na conversa.",
    );
  }

  function handleMessageClick() {
    if (awaitingOpen) openWhatsApp();
    else send("message", flows.message.stage === "failed");
  }

  function copyPix() {
    if (!pixCode) return;
    navigator.clipboard
      .writeText(pixCode)
      .then(() => toast.success("Pix copia e cola copiado."))
      .catch(() => toast.error("Não foi possível copiar."));
  }

  const messageLabel = !hasSelection
    ? "Enviar mensagem"
    : imageFailed
      ? "Resumo indisponível"
      : !imageReady
        ? "Preparando resumo…"
        : awaitingOpen
          ? "Abrir WhatsApp"
          : flows.message.stage === "failed"
            ? "Abrir no WhatsApp"
            : flows.message.needsGesture > 0
              ? "Compartilhar agora"
              : "Enviar mensagem";

  const pixLabel =
    flows.pix.stage === "failed"
      ? "Abrir no WhatsApp"
      : flows.pix.needsGesture > 0
        ? "Compartilhar agora"
        : "Enviar Pix copia e cola";

  const preparing = hasSelection && !imageFailed && !imageReady;

  return (
    <>
      <Button size="sm" variant="outline" className={triggerClassName} onClick={() => setOpen(true)}>
        <MessageCircle />
        <span className="sm:hidden">Cobrar</span>
        <span className="hidden sm:inline">Cobrar no WhatsApp</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cobrar {[customerName, customerSector].filter(Boolean).join(" · ")}</DialogTitle>
            <DialogDescription>
              {pendingCount} {pendingCount === 1 ? "pendência" : "pendências"} somando{" "}
              {formatChargeAmount(pendingCents)}. Selecione o que quer cobrar.
            </DialogDescription>
          </DialogHeader>

          <InstallmentPicker {...picker} />

          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
            <Label htmlFor={`charge-image-${customerId}`} className="flex-1 font-normal">
              Enviar imagem com o resumo
            </Label>
            <Switch id={`charge-image-${customerId}`} checked={sendImage} onCheckedChange={setSendImage} />
          </div>

          {tooManyForImage && (
            <p className="text-sm text-muted-foreground">
              Resumo disponível para até {CHARGE_IMAGE_MAX_INSTALLMENTS} parcelas. A mensagem vai só com o texto.
            </p>
          )}

          {imageFailed && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-destructive">
              {imageStale ? (
                <span>Os valores mudaram — feche e abra o Cobrar de novo.</span>
              ) : (
                <>
                  <span>Não foi possível gerar o resumo.</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => dispatchImage({ type: "retry" })}>
                    <RotateCw />
                    Tentar de novo
                  </Button>
                  <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setSendImage(false)}>
                    Enviar só o texto
                  </Button>
                </>
              )}
            </div>
          )}

          {hasSelection && (
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Ver mensagem</summary>
              <p className="mt-2 whitespace-pre-wrap">{message}</p>
            </details>
          )}

          {messageSent && pixCode && (
            <p className="text-sm font-medium text-primary">Agora mande o Pix copia e cola.</p>
          )}

          {!pixReady && canConfigure && (
            <Link href="/admin/charge" className="text-xs text-muted-foreground underline underline-offset-2">
              Configure o Pix para enviar copia e cola
            </Link>
          )}

          <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
            <Button
              type="button"
              variant={messageSent && pixCode && !awaitingOpen ? "outline" : "default"}
              className="w-full"
              onClick={handleMessageClick}
              disabled={busy.message || !hasSelection || imageFailed || !imageReady}
            >
              {preparing ? <Loader2 className="animate-spin" /> : <MessageCircle />}
              {messageLabel}
            </Button>
            {flows.message.stage === "cancelled" && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto self-center px-0 text-xs"
                onClick={() => send("message", true)}
                disabled={busy.message || !hasSelection || imageFailed || !imageReady}
              >
                Abrir no WhatsApp Web
              </Button>
            )}
            {pixReady && (
              <div className="flex w-full gap-2">
                <Button
                  type="button"
                  variant={messageSent ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => send("pix", flows.pix.stage === "failed")}
                  disabled={busy.pix || !pixCode}
                >
                  <QrCode />
                  {pixLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyPix}
                  disabled={!pixCode}
                  aria-label="Copiar Pix copia e cola"
                >
                  <Copy />
                  Copiar
                </Button>
              </div>
            )}
            {pixReady && flows.pix.stage === "cancelled" && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto self-center px-0 text-xs"
                onClick={() => send("pix", true)}
                disabled={busy.pix || !pixCode}
              >
                Abrir no WhatsApp Web
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
