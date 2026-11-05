"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WriteGate, useReadOnly } from "@/components/layout/read-only-context";
import { updateChargeSettings } from "@/server/actions/charge-settings";
import type { ChargeSettings } from "@/server/tenant/charge-settings";
import {
  CHARGE_TEMPLATE_MAX,
  CHARGE_VARIABLES,
  DEFAULT_CHARGE_TEMPLATE,
  renderChargeMessage,
} from "@/lib/charge-message";
import {
  PIX_CITY_MAX,
  PIX_KEY_MAX,
  PIX_KEY_TYPES,
  PIX_KEY_TYPE_LABELS,
  PIX_NAME_MAX,
  isPixConfigured,
  normalizePixKey,
  type PixKeyType,
} from "@/lib/pix";

const KEY_PLACEHOLDERS: Record<PixKeyType, string> = {
  CPF: "000.000.000-00",
  CNPJ: "00.000.000/0000-00",
  PHONE: "(11) 98765-4321",
  EMAIL: "voce@exemplo.com",
  EVP: "123e4567-e89b-12d3-a456-426614174000",
};

export function ChargeSettingsForm({ settings }: { settings: ChargeSettings }) {
  return <ChargeSettingsFormInner key={JSON.stringify(settings)} settings={settings} />;
}

function ChargeSettingsFormInner({ settings }: { settings: ChargeSettings }) {
  const router = useRouter();
  const readOnly = useReadOnly();
  const [template, setTemplate] = useState(settings.template ?? DEFAULT_CHARGE_TEMPLATE);
  const [sendImage, setSendImage] = useState(settings.sendImage);
  const [keyType, setKeyType] = useState<PixKeyType | "">(settings.pixKeyType ?? "");
  const [pixKey, setPixKey] = useState(settings.pixKey ?? "");
  const [name, setName] = useState(settings.pixRecipientName ?? "");
  const [city, setCity] = useState(settings.pixCity ?? "");
  const [saving, startSave] = useTransition();
  const templateRef = useRef<HTMLTextAreaElement>(null);

  const normalizedKey = keyType !== "" && pixKey.trim() !== "" ? normalizePixKey(keyType, pixKey) : null;
  const keyValid = normalizedKey?.ok === true;
  const preview = renderChargeMessage({
    template,
    customerName: "Maria da Silva",
    totalCents: 15000,
    pixKey: normalizedKey?.ok ? normalizedKey.key : null,
  });
  const pixReady =
    keyValid &&
    isPixConfigured({
      pixKey: pixKey || null,
      pixRecipientName: name || null,
      pixCity: city || null,
    });

  function insertVariable(variable: string) {
    if (readOnly || template.length + variable.length > CHARGE_TEMPLATE_MAX) return;
    const el = templateRef.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    const next = template.slice(0, start) + variable + template.slice(end);
    setTemplate(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + variable.length, start + variable.length);
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const fd = new FormData(e.currentTarget);
    fd.set("pixKeyType", keyType);
    if (sendImage) fd.set("sendImage", "on");
    else fd.delete("sendImage");
    startSave(async () => {
      const res = await updateChargeSettings(fd);
      if (res.ok) {
        toast.success("Configuração de cobrança salva.");
        router.refresh();
      } else toast.error(res.error ?? "Erro ao salvar.");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="font-medium">Mensagem</h2>
          <p className="text-sm text-muted-foreground">
            Texto que vai para o WhatsApp. Linhas com variável vazia, como o Pix não preenchido, são removidas.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="charge-template">Modelo</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setTemplate(DEFAULT_CHARGE_TEMPLATE)}
              disabled={readOnly || template === DEFAULT_CHARGE_TEMPLATE}
            >
              Restaurar padrão
            </Button>
          </div>
          <Textarea
            id="charge-template"
            name="template"
            ref={templateRef}
            rows={6}
            maxLength={CHARGE_TEMPLATE_MAX}
            value={template}
            disabled={readOnly}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {CHARGE_VARIABLES.map((variable) => (
              <Button
                key={variable}
                type="button"
                variant="outline"
                size="sm"
                className="h-9 font-mono text-xs sm:h-7"
                disabled={readOnly || template.length + variable.length > CHARGE_TEMPLATE_MAX}
                onClick={() => insertVariable(variable)}
              >
                {variable}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prévia</p>
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{preview}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="charge-send-image" className="flex-1">
            Enviar imagem do resumo por padrão
            <span className="block text-xs font-normal text-muted-foreground">Dá para trocar na hora de cobrar.</span>
          </Label>
          <Switch id="charge-send-image" checked={sendImage} onCheckedChange={setSendImage} disabled={readOnly} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="font-medium">Pix</h2>
          <p className="text-sm text-muted-foreground">
            Usado na variável {"{pix}"} e para gerar o Pix copia e cola com o valor da cobrança.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-2">
            <Label htmlFor="pix-key-type">Tipo da chave</Label>
            <Select value={keyType} disabled={readOnly} onValueChange={(v) => setKeyType(v as PixKeyType)}>
              <SelectTrigger id="pix-key-type">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {PIX_KEY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {PIX_KEY_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix-key">Chave</Label>
            <Input
              id="pix-key"
              name="pixKey"
              value={pixKey}
              disabled={readOnly}
              maxLength={PIX_KEY_MAX}
              onChange={(e) => setPixKey(e.target.value)}
              placeholder={keyType ? KEY_PLACEHOLDERS[keyType] : "Escolha o tipo primeiro"}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pix-name">Nome de quem recebe</Label>
            <Input
              id="pix-name"
              name="pixRecipientName"
              value={name}
              disabled={readOnly}
              maxLength={PIX_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como aparece no banco"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix-city">Cidade</Label>
            <Input
              id="pix-city"
              name="pixCity"
              value={city}
              disabled={readOnly}
              maxLength={PIX_CITY_MAX}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Ex.: Curitiba"
            />
          </div>
        </div>

        <p
          aria-live="polite"
          className={
            pixReady
              ? "flex items-center gap-1.5 text-sm text-success"
              : "flex items-center gap-1.5 text-sm text-muted-foreground"
          }
        >
          {pixReady ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
          {pixReady
            ? "Pix copia e cola pronto."
            : pixKey.trim() && keyType === ""
              ? "Escolha o tipo da chave Pix."
              : pixKey.trim() && !keyValid
                ? `Chave inválida para ${keyType ? PIX_KEY_TYPE_LABELS[keyType] : "o tipo escolhido"}.`
                : "Preencha chave, nome e cidade para enviar o copia e cola."}
        </p>
      </section>

      <div className="flex justify-end">
        <WriteGate>
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </WriteGate>
      </div>
    </form>
  );
}
