import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const TIME_ZONE = "America/Sao_Paulo";

export type DayRange = { start: Date; end: Date; isoDate: string };

export function saoPauloDayRange(now: Date = new Date()): DayRange {
  const isoDate = formatInTimeZone(now, TIME_ZONE, "yyyy-MM-dd");
  const start = fromZonedTime(`${isoDate}T00:00:00`, TIME_ZONE);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, isoDate };
}

export type DueTodayNotification = { title: string; body: string; url: string; tag: string };

export function dueTodayNotification(input: {
  count: number;
  workspaceId: string;
  workspaceName: string;
  isoDate: string;
}): DueTodayNotification {
  const { count, workspaceId, workspaceName, isoDate } = input;
  const body =
    count === 1
      ? "1 cobrança vence hoje. Toque para cobrar."
      : `${count} cobranças vencem hoje. Toque para cobrar.`;
  return {
    title: `Cobranças de hoje · ${workspaceName}`,
    body,
    url: `/sales?tab=pending&pfrom=${isoDate}&pto=${isoDate}`,
    tag: `due-today-${workspaceId}-${isoDate}`,
  };
}
