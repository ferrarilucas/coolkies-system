import type { TourStepDef } from "./missions";

export const APP_TOUR: TourStepDef[] = [
  {
    id: "painel",
    target: "dashboard-header",
    title: "{boasVindas}",
    content: "Este é o Painel. Aqui você acompanha vendas, recebimentos e o que está acabando no estoque.",
    side: "bottom",
    advance: { on: "next" },
  },
  {
    id: "vender",
    target: { mobile: "nav-sell", desktop: "dashboard-new-sale" },
    title: "Vender é aqui",
    content: "Toda venda começa neste botão.",
    side: { mobile: "top", desktop: "bottom" },
    advance: { on: "next" },
  },
  {
    id: "vendas",
    target: { mobile: "nav-sales", desktop: "side-sales" },
    title: "Vendas",
    content: "A lista de vendas, com o que já foi pago e o que ainda vai entrar.",
    side: { mobile: "top", desktop: "right" },
    advance: { on: "next" },
  },
  {
    id: "clientes",
    target: { mobile: "nav-customers", desktop: "side-customers" },
    title: "Clientes",
    content: "Seus clientes, o que cada um comprou e quanto ainda deve.",
    side: { mobile: "top", desktop: "right" },
    advance: { on: "next" },
  },
  {
    id: "menu",
    target: { mobile: "nav-more", desktop: "side-stock" },
    title: "Catálogo, estoque e compras",
    content: "Catálogo, Estoque, Compras e Produção ficam neste menu.",
    side: { mobile: "top", desktop: "right" },
    advance: { on: "next" },
  },
  {
    id: "primeiros-passos",
    target: "onboarding-card",
    requiresMissions: true,
    title: "Seus primeiros passos",
    content: "Separamos algumas missões para deixar tudo pronto. Cada uma mostra onde tocar. Comece quando quiser.",
    side: "bottom",
    advance: { on: "next" },
  },
];
