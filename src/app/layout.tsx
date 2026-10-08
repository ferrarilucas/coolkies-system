import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import { Providers } from "@/components/providers";
import { startupImages } from "@/lib/startup-images";
import "./globals.css";

const sora = Sora({ subsets: ["latin", "latin-ext"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Cipri — Seu negócio no seu ritmo",
  description: "Organize vendas, estoque e produção do seu negócio no seu ritmo.",
  appleWebApp: {
    capable: true,
    title: "Cipri",
    statusBarStyle: "default",
    startupImage: startupImages,
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0F3D34",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${sora.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
