"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, Loader2, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RemainderOptions, toRemainderChoice, type RemainderDraft } from "@/components/sales/remainder-options";
import { receivePayment } from "@/server/actions/sales";
import type { ForecastPreset } from "@/lib/business-days";
import { formatBRL } from "@/lib/money";
import {
  allocate,
  canSpread,
  orderForAllocation,
  parseReceiveAmount,
  planPreset,
  planRemainder,
  RACE_ERROR,
  suggestedRemainderDate,
  type AllocatableInstallment,
  type Allocation,
  type SaleRow,
} from "@/lib/partial-payment";
import { cn } from "@/lib/utils";

export type ReceiveTarget = AllocatableInstallment & {
  saleLabel: string;
  saleRows: SaleRow[];
  salePreset: ForecastPreset | null;
  installmentCount: number;
};

export type ReceiveResult = { count: number; totalCents: number; partial: boolean; paidInstallmentIds: string[] };

export type ReceiveSelection = {
  selected: Set<string>;
  toggle: (id: string) => void;
  dueIds: string[];
  toggleAll?: () => void;
  allSelected?: boolean;
};

export function toReceiveTarget(
  installment: { id: string; number: number; amountCents: number; dueDate: Date | null },
  sale: { soldAt: Date; forecastPreset: ForecastPreset | null; installmentCount: number; rows: SaleRow[] },
): ReceiveTarget {
  return {
    id: installment.id,
    number: installment.number,
    amountCents: installment.amountCents,
    dueDate: installment.dueDate,
    soldAt: sale.soldAt,
    saleLabel: format(sale.soldAt, "dd/MM", { locale: ptBR }),
    saleRows: sale.rows,
    salePreset: sale.forecastPreset,
    installmentCount: sale.installmentCount,
  };
}

const SELECT_ONE = "Selecione ao menos uma parcela.";
const KEYBOARD_MIN_PX = 60;
const STEP_GUARD_MS = 400;

function plainBRL(cents: number): string {
  return formatBRL(cents).replace(/^R\$\s*/, "");
}

function sanitizeAmount(input: string): string {
  return input.replace(/[^\d.,]/g, "");
}

function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !viewport) return;
    const update = () => {
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const next = Math.round(layoutHeight - viewport.height - viewport.offsetTop);
      setInset(next > KEYBOARD_MIN_PX ? next : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [active]);
  return inset;
}

type Seal = { label: string; tone: "paid" | "partial" | "open" };

function sealFor(id: string, allocation: Allocation | null): Seal | null {
  if (!allocation) return null;
  if (allocation.fullIds.includes(id)) return { label: "quitada", tone: "paid" };
  if (allocation.partial?.id === id) {
    return {
      label: `${formatBRL(allocation.partial.paidCents)} · faltam ${formatBRL(allocation.partial.remainderCents)}`,
      tone: "partial",
    };
  }
  if (allocation.untouchedIds.includes(id)) return { label: "fica aberta", tone: "open" };
  return null;
}

const SEAL_TONE: Record<Seal["tone"], string> = {
  paid: "bg-success/15 text-success border-success/30",
  partial: "bg-warning/15 text-warning-text border-warning/30",
  open: "bg-muted text-muted-foreground border-border",
};

export function ReceiveSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  targets,
  selection,
  onReceived,
  loading,
  loadFailed,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  targets: ReceiveTarget[];
  selection?: ReceiveSelection;
  onReceived: (result: ReceiveResult) => void;
  loading?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const inset = useKeyboardInset(open);
  const contentRef = useRef<HTMLDivElement>(null);

  function handleOpenChange(next: boolean) {
    if (saving && !next) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        style={{ "--kb": `${inset}px` } as CSSProperties}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.focus();
        }}
        className={cn(
          "flex flex-col gap-0 p-0 outline-none",
          "bottom-[var(--kb)] top-auto max-h-[calc(100dvh-var(--kb)-env(safe-area-inset-top)-0.5rem)] translate-y-0 rounded-b-none rounded-t-2xl",
          "max-sm:data-[state=closed]:slide-out-to-bottom-full max-sm:data-[state=open]:slide-in-from-bottom-full max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100",
          "sm:bottom-auto sm:top-[50%] sm:max-h-[85dvh] sm:max-w-md sm:translate-y-[-50%] sm:rounded-lg",
        )}
      >
        <ReceiveSheetBody
          title={title}
          subtitle={subtitle}
          targets={targets}
          selection={selection}
          loading={loading}
          loadFailed={loadFailed}
          onRetry={onRetry}
          saving={saving}
          keyboardOpen={inset > 0}
          onCancel={() => handleOpenChange(false)}
          onSubmit={(input) =>
            startSave(async () => {
              const res = await receivePayment(input);
              if (res.ok && res.data) {
                onReceived(res.data);
                return;
              }
              toast.error(res.error ?? "Erro ao registrar recebimento.");
              router.refresh();
              if (res.error === RACE_ERROR) onOpenChange(false);
            })
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function ReceiveSheetBody({
  title,
  subtitle,
  targets,
  selection,
  loading,
  loadFailed,
  onRetry,
  saving,
  keyboardOpen,
  onCancel,
  onSubmit,
}: {
  title: string;
  subtitle?: string;
  targets: ReceiveTarget[];
  selection?: ReceiveSelection;
  loading?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
  saving: boolean;
  keyboardOpen: boolean;
  onCancel: () => void;
  onSubmit: (input: Parameters<typeof receivePayment>[0]) => void;
}) {
  const [amountText, setAmountText] = useState("");
  const [touched, setTouched] = useState(false);
  const stepChangedAt = useRef(0);
  const [edited, setEdited] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [remainder, setRemainder] = useState<{ partialId: string; draft: RemainderDraft } | null>(null);

  const ordered = useMemo(() => orderForAllocation(targets), [targets]);
  const trackedSelection = useMemo<ReceiveSelection | undefined>(
    () =>
      selection && {
        ...selection,
        toggle: (id: string) => {
          setTouched(true);
          selection.toggle(id);
        },
        toggleAll: selection.toggleAll
          ? () => {
              setTouched(true);
              selection.toggleAll?.();
            }
          : undefined,
      },
    [selection],
  );
  const selectedTargets = useMemo(
    () => (selection ? ordered.filter((t) => selection.selected.has(t.id)) : ordered),
    [ordered, selection],
  );
  const totalCents = selectedTargets.reduce((sum, t) => sum + t.amountCents, 0);
  const dueSelected = selection
    ? selectedTargets.filter((t) => selection.dueIds.includes(t.id))
    : [];
  const dueCents = dueSelected.reduce((sum, t) => sum + t.amountCents, 0);
  const showDueChip = dueSelected.length > 0 && dueSelected.length < selectedTargets.length;

  const shownText = edited ? amountText : totalCents > 0 ? plainBRL(totalCents) : "";
  const parsed = totalCents > 0 ? parseReceiveAmount(shownText, totalCents) : ({ ok: false, error: SELECT_ONE } as const);
  const allocated = parsed.ok ? allocate(selectedTargets, parsed.cents) : null;
  const allocation = allocated?.ok ? allocated.allocation : null;
  const rawError = !parsed.ok ? parsed.error : allocated && !allocated.ok ? allocated.error : null;
  const amountError = totalCents === 0 && !touched && !edited ? null : rawError;
  const amountCents = parsed.ok ? parsed.cents : 0;
  const partial = allocation?.partial ?? null;
  const partialTarget = partial ? targets.find((t) => t.id === partial.id) ?? null : null;
  const selectedIds = selectedTargets.map((t) => t.id);
  const ready = !loading && !loadFailed && allocation !== null;

  const now = new Date();
  const preset = partialTarget ? planPreset(partialTarget.saleRows, partialTarget.salePreset) : null;
  const excludeIds =
    partialTarget && allocation
      ? allocation.fullIds.filter((id) => partialTarget.saleRows.some((row) => row.id === id))
      : [];
  const savedDraft = partialTarget && remainder?.partialId === partialTarget.id ? remainder.draft : null;
  const draft =
    savedDraft && (savedDraft.mode !== "SPREAD" || canSpread(partialTarget!.saleRows, partialTarget!.number, excludeIds))
      ? savedDraft
      : {
          mode: "NEW_DATE" as const,
          dueDate: format(suggestedRemainderDate(preset, now), "yyyy-MM-dd"),
        };
  const remainderPlan =
    partialTarget && partial
      ? planRemainder(
          partialTarget.saleRows,
          partialTarget.number,
          partial.remainderCents,
          toRemainderChoice(draft),
          preset,
          now,
          excludeIds,
        )
      : null;

  const onStep2 = step === 2 && partialTarget !== null && partial !== null;

  function setAmount(text: string) {
    setEdited(true);
    setTouched(true);
    setAmountText(sanitizeAmount(text));
  }

  function handleBlur() {
    if (edited && parsed.ok) setAmountText(plainBRL(parsed.cents));
  }

  function primary() {
    if (!ready || saving) return;
    if (onStep2) {
      if (!remainderPlan?.ok || !partial || !partialTarget) return;
      if (Date.now() - stepChangedAt.current < STEP_GUARD_MS) return;
      onSubmit({
        installmentIds: selectedIds,
        amountCents,
        remainder: toRemainderChoice(draft),
        expected: { partialId: partial.id, paidCents: partial.paidCents, remainderCents: partial.remainderCents },
        expectedRows: partialTarget.saleRows
          .filter((row) => row.paidAt === null)
          .map((row) => ({ id: row.id, amountCents: row.amountCents })),
      });
      return;
    }
    if (partialTarget) {
      stepChangedAt.current = Date.now();
      setRemainder({ partialId: partialTarget.id, draft });
      setStep(2);
      return;
    }
    onSubmit({ installmentIds: selectedIds, amountCents, expected: null });
  }

  const primaryLabel = saving
    ? "Registrando…"
    : !ready
      ? "Receber"
      : onStep2 || !partialTarget
        ? `Receber ${formatBRL(amountCents)}`
        : "Continuar";
  const primaryDisabled = saving || !ready || (onStep2 && !remainderPlan?.ok);

  return (
    <>
      <DialogHeader className="shrink-0 space-y-1 px-4 pb-3 pt-4 pr-12 text-left sm:px-6 sm:pt-6">
        {onStep2 && (
          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={saving}
            className="-ml-2 mb-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <ChevronLeft className="size-4" />
            Voltar
          </button>
        )}
        <DialogTitle className="text-lg">
          {onStep2 && partial ? `Faltam ${formatBRL(partial.remainderCents)}` : title}
        </DialogTitle>
        {onStep2 && partialTarget ? (
          <DialogDescription>
            Da venda de {partialTarget.saleLabel}
            {partialTarget.installmentCount > 1 &&
              ` · parcela ${partialTarget.number}/${partialTarget.installmentCount}`}
          </DialogDescription>
        ) : subtitle ? (
          <DialogDescription>{subtitle}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">Informe o valor recebido.</DialogDescription>
        )}
      </DialogHeader>

      {onStep2 && partialTarget && partial ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6">
          <RemainderOptions
            rows={partialTarget.saleRows}
            partialNumber={partialTarget.number}
            remainderCents={partial.remainderCents}
            preset={preset}
            now={now}
            excludeIds={excludeIds}
            installmentCount={partialTarget.installmentCount}
            value={draft}
            onChange={(next) => setRemainder({ partialId: partialTarget.id, draft: next })}
            disabled={saving}
          />
        </div>
      ) : (
        <>
          <div className="shrink-0 space-y-2 px-4 pb-3 sm:px-6">
            <label htmlFor="receive-amount" className="text-xs font-medium text-muted-foreground">
              Valor recebido
            </label>
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border bg-background px-3 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                amountError && !loading && !loadFailed ? "border-destructive" : "border-input",
              )}
            >
              <span className="text-xl font-semibold text-muted-foreground">R$</span>
              <input
                id="receive-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                disabled={saving || loading || loadFailed}
                value={shownText}
                onChange={(e) => setAmount(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    primary();
                  }
                }}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={amountError ? "receive-amount-error" : undefined}
                className="h-14 min-w-0 flex-1 bg-transparent text-3xl font-semibold tabular-nums outline-none disabled:opacity-50"
              />
            </div>
            {amountError && !loading && !loadFailed ? (
              <p id="receive-amount-error" className="text-sm text-destructive">
                {amountError}
              </p>
            ) : null}
            {!loading && !loadFailed && targets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={parsed.ok && parsed.cents === totalCents}
                  disabled={saving || totalCents === 0}
                  onClick={() => {
                    setEdited(false);
                    setAmountText("");
                  }}
                >
                  Total
                </Chip>
                {showDueChip && (
                  <Chip
                    active={parsed.ok && parsed.cents === dueCents}
                    disabled={saving}
                    onClick={() => {
                      setEdited(true);
                      setAmountText(plainBRL(dueCents));
                    }}
                  >
                    Só o vencido · {formatBRL(dueCents)}
                  </Chip>
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t px-4 py-3 sm:px-6">
            <TargetList
              ordered={ordered}
              selection={trackedSelection}
              allocation={allocation}
              loading={loading}
              loadFailed={loadFailed}
              onRetry={onRetry}
              disabled={saving}
            />
          </div>
        </>
      )}

      <div
        className={cn(
          "shrink-0 border-t bg-background px-4 pt-3 sm:rounded-b-lg sm:px-6 sm:pb-4",
          keyboardOpen ? "pb-3" : "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        )}
      >
        <div className="flex gap-2">
          <Button type="button" size="lg" variant="outline" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" size="lg" className="flex-1" onClick={primary} disabled={primaryDisabled}>
            {saving && <Loader2 className="animate-spin" />}
            {primaryLabel}
          </Button>
        </div>
        {onStep2 && remainderPlan && !remainderPlan.ok && (
          <p className="mt-2 text-center text-sm text-destructive">{remainderPlan.error}</p>
        )}
      </div>
    </>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium tabular-nums transition-colors disabled:opacity-50",
        active ? "border-primary bg-primary/10 text-foreground" : "border-input hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function TargetList({
  ordered,
  selection,
  allocation,
  loading,
  loadFailed,
  onRetry,
  disabled,
}: {
  ordered: ReceiveTarget[];
  selection?: ReceiveSelection;
  allocation: Allocation | null;
  loading?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
  disabled: boolean;
}) {
  if (loadFailed) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-destructive">
        <span>Não foi possível carregar as parcelas.</span>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCw />
            Tentar de novo
          </Button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (ordered.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma parcela em aberto.</p>;
  }

  const now = new Date();

  return (
    <div className="space-y-2">
      {selection && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {selection.selected.size} de {ordered.length} selecionada{ordered.length === 1 ? "" : "s"}
          </span>
          {selection.toggleAll && (
            <Button type="button" variant="ghost" size="sm" className="h-11" onClick={selection.toggleAll} disabled={disabled}>
              {selection.allSelected ? "Limpar seleção" : "Selecionar tudo"}
            </Button>
          )}
        </div>
      )}
      <ul className="space-y-2">
        {ordered.map((target) => {
          const isSelected = selection ? selection.selected.has(target.id) : true;
          const seal = isSelected ? sealFor(target.id, allocation) : null;
          const overdue = target.dueDate !== null && target.dueDate < now;
          const content = (
            <>
              {selection && (
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded border",
                    isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                  )}
                >
                  {isSelected && <Check className="size-3.5" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium tabular-nums">
                  {formatBRL(target.amountCents)}
                  {target.installmentCount > 1 && (
                    <span className="font-normal text-muted-foreground">
                      {" "}· parcela {target.number}/{target.installmentCount}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {overdue && (
                    <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                      Atrasada
                    </Badge>
                  )}
                  <span className="min-w-0 truncate">
                    Venda de {format(target.soldAt, "dd/MM/yyyy", { locale: ptBR })}
                    {target.dueDate && ` · vence ${format(target.dueDate, "dd/MM", { locale: ptBR })}`}
                  </span>
                </span>
              </span>
              {seal && (
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
                    SEAL_TONE[seal.tone],
                  )}
                >
                  {seal.label}
                </span>
              )}
            </>
          );
          return (
            <li key={target.id}>
              {selection ? (
                <button
                  type="button"
                  onClick={() => selection.toggle(target.id)}
                  aria-pressed={isSelected}
                  disabled={disabled}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50",
                    isSelected ? "border-primary bg-primary/5" : "opacity-70 hover:bg-muted",
                  )}
                >
                  {content}
                </button>
              ) : (
                <div className="flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
