import { isBusinessDay } from "./holidays";

/**
 * Cálculo das datas de previsão de pagamento.
 * Toda a lógica trabalha em horário local do servidor; em produção
 * recomenda-se rodar com TZ=America/Sao_Paulo (ver README).
 */

/**
 * "Dia 5": próxima ocorrência do dia 5.
 * Se hoje já passou do dia 5 (ou é depois), agenda para o dia 5 do mês seguinte.
 */
export function nextDayFive(from: Date = new Date()): Date {
  const year = from.getFullYear();
  const month = from.getMonth();
  const day = from.getDate();

  if (day < 5) {
    return new Date(year, month, 5);
  }
  // dia 5 do próximo mês
  return new Date(year, month + 1, 5);
}

/**
 * "5º dia útil": 5º dia útil do mês de referência.
 * Por padrão calcula sobre o PRÓXIMO mês (cenário comum de recebimento),
 * mas se ainda não passou do 5º dia útil do mês atual, usa o mês atual.
 */
export function fifthBusinessDay(from: Date = new Date()): Date {
  const currentMonthFifth = fifthBusinessDayOfMonth(
    from.getFullYear(),
    from.getMonth(),
  );
  if (currentMonthFifth > from) {
    return currentMonthFifth;
  }
  return fifthBusinessDayOfMonth(from.getFullYear(), from.getMonth() + 1);
}

/** 5º dia útil de um mês específico (month 0-based; aceita overflow). */
export function fifthBusinessDayOfMonth(year: number, month: number): Date {
  const date = new Date(year, month, 1);
  let count = 0;
  while (count < 5) {
    if (isBusinessDay(date)) {
      count += 1;
      if (count === 5) break;
    }
    date.setDate(date.getDate() + 1);
  }
  return date;
}

export type ForecastPreset = "DAY_FIVE" | "FIFTH_BUSINESS_DAY" | "CUSTOM";

export function resolveForecast(
  preset: ForecastPreset,
  custom?: Date,
  from: Date = new Date(),
): Date | null {
  switch (preset) {
    case "DAY_FIVE":
      return nextDayFive(from);
    case "FIFTH_BUSINESS_DAY":
      return fifthBusinessDay(from);
    case "CUSTOM":
      return custom ?? null;
  }
}
