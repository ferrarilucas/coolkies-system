"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, Trash2, ShoppingCart, Minus, Tag, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/money-input";
import { CustomerCombobox } from "@/components/customers/customer-combobox";
import { formatBRL } from "@/lib/money";
import { createSale, updateSale } from "@/server/actions/sales";
import { resolveForecast, type ForecastPreset } from "@/lib/business-days";
import type { CustomerSummary } from "@/server/queries/customers";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type CatalogProduct = {
  id: string;
  name: string;
  genericPriceCents: number | null;
  flavors: { id: string; name: string; priceCents: number | null }[];
};

type SaleItemLine = {
  key: string;
  productId: string;
  productName: string;
  flavorId: string | null;
  flavorName: string | null;
  quantity: number;
  unitPriceCents: number;
};

type DiscountType = "PERCENTAGE" | "FIXED";
type PayStatus = "PAID" | ForecastPreset;

const NO_FLAVOR = "__none__";

function blankLine(catalog: CatalogProduct[]): SaleItemLine {
  const only = catalog.length === 1 ? catalog[0] : null;
  return {
    key: crypto.randomUUID(),
    productId: only?.id ?? "",
    productName: only?.name ?? "",
    flavorId: null,
    flavorName: null,
    quantity: 1,
    unitPriceCents: only?.genericPriceCents ?? 0,
  };
}

function calcDiscountCents(subtotal: number, type: DiscountType | null, value: number): number {
  if (!type || value <= 0) return 0;
  if (type === "PERCENTAGE") return Math.round(subtotal * value / 100);
  return Math.min(value, subtotal);
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  saleId?: string;
  catalog: CatalogProduct[];
  initial?: {
    customer: CustomerSummary | null;
    soldAt: string;
    notes: string;
    status: "PAID" | "PENDING";
    forecastPreset: string | null;
    forecastDate: string | null;
    discountType: DiscountType | null;
    discountValue: number;
    items: Omit<SaleItemLine, "key">[];
  };
}

// ─── Stepper de quantidade ────────────────────────────────────────────────────

function QuantityStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-label="Diminuir"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-10 w-10 items-center justify-center rounded-l-md border border-r-0 bg-background text-muted-foreground transition-colors hover:bg-muted active:bg-muted/70"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value);
          if (!isNaN(n) && n >= 1) onChange(n);
        }}
        className="h-10 w-10 border-y bg-background text-center text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Aumentar"
        onClick={() => onChange(value + 1)}
        className="flex h-10 w-10 items-center justify-center rounded-r-md border border-l-0 bg-background text-muted-foreground transition-colors hover:bg-muted active:bg-muted/70"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

// ─── Linha de item ────────────────────────────────────────────────────────────

function ItemRow({
  line,
  catalog,
  onChange,
  onRemove,
  showTotal,
}: {
  line: SaleItemLine;
  catalog: CatalogProduct[];
  onChange: (updated: Partial<SaleItemLine>) => void;
  onRemove: () => void;
  showTotal: boolean;
}) {
  const product = catalog.find((p) => p.id === line.productId);
  const flavors = product?.flavors ?? [];

  function handleProductChange(pid: string) {
    const p = catalog.find((x) => x.id === pid);
    onChange({
      productId: pid,
      productName: p?.name ?? "",
      flavorId: null,
      flavorName: null,
      unitPriceCents: p?.genericPriceCents ?? 0,
    });
  }

  function handleFlavorChange(fid: string) {
    const flavorId = fid === NO_FLAVOR ? null : fid;
    const flavor = product?.flavors.find((f) => f.id === flavorId);
    onChange({
      flavorId,
      flavorName: flavor?.name ?? null,
      unitPriceCents:
        flavor?.priceCents ?? product?.genericPriceCents ?? line.unitPriceCents,
    });
  }

  const lineTotal = line.unitPriceCents * line.quantity;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select value={line.productId || ""} onValueChange={handleProductChange}>
          <SelectTrigger className={cn(!line.productId && "text-muted-foreground")}>
            <SelectValue placeholder="Produto…" />
          </SelectTrigger>
          <SelectContent>
            {catalog.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={line.flavorId ?? NO_FLAVOR}
          onValueChange={handleFlavorChange}
          disabled={!line.productId || flavors.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Sabor…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FLAVOR}>Sem sabor específico</SelectItem>
            {flavors.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <QuantityStepper
          value={line.quantity}
          onChange={(q) => onChange({ quantity: q })}
        />
        <span className="text-xs text-muted-foreground shrink-0">×</span>
        <MoneyInput
          valueCents={line.unitPriceCents}
          onChangeCents={(c) => onChange({ unitPriceCents: c })}
          disabled={!line.productId}
          className="flex-1 min-w-0"
        />
        {showTotal && (
          <span className="hidden sm:block w-20 text-right text-sm tabular-nums text-muted-foreground shrink-0">
            = {formatBRL(lineTotal)}
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
          aria-label="Remover item"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function SaleForm({ saleId, catalog, initial }: Props) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  const [customer, setCustomer] = useState<CustomerSummary | null>(initial?.customer ?? null);
  const [soldAt, setSoldAt] = useState(initial?.soldAt ?? format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [lines, setLines] = useState<SaleItemLine[]>(
    initial?.items?.length
      ? initial.items.map((i) => ({ ...i, key: crypto.randomUUID() }))
      : [blankLine(catalog)],
  );

  const initialPayStatus: PayStatus =
    initial?.status === "PENDING"
      ? ((initial.forecastPreset as ForecastPreset) ?? "DAY_FIVE")
      : "PAID";
  const [payStatus, setPayStatus] = useState<PayStatus>(initialPayStatus);
  const [customDate, setCustomDate] = useState(initial?.forecastDate ?? "");

  // Desconto
  const [discountType, setDiscountType] = useState<DiscountType | null>(initial?.discountType ?? null);
  const [discountValue, setDiscountValue] = useState<number>(initial?.discountValue ?? 0);

  const [confirmLeave, setConfirmLeave] = useState(false);

  const currentSnapshot = JSON.stringify({
    customer: customer?.id ?? null,
    soldAt,
    notes,
    payStatus,
    customDate,
    discountType,
    discountValue,
    lines: lines.map((l) => [l.productId, l.flavorId, l.quantity, l.unitPriceCents]),
  });
  const firstSnapshot = useRef<string | null>(null);
  if (firstSnapshot.current === null) firstSnapshot.current = currentSnapshot;
  const dirty = currentSnapshot !== firstSnapshot.current;

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function handleCancel() {
    if (dirty) setConfirmLeave(true);
    else router.push("/sales");
  }

  function updateLine(key: string, patch: Partial<SaleItemLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => {
      const next = prev.filter((l) => l.key !== key);
      return next.length === 0 ? [blankLine(catalog)] : next;
    });
  }

  function addBlankLine() {
    setLines((prev) => [...prev, blankLine(catalog)]);
  }

  const filledLines = lines.filter((l) => l.productId !== "");
  const subtotalCents = filledLines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const discountCents = calcDiscountCents(subtotalCents, discountType, discountValue);
  const totalCents = subtotalCents - discountCents;
  const zeroPriceCount = filledLines.filter((l) => l.unitPriceCents === 0).length;

  const forecastDate: Date | null =
    payStatus === "PAID"
      ? null
      : payStatus === "CUSTOM" && customDate
        ? new Date(`${customDate}T12:00:00`)
        : resolveForecast(payStatus as ForecastPreset, undefined);

  function handleSubmit() {
    if (filledLines.length === 0) {
      toast.error("Adicione pelo menos um produto.");
      return;
    }

    const fd = new FormData();
    fd.set("customerId", customer?.id ?? "");
    fd.set("customerName", customer?.name ?? "");
    fd.set("soldAt", soldAt);
    fd.set("notes", notes);
    fd.set("status", payStatus === "PAID" ? "PAID" : "PENDING");
    fd.set("forecastPreset", payStatus !== "PAID" ? payStatus : "");
    fd.set("forecastDate", forecastDate ? format(forecastDate, "yyyy-MM-dd") : "");
    fd.set("discountType", discountType ?? "");
    fd.set("discountValue", String(discountValue));
    fd.set(
      "items",
      JSON.stringify(
        filledLines.map(({ productId, productName, flavorId, flavorName, quantity, unitPriceCents }) => ({
          productId, productName, flavorId, flavorName, quantity, unitPriceCents,
        })),
      ),
    );

    startSaving(async () => {
      const res = saleId ? await updateSale(saleId, fd) : await createSale(fd);
      if (res.ok) {
        toast.success(saleId ? "Venda atualizada." : "Venda registrada.");
        router.push("/sales");
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  const payOptions: { key: PayStatus; label: string }[] = [
    { key: "PAID", label: "Pago agora" },
    { key: "DAY_FIVE", label: "Dia 5" },
    { key: "FIFTH_BUSINESS_DAY", label: "5º dia útil" },
    { key: "CUSTOM", label: "Data personalizada" },
  ];

  return (
    <div className="space-y-8">

      {/* ── Informações ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Informações
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>
              Cliente <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <CustomerCombobox value={customer} onChange={setCustomer} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sold-at">Data da venda</Label>
            <Input
              id="sold-at"
              type="date"
              value={soldAt}
              onChange={(e) => setSoldAt(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">
            Observações <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Alguma observação sobre o pedido..."
            rows={2}
          />
        </div>
      </section>

      <Separator />

      {/* ── Itens ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Itens
        </h2>

        <div className="space-y-2">
          {lines.map((line) => (
            <ItemRow
              key={line.key}
              line={line}
              catalog={catalog}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
              showTotal={filledLines.length > 0}
            />
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          onClick={addBlankLine}
        >
          <Plus className="size-4" />
          Adicionar item
        </Button>

        {filledLines.length > 0 && (
          <div className="flex justify-end pt-1">
            <span className="text-sm text-muted-foreground tabular-nums">
              Subtotal: {formatBRL(subtotalCents)}
            </span>
          </div>
        )}
      </section>

      <Separator />

      {/* ── Desconto ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Tag className="size-3.5" />
          Desconto <span className="font-normal normal-case text-muted-foreground">(opcional)</span>
        </h2>

        <div className="flex items-start gap-3">
          {/* Tipo */}
          <div className="w-40 shrink-0 space-y-1.5">
            <Label>Tipo</Label>
            <Select
              value={discountType ?? "none"}
              onValueChange={(v) => {
                if (v === "none") {
                  setDiscountType(null);
                  setDiscountValue(0);
                } else {
                  setDiscountType(v as DiscountType);
                  setDiscountValue(0);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem desconto</SelectItem>
                <SelectItem value="PERCENTAGE">Percentual (%)</SelectItem>
                <SelectItem value="FIXED">Valor fixo (R$)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Valor */}
          {discountType && (
            <div className="flex-1 space-y-1.5">
              <Label>
                {discountType === "PERCENTAGE" ? "Percentual (%)" : "Valor (R$)"}
              </Label>
              {discountType === "PERCENTAGE" ? (
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={discountValue || ""}
                    onChange={(e) => {
                      const n = parseInt(e.target.value);
                      setDiscountValue(isNaN(n) ? 0 : Math.min(100, Math.max(0, n)));
                    }}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              ) : (
                <MoneyInput
                  valueCents={discountValue}
                  onChangeCents={setDiscountValue}
                />
              )}
            </div>
          )}
        </div>

        {/* Resumo do desconto */}
        {discountType && discountCents > 0 && filledLines.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatBRL(subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-destructive">
              <span>
                Desconto{" "}
                {discountType === "PERCENTAGE" && `(${discountValue}%)`}
              </span>
              <span className="tabular-nums">− {formatBRL(discountCents)}</span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatBRL(totalCents)}</span>
            </div>
          </div>
        )}

      </section>

      <Separator />

      {/* ── Pagamento ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Pagamento
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {payOptions.map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              variant={payStatus === key ? "default" : "outline"}
              onClick={() => setPayStatus(key)}
              className="justify-center"
            >
              {label}
            </Button>
          ))}
        </div>

        {payStatus === "CUSTOM" && (
          <Input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            min={format(new Date(), "yyyy-MM-dd")}
          />
        )}

        {payStatus !== "PAID" && forecastDate && (
          <p className="text-sm text-muted-foreground">
            Previsão de recebimento:{" "}
            <span className="font-medium text-foreground">
              {format(forecastDate, "PPP", { locale: ptBR })}
            </span>
          </p>
        )}
      </section>

      {/* ── Ações ──────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        {zeroPriceCount > 0 && (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-warning-text">
            <AlertTriangle className="size-3.5 text-warning" />
            {zeroPriceCount === 1
              ? "1 item está sem preço"
              : `${zeroPriceCount} itens estão sem preço`}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold tabular-nums">{formatBRL(totalCents)}</p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              <ShoppingCart className="size-4" />
              {saving ? "Salvando..." : saleId ? "Salvar venda" : "Registrar venda"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar alterações?</DialogTitle>
            <DialogDescription>
              As informações preenchidas neste formulário serão perdidas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeave(false)}>
              Continuar editando
            </Button>
            <Button variant="destructive" onClick={() => router.push("/sales")}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
