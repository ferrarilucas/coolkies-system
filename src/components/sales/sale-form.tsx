"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, Trash2, ShoppingCart, Minus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
    items: Omit<SaleItemLine, "key">[];
  };
}

// ─── Stepper de quantidade ────────────────────────────────────────────────────

function QuantityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
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
      {/* Linha 1: produto + sabor */}
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

      {/* Linha 2: qtd + preço + total + lixo */}
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

  const [customer, setCustomer] = useState<CustomerSummary | null>(
    initial?.customer ?? null,
  );
  const [soldAt, setSoldAt] = useState(
    initial?.soldAt ?? format(new Date(), "yyyy-MM-dd"),
  );
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

  function updateLine(key: string, patch: Partial<SaleItemLine>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
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
  const totalCents = filledLines.reduce(
    (sum, l) => sum + l.unitPriceCents * l.quantity,
    0,
  );

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
    fd.set(
      "forecastDate",
      forecastDate ? format(forecastDate, "yyyy-MM-dd") : "",
    );
    fd.set(
      "items",
      JSON.stringify(
        filledLines.map(
          ({ productId, productName, flavorId, flavorName, quantity, unitPriceCents }) => ({
            productId, productName, flavorId, flavorName, quantity, unitPriceCents,
          }),
        ),
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
            <span className="text-sm font-semibold tabular-nums">
              Total: {formatBRL(totalCents)}
            </span>
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
      <div className="flex justify-end gap-3 pb-8">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/sales")}
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
  );
}
