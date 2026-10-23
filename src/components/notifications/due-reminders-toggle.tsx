"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useInstallContext } from "@/components/pwa/use-install-context";
import { subscribeToPush, unsubscribeFromPush } from "@/server/actions/notifications";

type Status = "loading" | "unsupported" | "install-first" | "denied" | "off" | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const descriptions: Record<Status, string> = {
  loading: "Aviso às 7h com as cobranças que vencem no dia",
  unsupported: "Este navegador não recebe notificações",
  "install-first": "Instale o app na tela inicial para receber avisos",
  denied: "Notificações bloqueadas nos ajustes do aparelho",
  off: "Aviso às 7h com as cobranças que vencem no dia",
  on: "Você recebe às 7h as cobranças que vencem no dia",
};

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function decodeKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export function DueRemindersToggle() {
  const install = useInstallContext();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!install) return;
    if (!pushSupported()) {
      setStatus(install.platform === "ios" && !install.isStandalone ? "install-first" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    currentSubscription()
      .then(async (subscription) => {
        if (subscription && Notification.permission === "granted") {
          await subscribeToPush(subscription.toJSON());
          setStatus("on");
        } else {
          setStatus("off");
        }
      })
      .catch(() => setStatus("off"));
  }, [install]);

  async function enable() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "denied" : "off");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      toast.error("Não foi possível ativar agora. Feche e abra o app de novo.");
      return;
    }
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(VAPID_PUBLIC_KEY),
      }));
    const result = await subscribeToPush(subscription.toJSON());
    if (!result.ok) {
      toast.error(result.error ?? "Não foi possível ativar as notificações.");
      return;
    }
    setStatus("on");
    toast.success("Pronto! Você vai receber o aviso às 7h.");
  }

  async function disable() {
    const subscription = await currentSubscription();
    if (subscription) {
      await unsubscribeFromPush(subscription.endpoint);
      await subscription.unsubscribe();
    }
    setStatus("off");
  }

  async function toggle(checked: boolean) {
    setBusy(true);
    try {
      await (checked ? enable() : disable());
    } catch {
      toast.error("Não foi possível alterar as notificações.");
    } finally {
      setBusy(false);
    }
  }

  if (!VAPID_PUBLIC_KEY) return null;

  const interactive = status === "on" || status === "off";

  return (
    <label className="flex w-full items-center gap-3 rounded-lg border bg-card p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <BellRing className="size-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Avisos de cobrança</p>
        <p className="text-xs text-muted-foreground">{descriptions[status]}</p>
      </div>
      <Switch
        checked={status === "on"}
        onCheckedChange={toggle}
        disabled={!interactive || busy}
        aria-label="Avisos de cobrança"
      />
    </label>
  );
}
