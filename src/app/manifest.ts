import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coolkies — Gestão de vendas",
    short_name: "Coolkies",
    description: "Gerencie pedidos, receitas e estoque de coolkies.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#FAF7F2",
    theme_color: "#8B5E3C",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
