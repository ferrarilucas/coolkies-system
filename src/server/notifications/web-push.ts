import webpush, { WebPushError } from "web-push";
import type { PushKeys, PushSendResult, PushSender } from "@/server/tenant/push";

export function createWebPushSender(): PushSender | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;

  const vapidDetails = { subject, publicKey, privateKey };

  return async (subscription: PushKeys, payload: string): Promise<PushSendResult> => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { vapidDetails, TTL: 60 * 60 * 12, urgency: "high" },
      );
      return "sent";
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "gone";
      console.error("web-push", error instanceof Error ? error.message : error);
      return "failed";
    }
  };
}
