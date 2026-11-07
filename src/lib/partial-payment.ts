import { addDays, addMonths } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { resolveForecast, type ForecastPreset } from "./business-days";
import { isValidIsoCalendarDate } from "./date-validation";
import { dueDateFor, splitAmount, type InstallmentPlan } from "./installments";
import { parseBRL } from "./money";

export type AllocatableInstallment = {
  id: string;
  number: number;
  amountCents: number;
  dueDate: Date | null;
  soldAt: Date;
};

export type Allocation = {
  fullIds: string[];
  partial: { id: string; paidCents: number; remainderCents: number } | null;
  untouchedIds: string[];
};

export type RemainderChoice = { mode: "NEW_DATE"; dueDate: string } | { mode: "SPREAD" } | { mode: "APPEND" };

export type SaleRow = InstallmentPlan & { id: string };

export type RemainderPlan = {
  updates: { id: string; amountCents: number }[];
  creates: {
    amountCents: number;
    dueDate: Date | null;
    forecastPreset: ForecastPreset | null;
    placeAfterNumber: number;
  }[];
};

const BRL_AMOUNT = /^(\d{1,3}(\.\d{3})*|\d+)(,\d{1,2})?$/;
const ERROR_ZERO = "Informe um valor maior que zero.";
const ERROR_ABOVE_TOTAL = "O valor é maior que o total selecionado.";
const ERROR_AMOUNT_MISSING = "Informe o valor recebido.";
const ERROR_INVALID_DATE = "Informe uma data válida.";
const ERROR_NO_NEXT = "Não há parcelas seguintes para diluir.";

const TIME_ZONE = "America/Sao_Paulo";

function calendarNoon(date: Date): Date {
  return new Date(`${formatInTimeZone(date, TIME_ZONE, "yyyy-MM-dd")}T12:00:00`);
}

function atNoon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function sortKey(item: AllocatableInstallment): number {
  return (item.dueDate ?? item.soldAt).getTime();
}

export function orderForAllocation<T extends AllocatableInstallment>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => sortKey(a) - sortKey(b) || a.soldAt.getTime() - b.soldAt.getTime() || a.number - b.number,
  );
}

export function allocate(
  items: AllocatableInstallment[],
  amountCents: number,
): { ok: true; allocation: Allocation } | { ok: false; error: string } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: ERROR_ZERO };
  const total = items.reduce((sum, i) => sum + i.amountCents, 0);
  if (amountCents > total) return { ok: false, error: ERROR_ABOVE_TOTAL };

  const fullIds: string[] = [];
  const untouchedIds: string[] = [];
  let partial: Allocation["partial"] = null;
  let left = amountCents;

  for (const item of orderForAllocation(items)) {
    if (left === 0) {
      untouchedIds.push(item.id);
    } else if (left >= item.amountCents) {
      fullIds.push(item.id);
      left -= item.amountCents;
    } else {
      partial = { id: item.id, paidCents: left, remainderCents: item.amountCents - left };
      left = 0;
    }
  }

  return { ok: true, allocation: { fullIds, partial, untouchedIds } };
}

function openRowsAfter(rows: SaleRow[], partialNumber: number, excludeIds: string[]): SaleRow[] {
  return rows
    .filter((r) => r.paidAt === null && r.number > partialNumber && !excludeIds.includes(r.id))
    .sort((a, b) => a.number - b.number);
}

export function canSpread(rows: SaleRow[], partialNumber: number, excludeIds: string[]): boolean {
  return openRowsAfter(rows, partialNumber, excludeIds).length > 0;
}

function appendDue(
  rows: SaleRow[],
  preset: ForecastPreset | null,
  now: Date,
): { dueDate: Date; forecastPreset: ForecastPreset | null } {
  const dated = rows.map((r) => r.dueDate).filter((d): d is Date => d !== null);
  if (dated.length === 0) return { dueDate: atNoon(addMonths(calendarNoon(now), 1)), forecastPreset: "CUSTOM" };
  const latest = calendarNoon(dated.reduce((max, d) => (d > max ? d : max)));
  if (preset) return { dueDate: atNoon(dueDateFor(latest, preset, 1)), forecastPreset: preset };
  return { dueDate: atNoon(addMonths(latest, 1)), forecastPreset: "CUSTOM" };
}

export function planRemainder(
  rows: SaleRow[],
  partialNumber: number,
  remainderCents: number,
  choice: RemainderChoice,
  salePreset: ForecastPreset | null,
  now: Date,
  excludeIds: string[],
): { ok: true; plan: RemainderPlan } | { ok: false; error: string } {
  if (!Number.isInteger(remainderCents) || remainderCents <= 0) return { ok: false, error: ERROR_ZERO };

  if (choice.mode === "NEW_DATE") {
    if (!isValidIsoCalendarDate(choice.dueDate)) return { ok: false, error: ERROR_INVALID_DATE };
    return {
      ok: true,
      plan: {
        updates: [],
        creates: [
          {
            amountCents: remainderCents,
            dueDate: new Date(`${choice.dueDate}T12:00:00`),
            forecastPreset: "CUSTOM",
            placeAfterNumber: partialNumber,
          },
        ],
      },
    };
  }

  if (choice.mode === "SPREAD") {
    const targets = openRowsAfter(rows, partialNumber, excludeIds);
    if (targets.length === 0) return { ok: false, error: ERROR_NO_NEXT };
    const shares = splitAmount(remainderCents, targets.length);
    return {
      ok: true,
      plan: {
        updates: targets.map((row, idx) => ({ id: row.id, amountCents: row.amountCents + shares[idx] })),
        creates: [],
      },
    };
  }

  const { dueDate, forecastPreset } = appendDue(rows, salePreset, now);
  const placeAfterNumber = rows.reduce((max, r) => Math.max(max, r.number), partialNumber);
  return {
    ok: true,
    plan: { updates: [], creates: [{ amountCents: remainderCents, dueDate, forecastPreset, placeAfterNumber }] },
  };
}

export function suggestedRemainderDate(preset: ForecastPreset | null, now: Date): Date {
  const today = calendarNoon(now);
  if (preset === "DAY_FIVE" || preset === "FIFTH_BUSINESS_DAY") {
    const resolved = resolveForecast(preset, undefined, today);
    if (resolved) return atNoon(resolved);
  }
  if (preset === "CUSTOM") return atNoon(addMonths(today, 1));
  return atNoon(addDays(today, 30));
}

export function parseReceiveAmount(
  input: string,
  maxCents: number,
): { ok: true; cents: number } | { ok: false; error: string } {
  const cleaned = input.trim().replace(/^R\$\s*/, "");
  if (!BRL_AMOUNT.test(cleaned)) return { ok: false, error: ERROR_AMOUNT_MISSING };
  const cents = parseBRL(cleaned);
  if (cents <= 0) return { ok: false, error: ERROR_ZERO };
  if (cents > maxCents) return { ok: false, error: ERROR_ABOVE_TOTAL };
  return { ok: true, cents };
}
