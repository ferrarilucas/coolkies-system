"use client";

import { useEffect, useState } from "react";
import { startupImages } from "@/lib/startup-images";

type DebugInfo = {
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  standalone: boolean;
  matched: string[];
};

export default function SplashDebugPage() {
  const [info, setInfo] = useState<DebugInfo | null>(null);

  useEffect(() => {
    const matched = startupImages
      .filter((img) => window.matchMedia(img.media).matches)
      .map((img) => img.url);
    setInfo({
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      devicePixelRatio: window.devicePixelRatio,
      standalone:
        "standalone" in window.navigator &&
        Boolean((window.navigator as { standalone?: boolean }).standalone),
      matched,
    });
  }, []);

  if (!info) return null;

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>Splash debug</h1>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
        {JSON.stringify(info, null, 2)}
      </pre>
      <p style={{ marginTop: 16, fontSize: 14 }}>
        {info.matched.length > 0
          ? "✅ Este aparelho tem splash correspondente"
          : "❌ Nenhuma splash corresponde a este aparelho"}
      </p>
    </main>
  );
}
