/**
 * Feriados nacionais do Brasil (fixos + móveis baseados na Páscoa).
 * Usado para o cálculo de "5º dia útil".
 */

function easterSunday(year: number): Date {
  // Algoritmo de Meeus/Jones/Butcher (Gregoriano)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function key(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

/** Conjunto de feriados nacionais BR de um ano (formato YYYY-M-D em UTC). */
export function brazilHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const fixed: Array<[number, number]> = [
    [1, 1], // Confraternização Universal
    [4, 21], // Tiradentes
    [5, 1], // Dia do Trabalho
    [9, 7], // Independência
    [10, 12], // Nossa Senhora Aparecida
    [11, 2], // Finados
    [11, 15], // Proclamação da República
    [11, 20], // Consciência Negra (feriado nacional desde 2024)
    [12, 25], // Natal
  ];
  const set = new Set<string>();
  for (const [m, d] of fixed) set.add(`${year}-${m}-${d}`);
  // móveis
  set.add(key(addDays(easter, -47))); // Carnaval (terça)
  set.add(key(addDays(easter, -2))); // Sexta-feira Santa
  set.add(key(addDays(easter, 60))); // Corpus Christi
  return set;
}

/** É dia útil? (não é fim de semana nem feriado nacional) */
export function isBusinessDay(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  const holidays = brazilHolidays(date.getFullYear());
  const k = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  return !holidays.has(k);
}
