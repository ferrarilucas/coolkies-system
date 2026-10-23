import { db } from "@/lib/db";
import { dueTodayNotification, saoPauloDayRange } from "@/lib/due-today";

export type PushKeys = { endpoint: string; p256dh: string; auth: string };
export type PushSendResult = "sent" | "gone" | "failed";
export type PushSender = (subscription: PushKeys, payload: string) => Promise<PushSendResult>;

export type DueRemindersSummary = { workspaces: number; sent: number; removed: number; failed: number };

export async function savePushSubscription(userId: string, keys: PushKeys): Promise<void> {
  await db.pushSubscription.upsert({
    where: { endpoint: keys.endpoint },
    create: { userId, ...keys },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function sendDueTodayReminders(
  send: PushSender,
  now: Date = new Date(),
): Promise<DueRemindersSummary> {
  const { start, end, isoDate } = saoPauloDayRange(now);
  const groups = await db.saleInstallment.groupBy({
    by: ["workspaceId"],
    where: { paidAt: null, dueDate: { gte: start, lt: end } },
    _count: { _all: true },
  });
  const summary: DueRemindersSummary = { workspaces: groups.length, sent: 0, removed: 0, failed: 0 };
  if (groups.length === 0) return summary;

  const counts = new Map(groups.map((group) => [group.workspaceId, group._count._all]));
  const workspaces = await db.workspace.findMany({
    where: { id: { in: [...counts.keys()] } },
    select: {
      id: true,
      name: true,
      members: {
        select: { user: { select: { pushSubscriptions: { select: { endpoint: true, p256dh: true, auth: true } } } } },
      },
    },
  });

  const gone = new Set<string>();
  for (const workspace of workspaces) {
    const payload = JSON.stringify(
      dueTodayNotification({
        count: counts.get(workspace.id) ?? 0,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        isoDate,
      }),
    );
    const subscriptions = workspace.members.flatMap((member) => member.user.pushSubscriptions);
    const results = await Promise.all(subscriptions.map((subscription) => send(subscription, payload)));
    results.forEach((result, index) => {
      if (result === "sent") summary.sent += 1;
      else if (result === "gone") gone.add(subscriptions[index].endpoint);
      else summary.failed += 1;
    });
  }

  if (gone.size > 0) {
    const { count } = await db.pushSubscription.deleteMany({ where: { endpoint: { in: [...gone] } } });
    summary.removed = count;
  }
  return summary;
}
