import {
  Cake,
  Flame,
  Hammer,
  NotebookPen,
  Palette,
  Sandwich,
  Scissors,
  Shirt,
  ShoppingBasket,
  Store,
  type LucideIcon,
} from "lucide-react";

export type Model = "PRODUZ" | "REVENDE" | "SOB_ENCOMENDA" | "GENERICO";

export type Axis = { nome: string; opcoes: string[] };

export type SectorExamples = {
  boasVindas: string;
  produto: string;
  insumo: string | null;
  fornecedor: string;
  eixos: [Axis, Axis];
};

export const SECTOR_KEYS = [
  "confeitaria",
  "salgados",
  "cosmeticos",
  "roupas",
  "papelaria",
  "revenda",
  "artesanato",
  "marcenaria",
  "costura",
  "outro",
] as const;

export type SectorKey = (typeof SECTOR_KEYS)[number];

export type Sector = {
  key: SectorKey;
  label: string;
  icon: LucideIcon;
  model: Model;
  examples: SectorExamples;
};

export const SECTORS: Sector[] = [
  {
    key: "confeitaria",
    label: "Confeitaria, doces e bolos",
    icon: Cake,
    model: "PRODUZ",
    examples: {
      boasVindas: "Boas-vindas à sua confeitaria!",
      produto: "Bolo de pote",
      insumo: "Farinha de trigo",
      fornecedor: "Atacadão",
      eixos: [
        { nome: "Sabor", opcoes: ["Ninho", "Nutella", "Doce de leite"] },
        { nome: "Tamanho", opcoes: ["Mini", "Tradicional"] },
      ],
    },
  },
  {
    key: "salgados",
    label: "Salgados e marmitas",
    icon: Sandwich,
    model: "PRODUZ",
    examples: {
      boasVindas: "Boas-vindas à sua cozinha!",
      produto: "Coxinha",
      insumo: "Farinha de trigo",
      fornecedor: "Atacadão",
      eixos: [
        { nome: "Recheio", opcoes: ["Frango", "Carne", "Queijo"] },
        { nome: "Tamanho", opcoes: ["Mini", "Grande"] },
      ],
    },
  },
  {
    key: "cosmeticos",
    label: "Cosméticos e velas artesanais",
    icon: Flame,
    model: "PRODUZ",
    examples: {
      boasVindas: "Boas-vindas ao seu ateliê!",
      produto: "Vela aromática",
      insumo: "Cera de soja",
      fornecedor: "Loja de insumos",
      eixos: [
        { nome: "Aroma", opcoes: ["Lavanda", "Baunilha", "Canela"] },
        { nome: "Tamanho", opcoes: ["100 g", "200 g"] },
      ],
    },
  },
  {
    key: "roupas",
    label: "Roupas e acessórios",
    icon: Shirt,
    model: "REVENDE",
    examples: {
      boasVindas: "Boas-vindas à sua loja!",
      produto: "Camiseta",
      insumo: null,
      fornecedor: "Confecção Silva",
      eixos: [
        { nome: "Tamanho", opcoes: ["P", "M", "G"] },
        { nome: "Cor", opcoes: ["Azul", "Verde"] },
      ],
    },
  },
  {
    key: "papelaria",
    label: "Papelaria e presentes",
    icon: NotebookPen,
    model: "REVENDE",
    examples: {
      boasVindas: "Boas-vindas à sua papelaria!",
      produto: "Caderno",
      insumo: null,
      fornecedor: "Distribuidora Papel & Cia",
      eixos: [
        { nome: "Capa", opcoes: ["Floral", "Lisa"] },
        { nome: "Tamanho", opcoes: ["A5", "A4"] },
      ],
    },
  },
  {
    key: "revenda",
    label: "Revenda em geral",
    icon: ShoppingBasket,
    model: "REVENDE",
    examples: {
      boasVindas: "Boas-vindas ao seu negócio!",
      produto: "Garrafa térmica",
      insumo: null,
      fornecedor: "Distribuidora",
      eixos: [
        { nome: "Cor", opcoes: ["Preta", "Branca"] },
        { nome: "Tamanho", opcoes: ["500 ml", "1 L"] },
      ],
    },
  },
  {
    key: "artesanato",
    label: "Artesanato",
    icon: Palette,
    model: "SOB_ENCOMENDA",
    examples: {
      boasVindas: "Boas-vindas ao seu ateliê!",
      produto: "Bolsa de crochê",
      insumo: "Linha de algodão",
      fornecedor: "Armarinho",
      eixos: [
        { nome: "Cor", opcoes: ["Bege", "Rosa"] },
        { nome: "Tamanho", opcoes: ["P", "G"] },
      ],
    },
  },
  {
    key: "marcenaria",
    label: "Marcenaria",
    icon: Hammer,
    model: "SOB_ENCOMENDA",
    examples: {
      boasVindas: "Boas-vindas à sua marcenaria!",
      produto: "Mesa de centro",
      insumo: "Chapa de MDF",
      fornecedor: "Madeireira",
      eixos: [
        { nome: "Madeira", opcoes: ["Pinus", "Carvalho"] },
        { nome: "Tamanho", opcoes: ["60 cm", "90 cm"] },
      ],
    },
  },
  {
    key: "costura",
    label: "Costura sob encomenda",
    icon: Scissors,
    model: "SOB_ENCOMENDA",
    examples: {
      boasVindas: "Boas-vindas ao seu ateliê!",
      produto: "Vestido sob medida",
      insumo: "Tecido de algodão",
      fornecedor: "Loja de tecidos",
      eixos: [
        { nome: "Tecido", opcoes: ["Linho", "Algodão"] },
        { nome: "Tamanho", opcoes: ["P", "M", "G"] },
      ],
    },
  },
  {
    key: "outro",
    label: "Outro",
    icon: Store,
    model: "GENERICO",
    examples: {
      boasVindas: "Boas-vindas ao seu negócio!",
      produto: "Produto",
      insumo: null,
      fornecedor: "Fornecedor",
      eixos: [
        { nome: "Tamanho", opcoes: ["P", "M"] },
        { nome: "Cor", opcoes: ["Azul", "Verde"] },
      ],
    },
  },
];

export function isSectorKey(value: unknown): value is SectorKey {
  return typeof value === "string" && (SECTOR_KEYS as readonly string[]).includes(value);
}

export function getSector(key: SectorKey): Sector {
  const sector = SECTORS.find((s) => s.key === key);
  if (!sector) throw new Error(`Setor desconhecido: ${key}`);
  return sector;
}

export function modelOf(key: SectorKey): Model {
  return getSector(key).model;
}
