"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type InstallPlatform = "ios" | "android" | "other";

export type InstallContext = {
  platform: InstallPlatform;
  guidePlatform: "ios" | "android";
  isStandalone: boolean;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallPrompt(): (() => Promise<boolean>) | null {
  const available = useSyncExternalStore(
    subscribe,
    () => deferredPrompt !== null,
    () => false,
  );

  if (!available) return null;

  return async () => {
    const event = deferredPrompt;
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    deferredPrompt = null;
    notify();
    return outcome === "accepted";
  };
}

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/android/i.test(ua)) return "android";
  return "other";
}

function guidePlatformFor(platform: InstallPlatform): "ios" | "android" {
  if (platform !== "other") return platform;
  return /mac os x|macintosh/i.test(navigator.userAgent) ? "ios" : "android";
}

function detectStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useInstallContext(): InstallContext | null {
  const [context, setContext] = useState<InstallContext | null>(null);

  useEffect(() => {
    const platform = detectPlatform();
    setContext({
      platform,
      guidePlatform: guidePlatformFor(platform),
      isStandalone: detectStandalone(),
    });
  }, []);

  return context;
}
