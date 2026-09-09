export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isRealCalendarDate(isoDate: string): boolean {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidIsoCalendarDate(isoDate: string): boolean {
  return ISO_DATE_PATTERN.test(isoDate) && isRealCalendarDate(isoDate);
}
