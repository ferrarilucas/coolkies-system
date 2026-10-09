import { fifthBusinessDayOfMonth, resolveForecast, type ForecastPreset } from "./business-days";

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 24;

export type InstallmentPlan = {
  number: number;
  amountCents: number;
  dueDate: Date | null;
  forecastPreset: ForecastPreset | null;
  paidAt: Date | null;
};

export type PaymentChoice =
  | { mode: "CASH"; paidNow: true }
  | { mode: "CASH"; paidNow: false; preset: ForecastPreset | null; firstDue: Date | null }
  | { mode: "INSTALLMENTS"; count: number; preset: ForecastPreset; firstDue: Date };

export type PaymentFields = {
  mode: string;
  status: string;
  count: number;
  preset: string;
  dueDate: Date | null;
};

export type PlanResult = { ok: true; installments: InstallmentPlan[] } | { ok: false; error: string };

export type SaleSummaryFields = {
  status: "PAID" | "PENDING";
  paidAt: Date | null;
  paymentForecastDate: Date | null;
  forecastPreset: ForecastPreset | null;
  openCents: number;
  installmentCount: number;
};

const PRESETS: ForecastPreset[] = ["DAY_FIVE", "FIFTH_BUSINESS_DAY", "CUSTOM"];

function noon(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 12);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function splitAmount(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const amounts = Array.from({ length: count }, () => base);
  amounts[count - 1] += totalCents - base * count;
  return amounts;
}

export function dueDateFor(firstDue: Date, preset: ForecastPreset, offset: number): Date {
  const year = firstDue.getFullYear();
  const month = firstDue.getMonth() + offset;
  if (offset === 0) return noon(year, firstDue.getMonth(), firstDue.getDate());
  if (preset === "DAY_FIVE") return noon(year, month, 5);
  if (preset === "FIFTH_BUSINESS_DAY") {
    const date = fifthBusinessDayOfMonth(year, month);
    return noon(date.getFullYear(), date.getMonth(), date.getDate());
  }
  return noon(year, month, Math.min(firstDue.getDate(), lastDayOfMonth(year, month)));
}

export function buildSchedule(firstDue: Date, preset: ForecastPreset, count: number): Date[] {
  return Array.from({ length: count }, (_, offset) => dueDateFor(firstDue, preset, offset));
}

export function parsePaymentChoice(fields: PaymentFields, now: Date = new Date()): PaymentChoice | { error: string } {
  const knownPreset = PRESETS.includes(fields.preset as ForecastPreset) ? (fields.preset as ForecastPreset) : null;

  if (fields.mode !== "INSTALLMENTS") {
    if (fields.status !== "PENDING") return { mode: "CASH", paidNow: true };
    const preset = knownPreset ?? (fields.dueDate ? "CUSTOM" : null);
    const firstDue =
      fields.dueDate ?? (preset && preset !== "CUSTOM" ? resolveForecast(preset, undefined, now) : null);
    return { mode: "CASH", paidNow: false, preset, firstDue };
  }

  if (!Number.isInteger(fields.count) || fields.count < MIN_INSTALLMENTS || fields.count > MAX_INSTALLMENTS) {
    return { error: `O parcelamento deve ter de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas.` };
  }
  const preset = knownPreset ?? (fields.dueDate ? "CUSTOM" : "DAY_FIVE");
  const firstDue = fields.dueDate ?? (preset !== "CUSTOM" ? resolveForecast(preset, undefined, now) : null);
  if (!firstDue) return { error: "Informe a data da 1ª parcela." };
  return { mode: "INSTALLMENTS", count: fields.count, preset, firstDue };
}

function latestPaidAt(installments: InstallmentPlan[]): Date | null {
  return installments.reduce<Date | null>(
    (latest, i) => (i.paidAt && (!latest || i.paidAt > latest) ? i.paidAt : latest),
    null,
  );
}

export function planPayment(
  choice: PaymentChoice,
  totalCents: number,
  existing: InstallmentPlan[],
  now: Date,
): PlanResult {
  if (choice.mode === "CASH") {
    if (choice.paidNow) {
      const wasFullyPaid = existing.length > 0 && existing.every((i) => i.paidAt !== null);
      const paidAt = (wasFullyPaid ? latestPaidAt(existing) : null) ?? now;
      return {
        ok: true,
        installments: [{ number: 1, amountCents: totalCents, dueDate: null, forecastPreset: null, paidAt }],
      };
    }
    if (existing.length > 1 && existing.some((i) => i.paidAt !== null)) {
      return { ok: false, error: "Esta venda tem parcelas pagas. Desfaça os pagamentos antes de mudar para à vista." };
    }
    return {
      ok: true,
      installments: [
        { number: 1, amountCents: totalCents, dueDate: choice.firstDue, forecastPreset: choice.preset, paidAt: null },
      ],
    };
  }

  const paid = existing.filter((i) => i.paidAt !== null);
  const paidCents = paid.reduce((sum, i) => sum + i.amountCents, 0);
  if (totalCents < paidCents) return { ok: false, error: "O novo total é menor que o valor já pago." };

  const minCount = paid.reduce((max, i) => Math.max(max, i.number), 0);
  if (choice.count < minCount) {
    return {
      ok: false,
      error: `O número de parcelas não pode ser menor que ${minCount}, porque já há parcelas pagas.`,
    };
  }

  const remaining = totalCents - paidCents;
  const paidNumbers = new Set(paid.map((i) => i.number));
  const openNumbers = Array.from({ length: choice.count }, (_, idx) => idx + 1).filter((n) => !paidNumbers.has(n));

  if (remaining === 0) return { ok: true, installments: [...paid].sort((a, b) => a.number - b.number) };
  if (openNumbers.length === 0) {
    return {
      ok: false,
      error: "Todas as parcelas já foram pagas. Aumente o número de parcelas para cobrar a diferença.",
    };
  }

  const amounts = splitAmount(remaining, openNumbers.length);
  const open: InstallmentPlan[] = openNumbers.map((number, idx) => ({
    number,
    amountCents: amounts[idx],
    dueDate: dueDateFor(choice.firstDue, choice.preset, number - 1),
    forecastPreset: choice.preset,
    paidAt: null,
  }));
  return { ok: true, installments: [...paid, ...open].sort((a, b) => a.number - b.number) };
}

export function summarize(installments: InstallmentPlan[]): SaleSummaryFields {
  const open = installments.filter((i) => i.paidAt === null).sort((a, b) => a.number - b.number);
  const openCents = open.reduce((sum, i) => sum + i.amountCents, 0);
  if (open.length === 0) {
    return {
      status: "PAID",
      paidAt: latestPaidAt(installments),
      paymentForecastDate: null,
      forecastPreset: null,
      openCents: 0,
      installmentCount: installments.length,
    };
  }
  return {
    status: "PENDING",
    paidAt: null,
    paymentForecastDate: open[0].dueDate,
    forecastPreset: open[0].forecastPreset,
    openCents,
    installmentCount: installments.length,
  };
}
