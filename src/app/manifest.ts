import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cipri — Seu negócio no seu ritmo",
    short_name: "Cipri",
    description: "Organize vendas, estoque e produção do seu negócio no seu ritmo.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F7F7EF",
    theme_color: "#0F3D34",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
