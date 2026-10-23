type PushPayload = { title: string; body: string; url: string; tag: string };

type ExtendableEventLike = Event & { waitUntil(promise: Promise<unknown>): void };
type PushEventLike = ExtendableEventLike & { data: { json(): unknown } | null };
type NotificationClickEventLike = ExtendableEventLike & { notification: Notification };
type WindowClientLike = { url: string; focus(): Promise<unknown>; navigate(url: string): Promise<unknown> };

type ServiceWorkerScope = {
  registration: ServiceWorkerRegistration;
  location: Location;
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "push", listener: (event: PushEventLike) => void): void;
  addEventListener(type: "notificationclick", listener: (event: NotificationClickEventLike) => void): void;
};

const sw = self as unknown as ServiceWorkerScope;

function isPushPayload(value: unknown): value is PushPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["title", "body", "url", "tag"].every((key) => typeof candidate[key] === "string");
}

sw.addEventListener("push", (event) => {
  const payload = event.data?.json();
  if (!isPushPayload(payload)) return;
  event.waitUntil(
    sw.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = typeof event.notification.data?.url === "string" ? event.notification.data.url : "/";
  const target = new URL(path, sw.location.origin).href;
  event.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((client) => new URL(client.url).origin === sw.location.origin);
      if (!open) return sw.clients.openWindow(target);
      await open.navigate(target);
      return open.focus();
    }),
  );
});

export {};
