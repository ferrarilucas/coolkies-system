import type { Model } from "./sectors";

export type MissionId =
  | "compra-insumo"
  | "compra-fornecedor"
  | "ficha-tecnica"
  | "catalogo"
  | "producao"
  | "venda"
  | "venda-parcelada"
  | "cliente";

export const MISSION_IDS: MissionId[] = [
  "compra-insumo",
  "compra-fornecedor",
  "ficha-tecnica",
  "catalogo",
  "producao",
  "venda",
  "venda-parcelada",
  "cliente",
];

export type OnboardingProgress = Record<MissionId, boolean>;

export type Side = "top" | "bottom" | "left" | "right";

export type StepTarget = string | { mobile: string; desktop: string };

export type StepAdvance =
  | { on: "next" }
  | { on: "click"; final?: boolean }
  | { on: "until"; until: string }
  | { on: "await"; until: string };

export type TourStepDef = {
  id: string;
  target: StepTarget;
  title: string;
  content: string;
  side: Side | { mobile: Side; desktop: Side };
  advance: StepAdvance;
  viewport?: string;
  models?: Model[];
  optional?: boolean;
  skip?: { label: string; to: string };
  requiresMissions?: boolean;
};

export type MissionDef = {
  id: MissionId;
  title: string;
  description: string;
  startRoute: string;
  routes: string[];
  intro?: "variations-guide";
  steps: TourStepDef[];
};

export const PURCHASE_DIALOG_ID = "tour-purchase-dialog";
export const CUSTOMER_DIALOG_ID = "tour-customer-dialog";

function filled(target: string): string {
  return `[data-tour="${target}"][data-filled]`;
}

function purchaseSteps(kind: "insumo" | "fornecedor"): TourStepDef[] {
  const variant: TourStepDef[] =
    kind === "fornecedor"
      ? [
          {
            id: "variacao",
            target: "purchase-variant",
            viewport: PURCHASE_DIALOG_ID,
            optional: true,
            title: "Qual combinação chegou?",
            content: "Escolha a combinação que chegou. Cada uma tem estoque próprio.",
            side: "bottom",
            advance: { on: "await", until: filled("purchase-variant") },
          },
        ]
      : [];
  return [
    {
      id: "abrir",
      target: "purchase-new",
      title: "Registre a compra",
      content:
        kind === "insumo"
          ? "Voltou do mercado com {insumo}? Toque em Registrar compra."
          : "Chegou mercadoria de {fornecedor}? Toque em Registrar compra.",
      side: "bottom",
      advance: { on: "click" },
    },
    {
      id: "fornecedor",
      target: "purchase-supplier",
      viewport: PURCHASE_DIALOG_ID,
      title: "Fornecedor",
      content: "Escolha ou crie o fornecedor, por exemplo {fornecedor}. Se preferir, deixe em branco.",
      side: "bottom",
      advance: { on: "next" },
    },
    {
      id: "item",
      target: "purchase-item",
      viewport: PURCHASE_DIALOG_ID,
      title: kind === "insumo" ? "Crie o insumo aqui mesmo" : "Escolha o produto",
      content:
        kind === "insumo"
          ? "Toque no campo e digite {insumo}. Como ele ainda não existe, toque em Criar, deixe Matéria-prima ligada e confirme."
          : "Toque no campo e escolha {produto}, o produto que você montou no catálogo.",
      side: "bottom",
      advance: { on: "await", until: filled("purchase-item") },
    },
    ...variant,
    {
      id: "valores",
      target: "purchase-values",
      viewport: PURCHASE_DIALOG_ID,
      title: "Quantidade e valor",
      content: "Informe quanto comprou e quanto pagou. O valor pode ser o total ou o preço por unidade.",
      side: "top",
      advance: { on: "until", until: filled("purchase-values") },
    },
    {
      id: "salvar",
      target: "purchase-save",
      viewport: PURCHASE_DIALOG_ID,
      title: "Registre a compra",
      content: "Toque em Registrar compra. O estoque já recebe essa entrada.",
      side: "top",
      advance: { on: "click", final: true },
    },
  ];
}

function saleSteps(parcelada: boolean): TourStepDef[] {
  const payment: TourStepDef[] = parcelada
    ? [
        {
          id: "parcelas",
          target: "sale-payment",
          title: "Parcelado",
          content: "Toque em Parcelado e escolha em quantas vezes o cliente vai pagar.",
          side: "top",
          advance: { on: "until", until: '[data-tour="sale-payment"][data-installments]' },
        },
      ]
    : [];
  return [
    {
      id: "cliente",
      target: "sale-customer",
      title: "Cliente",
      content: "Escolha quem comprou. É opcional, mas ajuda a saber quem deve.",
      side: "bottom",
      advance: { on: "next" },
    },
    {
      id: "produto",
      target: "sale-line",
      title: "O que foi vendido",
      content: "Escolha {produto} e, se tiver, a combinação. O preço vem do catálogo.",
      side: "bottom",
      advance: { on: "await", until: filled("sale-line") },
    },
    ...payment,
    {
      id: "salvar",
      target: "sale-save",
      title: "Registre a venda",
      content: "Toque em Registrar venda.",
      side: "top",
      advance: { on: "click", final: true },
    },
  ];
}

export const MISSIONS: Record<MissionId, MissionDef> = {
  "compra-insumo": {
    id: "compra-insumo",
    title: "Registre a compra do seu primeiro insumo",
    description: "Cadastre {insumo} direto na compra e já dê entrada no estoque.",
    startRoute: "/purchases",
    routes: ["/purchases"],
    steps: purchaseSteps("insumo"),
  },
  "compra-fornecedor": {
    id: "compra-fornecedor",
    title: "Registre uma compra do fornecedor",
    description: "Dá entrada no estoque de cada combinação do produto.",
    startRoute: "/purchases",
    routes: ["/purchases"],
    steps: purchaseSteps("fornecedor"),
  },
  "ficha-tecnica": {
    id: "ficha-tecnica",
    title: "Monte a ficha técnica",
    description: "Diz quanto de cada insumo vai em {produto}.",
    startRoute: "/admin/recipes/new",
    routes: ["/admin/recipes"],
    steps: [
      {
        id: "nome",
        target: "recipe-name",
        title: "Nome da ficha",
        content: "Dê um nome, por exemplo {produto}.",
        side: "bottom",
        advance: { on: "until", until: filled("recipe-name") },
      },
      {
        id: "rendimento",
        target: "recipe-yield",
        title: "Rendimento",
        content: "Quantas unidades essa receita rende de uma vez.",
        side: "bottom",
        advance: { on: "next" },
      },
      {
        id: "insumo",
        target: "recipe-line",
        title: "Insumos",
        content: "Escolha {insumo} e informe quanto vai na receita.",
        side: "bottom",
        advance: { on: "await", until: filled("recipe-line") },
      },
      {
        id: "salvar",
        target: "recipe-save",
        title: "Crie a ficha",
        content: "Toque em Criar ficha técnica. Depois você liga ela ao produto no catálogo.",
        side: "top",
        advance: { on: "click", final: true },
      },
    ],
  },
  catalogo: {
    id: "catalogo",
    title: "Monte seu produto no catálogo",
    description: "Preço e variações, como {eixo} e {eixo2}.",
    startRoute: "/admin/catalog/new",
    routes: ["/admin/catalog"],
    intro: "variations-guide",
    steps: [
      {
        id: "nome",
        target: "product-name",
        title: "Nome do produto",
        content: "Digite o nome, por exemplo {produto}.",
        side: "bottom",
        advance: { on: "until", until: filled("product-name") },
      },
      {
        id: "preco",
        target: "product-price",
        title: "Preço padrão",
        content:
          "É o preço de venda. Se o produto tiver variações, ele vale para todas as combinações que não tiverem preço próprio.",
        side: "bottom",
        advance: { on: "next" },
      },
      {
        id: "adicionar-variacao",
        target: "add-variation",
        title: "Variações",
        content: "Se {produto} sai em versões diferentes, como {eixo} e {eixo2}, toque em Adicionar variação.",
        side: "top",
        advance: { on: "click" },
        skip: { label: "Meu produto não tem variações", to: "salvar" },
      },
      {
        id: "tipo",
        target: "option-name",
        title: "Tipo de variação",
        content: "O tipo é o que muda de uma versão para outra. Digite {eixo}.",
        side: "bottom",
        advance: { on: "until", until: filled("option-name") },
      },
      {
        id: "opcoes",
        target: "option-values",
        title: "Opções",
        content: "As opções são os valores do tipo: {opcoes}. Digite cada uma e aperte Enter ou vírgula.",
        side: "bottom",
        advance: {
          on: "until",
          until: '[data-tour="option-values"][data-count]:not([data-count="0"]):not([data-count="1"])',
        },
      },
      {
        id: "combinacoes",
        target: "combinations",
        title: "Marque o que você vende",
        content:
          "O app cruza as opções e monta as combinações. Cada uma é uma versão com estoque próprio. Marque as que você vende.",
        side: "top",
        advance: { on: "until", until: '[data-tour="combinations"][data-checked]' },
      },
      {
        id: "preco-combinacao",
        target: "combination-details",
        title: "Preço da combinação",
        content: "Só preencha se esta versão custa diferente do preço padrão. Deixe R$ 0,00 para usar o padrão.",
        side: "top",
        advance: { on: "next" },
      },
      {
        id: "ficha-combinacao",
        target: "combination-details",
        models: ["PRODUZ"],
        title: "Ficha técnica da combinação",
        content: "Escolha a ficha técnica desta versão. Assim a produção baixa os insumos certos do estoque.",
        side: "top",
        advance: { on: "next" },
      },
      {
        id: "salvar",
        target: "product-save",
        title: "Salve o produto",
        content: "Toque em Salvar produto. Ele já aparece na hora de vender.",
        side: "top",
        advance: { on: "click", final: true },
      },
    ],
  },
  producao: {
    id: "producao",
    title: "Registre uma produção",
    description: "Soma o produto ao estoque e baixa os insumos usados.",
    startRoute: "/production/new",
    routes: ["/production"],
    steps: [
      {
        id: "item",
        target: "production-item",
        title: "O que você produziu?",
        content: "Escolha o produto, por exemplo {produto}.",
        side: "bottom",
        advance: { on: "await", until: filled("production-item") },
      },
      {
        id: "ficha",
        target: "production-recipe",
        title: "Ficha técnica",
        content: "Com a ficha escolhida, o app baixa do estoque os insumos usados.",
        side: "bottom",
        advance: { on: "next" },
      },
      {
        id: "quantidade",
        target: "production-qty",
        title: "Quantidade",
        content: "Quantas unidades ficaram prontas.",
        side: "bottom",
        advance: { on: "until", until: filled("production-qty") },
      },
      {
        id: "salvar",
        target: "production-save",
        title: "Registre",
        content: "Toque em Registrar produção. O produto entra no estoque.",
        side: "top",
        advance: { on: "click", final: true },
      },
    ],
  },
  venda: {
    id: "venda",
    title: "Lance sua primeira venda",
    description: "Registra o que saiu, para quem e quanto entrou.",
    startRoute: "/sales/new",
    routes: ["/sales"],
    steps: saleSteps(false),
  },
  "venda-parcelada": {
    id: "venda-parcelada",
    title: "Lance uma venda parcelada",
    description: "Divide o valor em parcelas com vencimento.",
    startRoute: "/sales/new",
    routes: ["/sales"],
    steps: saleSteps(true),
  },
  cliente: {
    id: "cliente",
    title: "Cadastre um cliente",
    description: "Para acompanhar quem compra e quem deve.",
    startRoute: "/customers",
    routes: ["/customers"],
    steps: [
      {
        id: "novo",
        target: "customer-new",
        title: "Novo cliente",
        content: "Toque em Novo cliente.",
        side: "bottom",
        advance: { on: "click" },
      },
      {
        id: "nome",
        target: "customer-name",
        viewport: CUSTOMER_DIALOG_ID,
        title: "Nome",
        content: "Digite o nome do cliente. Telefone e e-mail são opcionais.",
        side: "bottom",
        advance: { on: "next" },
      },
      {
        id: "salvar",
        target: "customer-save",
        viewport: CUSTOMER_DIALOG_ID,
        title: "Crie o cliente",
        content: "Toque em Criar cliente.",
        side: "top",
        advance: { on: "click", final: true },
      },
    ],
  },
};

export const MISSION_ORDER: Record<Model, MissionId[]> = {
  PRODUZ: ["compra-insumo", "ficha-tecnica", "catalogo", "producao", "venda", "cliente"],
  REVENDE: ["catalogo", "compra-fornecedor", "venda", "cliente"],
  SOB_ENCOMENDA: ["compra-insumo", "catalogo", "cliente", "venda-parcelada"],
  GENERICO: ["catalogo", "venda", "cliente"],
};

export function isRouteOfMission(pathname: string, mission: MissionDef): boolean {
  return mission.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
