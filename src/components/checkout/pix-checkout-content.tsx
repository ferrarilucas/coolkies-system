"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const QR_IMAGE_SIZE = 320;

export function formatDueDate(isoDate: string): string {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

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

export function PixCheckoutContent({
  pixCopyPaste,
  nextDueDate,
  previousPendingCharge,
}: {
  pixCopyPaste: string;
  nextDueDate: string | null;
  previousPendingCharge?: { cycleSeq: number; dueDate: string } | null;
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
      {previousPendingCharge && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-warning">
            Uma cobrança da sua assinatura anterior já foi enviada ao banco e
            será debitada em {formatDueDate(previousPendingCharge.dueDate)}{" "}
            mesmo com o cancelamento — regra do Banco Central, cancelamento não
            impede a cobrança já em andamento.
          </p>
        </div>
      )}
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
