const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ReportRange = {
  fromStr: string;
  toStr: string;
  from: Date;
  to: Date;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultReportRange(now: Date = new Date()): {
  fromStr: string;
  toStr: string;
} {
  return {
    fromStr: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    toStr: isoDate(now),
  };
}

export function parseReportRange(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): ReportRange {
  const fallback = defaultReportRange(now);
  const fromStr = DATE_RE.test(from ?? "") ? from! : fallback.fromStr;
  const rawTo = DATE_RE.test(to ?? "") ? to! : fallback.toStr;
  const toStr = rawTo < fromStr ? fromStr : rawTo;

  return {
    fromStr,
    toStr,
    from: new Date(`${fromStr}T00:00:00`),
    to: new Date(`${toStr}T23:59:59.999`),
  };
}

export function formatRangeLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
