# Onboarding guiado por setor — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao criar um workspace o usuário escolhe o setor, faz um tour de apresentação com holofote e ganha missões de primeiros passos por modelo de operação, cada uma com cliques guiados e animados sobre as telas reais.

**Architecture:** Roteiros declarativos em TypeScript (`src/lib/onboarding/*`), funções puras para montar passos e decidir visibilidade, estado no banco só para setor, "dispensado" e "tour feito", progresso calculado por uma única query de `EXISTS`. No cliente, um `OnboardingProvider` no `AppShell` guarda o estado e carrega sob demanda um `TourRunner` que usa o nextstepjs para o holofote nas páginas e um cartão de dica próprio dentro de diálogos e em campos `Select`/`Popover`.

**Tech Stack:** Next.js 15 (App Router), React 19, Prisma 6 + Postgres, Tailwind, Radix, vitest, nextstepjs 2.3.0, motion 13.4.6.

**Spec:** `docs/superpowers/specs/2026-10-15-onboarding-guiado-design.md`

## Global Constraints

- Nunca escrever comentários no código (regra do usuário em `~/.claude/CLAUDE.md`), em nenhum arquivo `.ts`, `.tsx`, `.css` ou `.sql` criado ou editado.
- Usar `pnpm` para tudo (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec next lint`, `pnpm add`). Nunca `npm install` nem `yarn`; não tocar no `yarn.lock`.
- Migrations são escritas à mão e aplicadas com `docker exec -i cookies_db psql -U cookies -d cookies` e `-d cookies_test`, seguidas de `pnpm exec prisma generate`. Nunca `prisma migrate dev/deploy` nem `prisma db push`.
- Prisma cru (`@/lib/db`) só dentro de `src/server/tenant/**`; o resto usa funções de lá (regra `no-restricted-imports`).
- O banco roda com `connection_limit=1`: consultas do layout e do progresso são sequenciais ou numa query só, nunca em `Promise.all`.
- Versões fixas: `nextstepjs@2.3.0` e `motion@13.4.6`.
- Textos de interface em português do Brasil, com acentuação completa; boas-vindas neutras ("Boas-vindas…"), sem "Bem-vinda".
- Setores e modelos exatamente como na tabela da spec; missões por modelo na ordem da spec; regras de conclusão da spec (venda parcelada = `Sale.installmentCount > 1`).
- Missões aparecem só para OWNER/ADMIN com `canWrite`; o tour de apresentação aparece para todo usuário que ainda não o fez.
- Animações respeitam `prefers-reduced-motion` (bloco existente em `src/app/globals.css`).
- Antes do commit final: `pnpm test`, `pnpm exec tsc --noEmit` e `pnpm exec next lint` no projeto inteiro.

## Review Focus

1. Venda à vista gera uma `SaleInstallment` (parcela 1); isso não pode concluir a missão "venda parcelada". Teste na Tarefa 3.
2. Dados de outro workspace nunca contam para o progresso. Teste na Tarefa 3.
3. Workspace antigo, cheio de dados e sem setor: ao escolher o setor, as missões já feitas aparecem concluídas e não disparam comemoração. Teste de dados na Tarefa 3; a ausência de comemoração vem de `newlyCompleted(null, …)` vazio, testada na Tarefa 2.
4. Dono de workspace em modo leitura (plano bloqueado) não vê missões, só o tour. Teste na Tarefa 2 (`canSeeMissions`) e na Tarefa 3 (`getOnboardingState`).
5. Setor adulterado no formulário ou gravado errado no banco é recusado ou ignorado, sem quebrar o Painel. Testes nas Tarefas 3 e 4.

---

## Mapa de arquivos

Criar:

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/onboarding/sectors.ts` | Setores, modelos, exemplos, `isSectorKey`, `getSector`, `modelOf` |
| `src/lib/onboarding/text.ts` | `fillText`, `joinOptions` |
| `src/lib/onboarding/missions.ts` | Tipos de passo e missão, `MISSIONS`, `MISSION_ORDER`, `isRouteOfMission` |
| `src/lib/onboarding/app-tour.ts` | `APP_TOUR` |
| `src/lib/onboarding/build-tour.ts` | `buildSteps`, `selectorFor`, `resolve`, `stepIndexById`, `usesSpotlight` |
| `src/lib/onboarding/visibility.ts` | `OnboardingState` e regras de visibilidade/progresso |
| `src/lib/onboarding/wait-for.ts` | `waitFor` (polling com timeout e abort) |
| `src/lib/onboarding/guide-example.ts` | Exemplo do guia de variações e combinações derivadas |
| `src/server/tenant/onboarding.ts` | Estado, progresso (query única) e gravações |
| `src/server/actions/onboarding.ts` | Server actions do onboarding |
| `src/components/onboarding/sector-picker.tsx` | Grade de setores |
| `src/components/onboarding/onboarding-context.tsx` | Contexto, tipos e hooks |
| `src/components/onboarding/onboarding-provider.tsx` | Estado no cliente, sincronização e camadas (runner, bolha, comemoração) |
| `src/components/onboarding/onboarding-settings.tsx` | Linhas em Ajustes |
| `src/components/onboarding/runner-context.ts` | Contexto do runner |
| `src/components/onboarding/find-target.ts` | Acha o alvo visível |
| `src/components/onboarding/tour-runner.tsx` | Controlador do tour (nextstepjs + dicas) |
| `src/components/onboarding/tour-card-body.tsx` | Conteúdo comum do balão e da dica |
| `src/components/onboarding/tour-card.tsx` | `cardComponent` do nextstepjs |
| `src/components/onboarding/inline-hint.tsx` | Cartão de dica (diálogos e `await`) |
| `src/components/onboarding/onboarding-card.tsx` | Card do Painel |
| `src/components/onboarding/sector-prompt-card.tsx` | Convite para workspaces sem setor |
| `src/components/onboarding/missions-list.tsx` | Lista de missões |
| `src/components/onboarding/missions-dialog.tsx` | Gaveta com a lista |
| `src/components/onboarding/dismiss-dialog.tsx` | Confirmação do "×" |
| `src/components/onboarding/onboarding-bubble.tsx` | Bolha de progresso |
| `src/components/onboarding/celebration.tsx` | Comemoração |
| `prisma/migrations/20261015120000_onboarding/migration.sql` | Colunas novas |

Modificar: `prisma/schema.prisma`, `src/server/tenant/workspaces.ts`, `src/server/tenant/workspaces.test.ts`, `src/server/actions/workspaces.ts`, `src/components/workspaces/workspace-forms.tsx`, `src/app/(app)/layout.tsx`, `src/components/layout/app-shell.tsx`, `src/components/layout/bottom-nav.tsx`, `src/components/layout/side-nav.tsx`, `src/components/shared/page-header.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/more/page.tsx`, `src/app/globals.css`, `src/components/catalog/variations-guide.tsx`, `src/components/catalog/product-editor.tsx`, `src/components/catalog/options-editor.tsx`, `src/components/catalog/combinations-list.tsx`, `src/components/purchases/purchase-dialog.tsx`, `src/components/recipes/recipe-form.tsx`, `src/components/production/production-form.tsx`, `src/components/sales/sale-form.tsx`, `src/components/customers/customer-create-dialog.tsx`, `package.json`, `pnpm-lock.yaml`.

---

### Task 1: Setores e preenchimento de textos

**Files:**
- Create: `src/lib/onboarding/sectors.ts`
- Create: `src/lib/onboarding/text.ts`
- Test: `src/lib/onboarding/sectors.test.ts`
- Test: `src/lib/onboarding/text.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type Model = "PRODUZ" | "REVENDE" | "SOB_ENCOMENDA" | "GENERICO"`
  - `type Axis = { nome: string; opcoes: string[] }`
  - `type SectorExamples = { boasVindas: string; produto: string; insumo: string | null; fornecedor: string; eixos: [Axis, Axis] }`
  - `const SECTOR_KEYS`, `type SectorKey`, `type Sector = { key; label; icon: LucideIcon; model; examples }`, `const SECTORS: Sector[]`
  - `isSectorKey(value: unknown): value is SectorKey`, `getSector(key: SectorKey): Sector`, `modelOf(key: SectorKey): Model`
  - `fillText(text: string, examples: SectorExamples): string`, `joinOptions(options: string[]): string`
  - Marcadores aceitos por `fillText`: `{boasVindas}`, `{produto}`, `{insumo}`, `{fornecedor}`, `{eixo}`, `{opcoes}`, `{eixo2}`, `{opcoes2}`.

- [ ] **Step 1: Escrever os testes que falham**

`src/lib/onboarding/sectors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SECTORS, SECTOR_KEYS, getSector, isSectorKey, modelOf } from "./sectors";

describe("setores", () => {
  it("tem exatamente as chaves da lista, sem repetição", () => {
    expect(SECTORS.map((s) => s.key)).toEqual([...SECTOR_KEYS]);
  });

  it("mapeia cada setor para o modelo de operação da spec", () => {
    expect(Object.fromEntries(SECTORS.map((s) => [s.key, s.model]))).toEqual({
      confeitaria: "PRODUZ",
      salgados: "PRODUZ",
      cosmeticos: "PRODUZ",
      roupas: "REVENDE",
      papelaria: "REVENDE",
      revenda: "REVENDE",
      artesanato: "SOB_ENCOMENDA",
      marcenaria: "SOB_ENCOMENDA",
      costura: "SOB_ENCOMENDA",
      outro: "GENERICO",
    });
  });

  it("dá dois eixos com pelo menos duas opções a todo setor", () => {
    for (const sector of SECTORS) {
      expect(sector.examples.eixos).toHaveLength(2);
      for (const eixo of sector.examples.eixos) {
        expect(eixo.opcoes.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("dá exemplo de insumo a quem produz", () => {
    for (const sector of SECTORS.filter((s) => s.model === "PRODUZ" || s.model === "SOB_ENCOMENDA")) {
      expect(sector.examples.insumo).toBeTruthy();
    }
  });

  it("usa os exemplos combinados para confeitaria e roupas", () => {
    expect(getSector("confeitaria").examples).toMatchObject({
      produto: "Bolo de pote",
      insumo: "Farinha de trigo",
      eixos: [
        { nome: "Sabor", opcoes: ["Ninho", "Nutella", "Doce de leite"] },
        { nome: "Tamanho", opcoes: ["Mini", "Tradicional"] },
      ],
    });
    expect(getSector("roupas").examples).toMatchObject({
      produto: "Camiseta",
      insumo: null,
      eixos: [
        { nome: "Tamanho", opcoes: ["P", "M", "G"] },
        { nome: "Cor", opcoes: ["Azul", "Verde"] },
      ],
    });
  });

  it("aceita só chaves conhecidas", () => {
    expect(isSectorKey("confeitaria")).toBe(true);
    expect(isSectorKey("padaria")).toBe(false);
    expect(isSectorKey("")).toBe(false);
    expect(isSectorKey(null)).toBe(false);
    expect(isSectorKey(42)).toBe(false);
  });

  it("devolve o modelo pela chave", () => {
    expect(modelOf("marcenaria")).toBe("SOB_ENCOMENDA");
  });
});
```

`src/lib/onboarding/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSector } from "./sectors";
import { fillText, joinOptions } from "./text";

describe("joinOptions", () => {
  it("junta com vírgula e 'e' no fim", () => {
    expect(joinOptions(["P", "M", "G"])).toBe("P, M e G");
    expect(joinOptions(["Mini", "Tradicional"])).toBe("Mini e Tradicional");
    expect(joinOptions(["Único"])).toBe("Único");
    expect(joinOptions([])).toBe("");
  });
});

describe("fillText", () => {
  const confeitaria = getSector("confeitaria").examples;
  const roupas = getSector("roupas").examples;

  it("troca os marcadores pelos exemplos do setor", () => {
    expect(fillText("Digite {produto}. Tipo: {eixo} ({opcoes}) e {eixo2} ({opcoes2}).", confeitaria)).toBe(
      "Digite Bolo de pote. Tipo: Sabor (Ninho, Nutella e Doce de leite) e Tamanho (Mini e Tradicional).",
    );
  });

  it("usa um texto neutro quando o setor não tem insumo", () => {
    expect(fillText("Compre {insumo}", roupas)).toBe("Compre o insumo");
  });

  it("mantém marcadores desconhecidos", () => {
    expect(fillText("Olá {ninguem}", roupas)).toBe("Olá {ninguem}");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run src/lib/onboarding`
Expected: FAIL com "Failed to resolve import "./sectors"".

- [ ] **Step 3: Implementar**

`src/lib/onboarding/sectors.ts`:

```ts
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
```

`src/lib/onboarding/text.ts`:

```ts
import type { SectorExamples } from "./sectors";

export function joinOptions(options: string[]): string {
  if (options.length <= 1) return options.join("");
  return `${options.slice(0, -1).join(", ")} e ${options[options.length - 1]}`;
}

export function fillText(text: string, examples: SectorExamples): string {
  const [eixo, eixo2] = examples.eixos;
  const values: Record<string, string> = {
    boasVindas: examples.boasVindas,
    produto: examples.produto,
    insumo: examples.insumo ?? "o insumo",
    fornecedor: examples.fornecedor,
    eixo: eixo.nome,
    opcoes: joinOptions(eixo.opcoes),
    eixo2: eixo2.nome,
    opcoes2: joinOptions(eixo2.opcoes),
  };
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run src/lib/onboarding`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/sectors.ts src/lib/onboarding/sectors.test.ts src/lib/onboarding/text.ts src/lib/onboarding/text.test.ts
git commit -m "feat(onboarding): setores, modelos de operação e textos com exemplos do setor"
```

---

### Task 2: Missões, tour do app, montagem dos passos e visibilidade

**Files:**
- Create: `src/lib/onboarding/missions.ts`
- Create: `src/lib/onboarding/app-tour.ts`
- Create: `src/lib/onboarding/build-tour.ts`
- Create: `src/lib/onboarding/visibility.ts`
- Test: `src/lib/onboarding/missions.test.ts`
- Test: `src/lib/onboarding/build-tour.test.ts`
- Test: `src/lib/onboarding/visibility.test.ts`

**Interfaces:**
- Consumes (Task 1): `Model`, `SectorKey`, `SectorExamples`, `getSector`, `modelOf`, `fillText`.
- Produces:
  - `type MissionId = "compra-insumo" | "compra-fornecedor" | "ficha-tecnica" | "catalogo" | "producao" | "venda" | "venda-parcelada" | "cliente"`, `MISSION_IDS: MissionId[]`
  - `type OnboardingProgress = Record<MissionId, boolean>`
  - `type Side = "top" | "bottom" | "left" | "right"`
  - `type StepTarget = string | { mobile: string; desktop: string }`
  - `type StepAdvance = { on: "next" } | { on: "click"; final?: boolean } | { on: "until"; until: string } | { on: "await"; until: string }`
  - `type TourStepDef = { id; target: StepTarget; title; content; side: Side | { mobile: Side; desktop: Side }; advance: StepAdvance; viewport?: string; models?: Model[]; optional?: boolean; skip?: { label: string; to: string }; requiresMissions?: boolean }`
  - `type MissionDef = { id: MissionId; title; description; startRoute; routes: string[]; intro?: "variations-guide"; steps: TourStepDef[] }`
  - `MISSIONS: Record<MissionId, MissionDef>`, `MISSION_ORDER: Record<Model, MissionId[]>`, `isRouteOfMission(pathname, mission): boolean`
  - `PURCHASE_DIALOG_ID = "tour-purchase-dialog"`, `CUSTOMER_DIALOG_ID = "tour-customer-dialog"`
  - `APP_TOUR: TourStepDef[]`
  - `type Viewport = "mobile" | "desktop"`, `type BuiltStep = { def: TourStepDef; selector: string; side: Side; title: string; content: string }`
  - `buildSteps(defs, { model, viewport, examples, missionsVisible }): BuiltStep[]`, `selectorFor(target, viewport)`, `resolve(value, viewport)`, `stepIndexById(steps, id)`, `usesSpotlight(step)`
  - `type OnboardingState = { workspaceId: string; sector: SectorKey | null; dismissed: boolean; appTourDone: boolean; eligible: boolean; progress: OnboardingProgress | null }`
  - `canSeeMissions(role, canWrite)`, `missionsOf(state)`, `pendingMissions(state)`, `nextMission(state)`, `missionCounts(state)`, `canPreviewMissions(state)`, `shouldShowMissions(state, appTourRunning)`, `shouldShowSectorPrompt(state)`, `shouldShowAppTour(state)`, `newlyCompleted(before, after)`, `allMissionsDone(state)`

**Alvos (`data-tour`) que esta tarefa referencia e que as Tarefas 7, 9 e 10 criam:** `dashboard-header`, `dashboard-new-sale`, `nav-sell`, `nav-sales`, `nav-customers`, `nav-more`, `side-sales`, `side-customers`, `side-stock`, `onboarding-card`, `product-name`, `product-price`, `add-variation`, `option-name`, `option-values`, `combinations`, `combination-details`, `product-save`, `purchase-new`, `purchase-supplier`, `purchase-item`, `purchase-variant`, `purchase-values`, `purchase-save`, `recipe-name`, `recipe-yield`, `recipe-line`, `recipe-save`, `production-item`, `production-recipe`, `production-qty`, `production-save`, `sale-customer`, `sale-line`, `sale-payment`, `sale-save`, `customer-new`, `customer-name`, `customer-save`.

**Atributos de estado usados pelos seletores `until`:** `data-filled` (presente quando o campo tem valor), `data-count` (quantidade de opções preenchidas do primeiro tipo de variação), `data-checked` (lista de combinações com ao menos uma marcada), `data-installments` (pagamento parcelado escolhido).

- [ ] **Step 1: Escrever os testes que falham**

`src/lib/onboarding/missions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MISSIONS, MISSION_IDS, MISSION_ORDER, isRouteOfMission } from "./missions";

describe("missões", () => {
  it("segue a ordem da spec para cada modelo", () => {
    expect(MISSION_ORDER).toEqual({
      PRODUZ: ["compra-insumo", "ficha-tecnica", "catalogo", "producao", "venda", "cliente"],
      REVENDE: ["catalogo", "compra-fornecedor", "venda", "cliente"],
      SOB_ENCOMENDA: ["compra-insumo", "catalogo", "cliente", "venda-parcelada"],
      GENERICO: ["catalogo", "venda", "cliente"],
    });
  });

  it("define todas as missões com id coerente", () => {
    for (const id of MISSION_IDS) expect(MISSIONS[id].id).toBe(id);
  });

  it("tem passos com ids únicos, saltos válidos e um passo final de clique", () => {
    for (const mission of Object.values(MISSIONS)) {
      const ids = mission.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of mission.steps) {
        if (step.skip) expect(ids).toContain(step.skip.to);
      }
      const last = mission.steps[mission.steps.length - 1];
      expect(last.advance).toEqual({ on: "click", final: true });
    }
  });

  it("começa cada missão numa rota da própria missão", () => {
    for (const mission of Object.values(MISSIONS)) {
      expect(isRouteOfMission(mission.startRoute, mission)).toBe(true);
    }
  });

  it("reconhece subrotas e rejeita prefixos parecidos", () => {
    expect(isRouteOfMission("/sales/new", MISSIONS.venda)).toBe(true);
    expect(isRouteOfMission("/sales", MISSIONS.venda)).toBe(true);
    expect(isRouteOfMission("/salesx", MISSIONS.venda)).toBe(false);
    expect(isRouteOfMission("/dashboard", MISSIONS.venda)).toBe(false);
  });

  it("abre o guia de variações só na missão do catálogo", () => {
    const withIntro = Object.values(MISSIONS).filter((m) => m.intro).map((m) => m.id);
    expect(withIntro).toEqual(["catalogo"]);
  });
});
```

`src/lib/onboarding/build-tour.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APP_TOUR } from "./app-tour";
import { buildSteps, selectorFor, stepIndexById, usesSpotlight } from "./build-tour";
import { MISSIONS } from "./missions";
import { getSector } from "./sectors";

const confeitaria = getSector("confeitaria").examples;
const roupas = getSector("roupas").examples;

describe("buildSteps", () => {
  it("inclui a ficha técnica da combinação só para quem produz", () => {
    const produz = buildSteps(MISSIONS.catalogo.steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    const revende = buildSteps(MISSIONS.catalogo.steps, { model: "REVENDE", viewport: "mobile", examples: roupas, missionsVisible: true });
    expect(produz.map((s) => s.def.id)).toContain("ficha-combinacao");
    expect(revende.map((s) => s.def.id)).not.toContain("ficha-combinacao");
  });

  it("resolve o alvo e o lado pelo tamanho de tela", () => {
    const mobile = buildSteps(APP_TOUR, { model: null, viewport: "mobile", examples: roupas, missionsVisible: false });
    const desktop = buildSteps(APP_TOUR, { model: null, viewport: "desktop", examples: roupas, missionsVisible: false });
    const vender = (steps: typeof mobile) => steps.find((s) => s.def.id === "vender")!;
    expect(vender(mobile).selector).toBe('[data-tour="nav-sell"]');
    expect(vender(desktop).selector).toBe('[data-tour="dashboard-new-sale"]');
    expect(mobile.find((s) => s.def.id === "vendas")!.side).toBe("top");
    expect(desktop.find((s) => s.def.id === "vendas")!.side).toBe("right");
  });

  it("tira a parada do card de missões quando elas não estão visíveis", () => {
    const sem = buildSteps(APP_TOUR, { model: null, viewport: "mobile", examples: roupas, missionsVisible: false });
    const com = buildSteps(APP_TOUR, { model: "REVENDE", viewport: "mobile", examples: roupas, missionsVisible: true });
    expect(sem.map((s) => s.def.id)).not.toContain("primeiros-passos");
    expect(com.map((s) => s.def.id)).toContain("primeiros-passos");
  });

  it("preenche os textos com os exemplos do setor", () => {
    const steps = buildSteps(MISSIONS.catalogo.steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(steps[0].content).toBe("Digite o nome, por exemplo Bolo de pote.");
    const tour = buildSteps(APP_TOUR, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(tour[0].title).toBe("Boas-vindas à sua confeitaria!");
  });

  it("usa holofote só fora de diálogos e de passos de espera", () => {
    const compra = buildSteps(MISSIONS["compra-insumo"].steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(usesSpotlight(compra[0])).toBe(true);
    expect(compra.slice(1).every((s) => !usesSpotlight(s))).toBe(true);
    const producao = buildSteps(MISSIONS.producao.steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(usesSpotlight(producao[0])).toBe(false);
  });

  it("acha o índice de um passo pelo id", () => {
    const steps = buildSteps(MISSIONS.catalogo.steps, { model: "REVENDE", viewport: "mobile", examples: roupas, missionsVisible: true });
    expect(steps[stepIndexById(steps, "salvar")].def.id).toBe("salvar");
    expect(stepIndexById(steps, "nao-existe")).toBe(-1);
  });
});

describe("selectorFor", () => {
  it("monta o seletor de atributo", () => {
    expect(selectorFor("product-name", "mobile")).toBe('[data-tour="product-name"]');
    expect(selectorFor({ mobile: "a", desktop: "b" }, "desktop")).toBe('[data-tour="b"]');
  });
});
```

`src/lib/onboarding/visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MISSION_IDS, type OnboardingProgress } from "./missions";
import {
  allMissionsDone,
  canPreviewMissions,
  canSeeMissions,
  missionCounts,
  newlyCompleted,
  nextMission,
  shouldShowAppTour,
  shouldShowMissions,
  shouldShowSectorPrompt,
  type OnboardingState,
} from "./visibility";

function progress(done: string[] = []): OnboardingProgress {
  return Object.fromEntries(MISSION_IDS.map((id) => [id, done.includes(id)])) as OnboardingProgress;
}

function state(patch: Partial<OnboardingState> = {}): OnboardingState {
  return {
    workspaceId: "w1",
    sector: "roupas",
    dismissed: false,
    appTourDone: true,
    eligible: true,
    progress: progress(),
    ...patch,
  };
}

describe("canSeeMissions", () => {
  it("libera dono e admin com escrita", () => {
    expect(canSeeMissions("OWNER", true)).toBe(true);
    expect(canSeeMissions("ADMIN", true)).toBe(true);
  });

  it("bloqueia membro e workspace em modo leitura", () => {
    expect(canSeeMissions("MEMBER", true)).toBe(false);
    expect(canSeeMissions("OWNER", false)).toBe(false);
  });
});

describe("shouldShowMissions", () => {
  it("só mostra depois do tour, ou durante ele", () => {
    expect(shouldShowMissions(state({ appTourDone: false }), false)).toBe(false);
    expect(shouldShowMissions(state({ appTourDone: false }), true)).toBe(true);
    expect(shouldShowMissions(state(), false)).toBe(true);
  });

  it("esconde quando dispensado, sem setor, sem progresso ou tudo feito", () => {
    expect(shouldShowMissions(state({ dismissed: true }), false)).toBe(false);
    expect(shouldShowMissions(state({ sector: null }), false)).toBe(false);
    expect(shouldShowMissions(state({ progress: null }), false)).toBe(false);
    expect(shouldShowMissions(state({ progress: progress(["catalogo", "compra-fornecedor", "venda", "cliente"]) }), false)).toBe(false);
  });

  it("deixa pré-visualizar mesmo antes do tour", () => {
    expect(canPreviewMissions(state({ appTourDone: false }))).toBe(true);
  });
});

describe("nextMission e missionCounts", () => {
  it("pega a primeira pendente na ordem do modelo", () => {
    expect(nextMission(state())?.id).toBe("catalogo");
    expect(nextMission(state({ progress: progress(["catalogo"]) }))?.id).toBe("compra-fornecedor");
    expect(nextMission(state({ progress: progress(["catalogo", "venda"]) }))?.id).toBe("compra-fornecedor");
  });

  it("conta só as missões do modelo", () => {
    expect(missionCounts(state({ progress: progress(["catalogo", "compra-insumo"]) }))).toEqual({ done: 1, total: 4 });
    expect(missionCounts(state({ progress: null }))).toEqual({ done: 0, total: 4 });
  });
});

describe("shouldShowSectorPrompt", () => {
  it("convida workspace antigo sem setor depois do tour", () => {
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null }))).toBe(true);
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null, dismissed: true }))).toBe(false);
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null, eligible: false }))).toBe(false);
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null, appTourDone: false }))).toBe(false);
  });
});

describe("tour, novidades e conclusão", () => {
  it("mostra o tour enquanto não foi feito", () => {
    expect(shouldShowAppTour(state({ appTourDone: false }))).toBe(true);
    expect(shouldShowAppTour(state())).toBe(false);
  });

  it("aponta só as missões que acabaram de ser concluídas", () => {
    expect(newlyCompleted(progress(), progress(["venda"]))).toEqual(["venda"]);
    expect(newlyCompleted(progress(["venda"]), progress(["venda"]))).toEqual([]);
    expect(newlyCompleted(null, progress(["venda"]))).toEqual([]);
  });

  it("detecta quando tudo do modelo foi feito", () => {
    expect(allMissionsDone(state({ progress: progress(["catalogo", "compra-fornecedor", "venda", "cliente"]) }))).toBe(true);
    expect(allMissionsDone(state())).toBe(false);
    expect(allMissionsDone(state({ progress: null }))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run src/lib/onboarding`
Expected: FAIL com "Failed to resolve import "./missions"".

- [ ] **Step 3: Implementar `missions.ts`**

```ts
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
```

- [ ] **Step 4: Implementar `app-tour.ts`**

```ts
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
```

- [ ] **Step 5: Implementar `build-tour.ts`**

```ts
import type { Model, SectorExamples } from "./sectors";
import type { Side, StepTarget, TourStepDef } from "./missions";
import { fillText } from "./text";

export type Viewport = "mobile" | "desktop";

export type BuiltStep = {
  def: TourStepDef;
  selector: string;
  side: Side;
  title: string;
  content: string;
};

export type BuildContext = {
  model: Model | null;
  viewport: Viewport;
  examples: SectorExamples;
  missionsVisible: boolean;
};

export function resolve<T extends string>(value: T | { mobile: T; desktop: T }, viewport: Viewport): T {
  return typeof value === "string" ? value : value[viewport];
}

export function selectorFor(target: StepTarget, viewport: Viewport): string {
  return `[data-tour="${resolve(target, viewport)}"]`;
}

export function buildSteps(defs: TourStepDef[], context: BuildContext): BuiltStep[] {
  return defs
    .filter((def) => !def.models || (context.model !== null && def.models.includes(context.model)))
    .filter((def) => !def.requiresMissions || context.missionsVisible)
    .map((def) => ({
      def,
      selector: selectorFor(def.target, context.viewport),
      side: resolve(def.side, context.viewport),
      title: fillText(def.title, context.examples),
      content: fillText(def.content, context.examples),
    }));
}

export function stepIndexById(steps: BuiltStep[], id: string): number {
  return steps.findIndex((step) => step.def.id === id);
}

export function usesSpotlight(step: BuiltStep): boolean {
  return !step.def.viewport && step.def.advance.on !== "await";
}
```

- [ ] **Step 6: Implementar `visibility.ts`**

```ts
import type { MemberRole } from "@prisma/client";
import { modelOf, type SectorKey } from "./sectors";
import { MISSIONS, MISSION_IDS, MISSION_ORDER, type MissionDef, type MissionId, type OnboardingProgress } from "./missions";

export type OnboardingState = {
  workspaceId: string;
  sector: SectorKey | null;
  dismissed: boolean;
  appTourDone: boolean;
  eligible: boolean;
  progress: OnboardingProgress | null;
};

export function canSeeMissions(role: MemberRole, canWrite: boolean): boolean {
  return canWrite && (role === "OWNER" || role === "ADMIN");
}

export function missionsOf(state: OnboardingState): MissionDef[] {
  return state.sector ? MISSION_ORDER[modelOf(state.sector)].map((id) => MISSIONS[id]) : [];
}

export function pendingMissions(state: OnboardingState): MissionDef[] {
  const progress = state.progress;
  if (!progress) return [];
  return missionsOf(state).filter((mission) => !progress[mission.id]);
}

export function nextMission(state: OnboardingState): MissionDef | null {
  return pendingMissions(state)[0] ?? null;
}

export function missionCounts(state: OnboardingState): { done: number; total: number } {
  const all = missionsOf(state);
  const progress = state.progress;
  return { done: progress ? all.filter((mission) => progress[mission.id]).length : 0, total: all.length };
}

export function canPreviewMissions(state: OnboardingState): boolean {
  return state.eligible && state.sector !== null && !state.dismissed && state.progress !== null && pendingMissions(state).length > 0;
}

export function shouldShowMissions(state: OnboardingState, appTourRunning: boolean): boolean {
  return canPreviewMissions(state) && (state.appTourDone || appTourRunning);
}

export function shouldShowSectorPrompt(state: OnboardingState): boolean {
  return state.eligible && state.sector === null && !state.dismissed && state.appTourDone;
}

export function shouldShowAppTour(state: OnboardingState): boolean {
  return !state.appTourDone;
}

export function newlyCompleted(before: OnboardingProgress | null, after: OnboardingProgress | null): MissionId[] {
  if (!before || !after) return [];
  return MISSION_IDS.filter((id) => !before[id] && after[id]);
}

export function allMissionsDone(state: OnboardingState): boolean {
  return state.progress !== null && missionsOf(state).length > 0 && pendingMissions(state).length === 0;
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm exec vitest run src/lib/onboarding`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/onboarding
git commit -m "feat(onboarding): missões por modelo, tour do app e regras de visibilidade"
```

---

### Task 3: Colunas novas e estado do onboarding no servidor

**Files:**
- Modify: `prisma/schema.prisma` (modelos `User` e `Workspace`)
- Create: `prisma/migrations/20261015120000_onboarding/migration.sql`
- Create: `src/server/tenant/onboarding.ts`
- Test: `src/server/tenant/onboarding.test.ts`

**Interfaces:**
- Consumes (Tasks 1 e 2): `isSectorKey`, `SectorKey`, `MISSION_IDS`, `MissionId`, `OnboardingProgress`, `canSeeMissions`, `OnboardingState`.
- Produces:
  - `getOnboardingProgress(workspaceId: string): Promise<OnboardingProgress>`
  - `getOnboardingState(input: { workspaceId: string; userId: string; role: MemberRole; canWrite: boolean }): Promise<OnboardingState>`
  - `setWorkspaceSector(workspaceId: string, sector: string): Promise<void>` (lança `"Escolha o ramo do seu negócio."` se a chave for inválida)
  - `setOnboardingDismissed(workspaceId: string, dismissed: boolean): Promise<void>`
  - `setAppTourCompleted(userId: string, completed: boolean): Promise<void>`

- [ ] **Step 1: Editar o schema**

Em `prisma/schema.prisma`, no `model User`, logo depois de `termsAcceptedAt DateTime?`:

```prisma
  appTourCompletedAt DateTime?
```

No `model Workspace`, logo depois de `publicToken String?  @unique`:

```prisma
  sector                String?
  onboardingDismissedAt DateTime?
```

- [ ] **Step 2: Escrever a migration**

`prisma/migrations/20261015120000_onboarding/migration.sql`:

```sql
BEGIN;

ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "sector" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "onboardingDismissedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "appTourCompletedAt" TIMESTAMP(3);

COMMIT;
```

- [ ] **Step 3: Aplicar nos dois bancos e gerar o client**

Run:

```bash
docker exec -i cookies_db psql -U cookies -d cookies < prisma/migrations/20261015120000_onboarding/migration.sql
docker exec -i cookies_db psql -U cookies -d cookies_test < prisma/migrations/20261015120000_onboarding/migration.sql
pnpm exec prisma generate
```

Expected: `BEGIN`, três `ALTER TABLE` e `COMMIT` em cada banco; `prisma generate` termina com "Generated Prisma Client".

- [ ] **Step 4: Escrever os testes que falham**

`src/server/tenant/onboarding.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import {
  getOnboardingProgress,
  getOnboardingState,
  setAppTourCompleted,
  setOnboardingDismissed,
  setWorkspaceSector,
} from "./onboarding";

let ws = "";

async function seedUser(id: string) {
  return testDb.user.create({ data: { id, name: "Dona", email: `${id}@example.com` } });
}

describe("getOnboardingProgress", () => {
  beforeEach(async () => {
    await resetDb();
    ws = (await createWorkspace("Doce")).id;
  });

  it("começa com tudo pendente", async () => {
    const progress = await getOnboardingProgress(ws);
    expect(Object.values(progress).every((done) => done === false)).toBe(true);
  });

  it("conclui compra-insumo só com matéria-prima e compra-fornecedor com qualquer compra", async () => {
    const camiseta = await testDb.item.create({ data: { name: "Camiseta", workspaceId: ws } });
    const compra = await testDb.purchase.create({ data: { workspaceId: ws } });
    await testDb.purchaseItem.create({
      data: { purchaseId: compra.id, itemId: camiseta.id, quantity: 10, unit: "UN", pricePaidCents: 1000, workspaceId: ws },
    });

    let progress = await getOnboardingProgress(ws);
    expect(progress["compra-fornecedor"]).toBe(true);
    expect(progress["compra-insumo"]).toBe(false);

    const farinha = await testDb.item.create({
      data: { name: "Farinha", unit: "G", sellable: false, productionInput: true, workspaceId: ws },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: compra.id, itemId: farinha.id, quantity: 1000, unit: "G", pricePaidCents: 800, workspaceId: ws },
    });

    progress = await getOnboardingProgress(ws);
    expect(progress["compra-insumo"]).toBe(true);
  });

  it("conclui o catálogo só com preço ativo", async () => {
    const bolo = await testDb.item.create({ data: { name: "Bolo", workspaceId: ws } });
    const preco = await testDb.priceListItem.create({
      data: { itemId: bolo.id, priceCents: 1200, active: false, workspaceId: ws },
    });
    expect((await getOnboardingProgress(ws)).catalogo).toBe(false);

    await testDb.priceListItem.update({ where: { id: preco.id }, data: { active: true } });
    expect((await getOnboardingProgress(ws)).catalogo).toBe(true);
  });

  it("conclui ficha técnica, produção, venda e cliente", async () => {
    const bolo = await testDb.item.create({ data: { name: "Bolo", workspaceId: ws } });
    await testDb.recipe.create({ data: { name: "Bolo", workspaceId: ws } });
    await testDb.productionBatch.create({ data: { itemId: bolo.id, quantity: 10, workspaceId: ws } });
    await testDb.sale.create({ data: { workspaceId: ws } });
    await testDb.customer.create({ data: { name: "Ana", workspaceId: ws } });

    const progress = await getOnboardingProgress(ws);
    expect(progress["ficha-tecnica"]).toBe(true);
    expect(progress.producao).toBe(true);
    expect(progress.venda).toBe(true);
    expect(progress.cliente).toBe(true);
  });

  it("não conclui a venda parcelada com uma venda à vista, mesmo com a parcela 1", async () => {
    const avista = await testDb.sale.create({ data: { workspaceId: ws, totalCents: 1000 } });
    await testDb.saleInstallment.create({
      data: { saleId: avista.id, number: 1, amountCents: 1000, workspaceId: ws },
    });
    expect((await getOnboardingProgress(ws))["venda-parcelada"]).toBe(false);

    await testDb.sale.create({ data: { workspaceId: ws, totalCents: 3000, installmentCount: 3 } });
    expect((await getOnboardingProgress(ws))["venda-parcelada"]).toBe(true);
  });

  it("não conta dados de outro workspace", async () => {
    const outro = await createWorkspace("Outro");
    await testDb.customer.create({ data: { name: "Bia", workspaceId: outro.id } });
    await testDb.sale.create({ data: { workspaceId: outro.id, installmentCount: 2 } });

    const progress = await getOnboardingProgress(ws);
    expect(progress.cliente).toBe(false);
    expect(progress.venda).toBe(false);
    expect(progress["venda-parcelada"]).toBe(false);
  });
});

describe("getOnboardingState", () => {
  beforeEach(async () => {
    await resetDb();
    ws = (await createWorkspace("Doce")).id;
    await seedUser("u1");
  });

  it("devolve setor, tour e progresso para dono com escrita", async () => {
    await setWorkspaceSector(ws, "confeitaria");
    const state = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(state).toMatchObject({ workspaceId: ws, sector: "confeitaria", dismissed: false, appTourDone: false, eligible: true });
    expect(state.progress).not.toBeNull();
  });

  it("não calcula progresso para membro, modo leitura, sem setor ou dispensado", async () => {
    const semSetor = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(semSetor.progress).toBeNull();

    await setWorkspaceSector(ws, "roupas");
    const membro = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "MEMBER", canWrite: true });
    expect(membro).toMatchObject({ eligible: false, progress: null });

    const leitura = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: false });
    expect(leitura).toMatchObject({ eligible: false, progress: null });

    await setOnboardingDismissed(ws, true);
    const dispensado = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(dispensado).toMatchObject({ dismissed: true, progress: null });
  });

  it("mostra como concluídas as missões que um workspace antigo já cumpria ao escolher o setor", async () => {
    await testDb.customer.create({ data: { name: "Ana", workspaceId: ws } });
    await testDb.sale.create({ data: { workspaceId: ws } });

    await setWorkspaceSector(ws, "revenda");
    const state = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(state.progress?.venda).toBe(true);
    expect(state.progress?.cliente).toBe(true);
    expect(state.progress?.catalogo).toBe(false);
  });

  it("ignora um setor inválido gravado no banco", async () => {
    await testDb.workspace.update({ where: { id: ws }, data: { sector: "padaria" } });
    const state = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(state.sector).toBeNull();
    expect(state.progress).toBeNull();
  });
});

describe("gravações", () => {
  beforeEach(async () => {
    await resetDb();
    ws = (await createWorkspace("Doce")).id;
    await seedUser("u1");
  });

  it("recusa setor desconhecido sem gravar", async () => {
    await expect(setWorkspaceSector(ws, "padaria")).rejects.toThrow("Escolha o ramo do seu negócio.");
    const workspace = await testDb.workspace.findUnique({ where: { id: ws } });
    expect(workspace?.sector).toBeNull();
  });

  it("dispensa e retoma", async () => {
    await setOnboardingDismissed(ws, true);
    expect((await testDb.workspace.findUnique({ where: { id: ws } }))?.onboardingDismissedAt).toBeInstanceOf(Date);
    await setOnboardingDismissed(ws, false);
    expect((await testDb.workspace.findUnique({ where: { id: ws } }))?.onboardingDismissedAt).toBeNull();
  });

  it("marca e reinicia o tour do usuário", async () => {
    await setAppTourCompleted("u1", true);
    expect((await testDb.user.findUnique({ where: { id: "u1" } }))?.appTourCompletedAt).toBeInstanceOf(Date);
    await setAppTourCompleted("u1", false);
    expect((await testDb.user.findUnique({ where: { id: "u1" } }))?.appTourCompletedAt).toBeNull();
  });
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm exec vitest run src/server/tenant/onboarding.test.ts`
Expected: FAIL com "Failed to resolve import "./onboarding"".

- [ ] **Step 6: Implementar**

`src/server/tenant/onboarding.ts`:

```ts
import type { MemberRole } from "@prisma/client";
import { db } from "@/lib/db";
import { MISSION_IDS, type MissionId, type OnboardingProgress } from "@/lib/onboarding/missions";
import { isSectorKey } from "@/lib/onboarding/sectors";
import { canSeeMissions, type OnboardingState } from "@/lib/onboarding/visibility";

type ProgressRow = Record<MissionId, boolean | null>;

export async function getOnboardingProgress(workspaceId: string): Promise<OnboardingProgress> {
  const rows = await db.$queryRaw<ProgressRow[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM "purchase_item" pi
        JOIN "item" i ON i."id" = pi."itemId"
        WHERE pi."workspaceId" = ${workspaceId} AND i."productionInput"
      ) AS "compra-insumo",
      EXISTS (SELECT 1 FROM "purchase" WHERE "workspaceId" = ${workspaceId}) AS "compra-fornecedor",
      EXISTS (SELECT 1 FROM "recipe" WHERE "workspaceId" = ${workspaceId}) AS "ficha-tecnica",
      EXISTS (SELECT 1 FROM "price_list_item" WHERE "workspaceId" = ${workspaceId} AND "active") AS "catalogo",
      EXISTS (SELECT 1 FROM "production_batch" WHERE "workspaceId" = ${workspaceId}) AS "producao",
      EXISTS (SELECT 1 FROM "sale" WHERE "workspaceId" = ${workspaceId}) AS "venda",
      EXISTS (SELECT 1 FROM "sale" WHERE "workspaceId" = ${workspaceId} AND "installmentCount" > 1) AS "venda-parcelada",
      EXISTS (SELECT 1 FROM "customer" WHERE "workspaceId" = ${workspaceId}) AS "cliente"
  `;
  const row = rows[0];
  return Object.fromEntries(MISSION_IDS.map((id) => [id, Boolean(row?.[id])])) as OnboardingProgress;
}

export async function getOnboardingState(input: {
  workspaceId: string;
  userId: string;
  role: MemberRole;
  canWrite: boolean;
}): Promise<OnboardingState> {
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { sector: true, onboardingDismissedAt: true },
  });
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { appTourCompletedAt: true },
  });

  const sector = isSectorKey(workspace?.sector) ? workspace.sector : null;
  const dismissed = workspace?.onboardingDismissedAt != null;
  const eligible = canSeeMissions(input.role, input.canWrite);

  let progress: OnboardingProgress | null = null;
  if (eligible && sector && !dismissed) {
    try {
      progress = await getOnboardingProgress(input.workspaceId);
    } catch (error) {
      console.error("onboarding: falha ao calcular o progresso", error);
    }
  }

  return {
    workspaceId: input.workspaceId,
    sector,
    dismissed,
    appTourDone: user?.appTourCompletedAt != null,
    eligible,
    progress,
  };
}

export async function setWorkspaceSector(workspaceId: string, sector: string): Promise<void> {
  if (!isSectorKey(sector)) throw new Error("Escolha o ramo do seu negócio.");
  await db.workspace.update({ where: { id: workspaceId }, data: { sector } });
}

export async function setOnboardingDismissed(workspaceId: string, dismissed: boolean): Promise<void> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: { onboardingDismissedAt: dismissed ? new Date() : null },
  });
}

export async function setAppTourCompleted(userId: string, completed: boolean): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { appTourCompletedAt: completed ? new Date() : null },
  });
}
```

Se o TypeScript reclamar do estreitamento em `isSectorKey(workspace?.sector) ? workspace.sector : null`, troque por `const raw = workspace?.sector; const sector = isSectorKey(raw) ? raw : null;`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm exec vitest run src/server/tenant/onboarding.test.ts src/server/tenant/schema.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261015120000_onboarding src/server/tenant/onboarding.ts src/server/tenant/onboarding.test.ts
git commit -m "feat(onboarding): setor e estado do onboarding no workspace, progresso numa query só"
```

---

### Task 4: Server actions do onboarding e workspace criado com setor

**Files:**
- Create: `src/server/actions/onboarding.ts`
- Test: `src/server/actions/onboarding.test.ts`
- Modify: `src/server/tenant/workspaces.ts:135-171`
- Modify: `src/server/tenant/workspaces.test.ts`
- Modify: `src/server/actions/workspaces.ts:35-44`

**Interfaces:**
- Consumes (Task 3): `getOnboardingState`, `setWorkspaceSector`, `setOnboardingDismissed`, `setAppTourCompleted`; de `@/server/tenant/context`: `getWorkspaceContext`, `requireRole`.
- Produces:
  - `chooseWorkspaceSector(sector: string): Promise<ActionResult>`
  - `dismissOnboarding(): Promise<ActionResult>`, `resumeOnboarding(): Promise<ActionResult>`
  - `finishAppTour(): Promise<ActionResult>`, `restartAppTour(): Promise<ActionResult>`
  - `refreshOnboardingProgress(): Promise<OnboardingProgress | null>`
  - `createWorkspaceForUser(name: string, sector: string): Promise<string>` (o setor passa a ser obrigatório)
  - `createWorkspace(formData)` lê os campos `name` e `sector`.

- [ ] **Step 1: Escrever os testes que falham das actions**

`src/server/actions/onboarding.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Role = "OWNER" | "ADMIN" | "MEMBER";
const context: { workspaceId: string; userId: string; role: Role; canWrite: boolean } = {
  workspaceId: "",
  userId: "u-dona",
  role: "OWNER",
  canWrite: true,
};

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceContext: async () => ({ ...context }),
  requireRole: async (...allowed: Role[]) => {
    if (!allowed.includes(context.role)) throw new Error("Não autorizado");
    return { ...context };
  },
}));

const {
  chooseWorkspaceSector,
  dismissOnboarding,
  finishAppTour,
  refreshOnboardingProgress,
  restartAppTour,
  resumeOnboarding,
} = await import("./onboarding");

describe("actions do onboarding", () => {
  beforeEach(async () => {
    await resetDb();
    context.workspaceId = (await createWorkspace("Loja")).id;
    context.role = "OWNER";
    context.canWrite = true;
    await testDb.user.create({ data: { id: "u-dona", name: "Dona", email: "dona@example.com" } });
  });

  it("grava o setor escolhido", async () => {
    expect(await chooseWorkspaceSector("roupas")).toEqual({ ok: true });
    const workspace = await testDb.workspace.findUnique({ where: { id: context.workspaceId } });
    expect(workspace?.sector).toBe("roupas");
  });

  it("recusa setor adulterado com mensagem", async () => {
    expect(await chooseWorkspaceSector("<script>")).toEqual({ ok: false, error: "Escolha o ramo do seu negócio." });
  });

  it("não deixa membro mexer no onboarding do workspace", async () => {
    context.role = "MEMBER";
    expect(await chooseWorkspaceSector("roupas")).toEqual({ ok: false, error: "Não autorizado" });
    expect(await dismissOnboarding()).toEqual({ ok: false, error: "Não autorizado" });
  });

  it("dispensa e retoma", async () => {
    await dismissOnboarding();
    expect((await testDb.workspace.findUnique({ where: { id: context.workspaceId } }))?.onboardingDismissedAt).not.toBeNull();
    await resumeOnboarding();
    expect((await testDb.workspace.findUnique({ where: { id: context.workspaceId } }))?.onboardingDismissedAt).toBeNull();
  });

  it("conclui e reinicia o tour do usuário", async () => {
    await finishAppTour();
    expect((await testDb.user.findUnique({ where: { id: "u-dona" } }))?.appTourCompletedAt).not.toBeNull();
    await restartAppTour();
    expect((await testDb.user.findUnique({ where: { id: "u-dona" } }))?.appTourCompletedAt).toBeNull();
  });

  it("devolve o progresso só para quem vê as missões", async () => {
    await chooseWorkspaceSector("roupas");
    await testDb.customer.create({ data: { name: "Ana", workspaceId: context.workspaceId } });
    expect((await refreshOnboardingProgress())?.cliente).toBe(true);

    context.role = "MEMBER";
    expect(await refreshOnboardingProgress()).toBeNull();
  });
});
```

- [ ] **Step 2: Escrever os testes que falham da criação com setor**

Em `src/server/tenant/workspaces.test.ts`, todas as chamadas existentes passam a informar um setor. Rode:

```bash
sed -i '' -E 's/createWorkspaceForUser\(("[^"]*")\)/createWorkspaceForUser(\1, "outro")/g' src/server/tenant/workspaces.test.ts
grep -n "createWorkspaceForUser(" src/server/tenant/workspaces.test.ts
```

Expected: toda linha listada termina com `, "outro")`.

Depois, dentro do `describe("createWorkspaceForUser", ...)`, acrescente:

```ts
  it("grava o setor do workspace", async () => {
    await seedUserWithSession("u-sector", "sector@example.com");

    const id = await createWorkspaceForUser("Doce Vida", "confeitaria");

    const ws = await testDb.workspace.findUnique({ where: { id } });
    expect(ws?.sector).toBe("confeitaria");
  });

  it("recusa setor desconhecido e não cria nada", async () => {
    await seedUserWithSession("u-bad-sector", "bad-sector@example.com");

    await expect(createWorkspaceForUser("Doce Vida", "padaria")).rejects.toThrow("Escolha o ramo do seu negócio.");

    expect(await testDb.workspace.count()).toBe(0);
    expect(await testDb.member.count()).toBe(0);
  });
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm exec vitest run src/server/actions/onboarding.test.ts src/server/tenant/workspaces.test.ts`
Expected: FAIL com "Failed to resolve import "./onboarding"" e, em `workspaces.test.ts`, os dois testes novos falhando (setor não gravado e workspace criado com setor inválido).

- [ ] **Step 4: Implementar as actions**

`src/server/actions/onboarding.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { OnboardingProgress } from "@/lib/onboarding/missions";
import { getWorkspaceContext, requireRole } from "@/server/tenant/context";
import {
  getOnboardingState,
  setAppTourCompleted,
  setOnboardingDismissed,
  setWorkspaceSector,
} from "@/server/tenant/onboarding";
import type { ActionResult } from "./workspaces";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Algo deu errado.";
}

async function perform(task: () => Promise<void>): Promise<ActionResult> {
  try {
    await task();
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function chooseWorkspaceSector(sector: string): Promise<ActionResult> {
  return perform(async () => {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    await setWorkspaceSector(workspaceId, sector);
  });
}

export async function dismissOnboarding(): Promise<ActionResult> {
  return perform(async () => {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    await setOnboardingDismissed(workspaceId, true);
  });
}

export async function resumeOnboarding(): Promise<ActionResult> {
  return perform(async () => {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    await setOnboardingDismissed(workspaceId, false);
  });
}

export async function finishAppTour(): Promise<ActionResult> {
  return perform(async () => {
    const { userId } = await getWorkspaceContext();
    await setAppTourCompleted(userId, true);
  });
}

export async function restartAppTour(): Promise<ActionResult> {
  return perform(async () => {
    const { userId } = await getWorkspaceContext();
    await setAppTourCompleted(userId, false);
  });
}

export async function refreshOnboardingProgress(): Promise<OnboardingProgress | null> {
  const context = await getWorkspaceContext();
  const state = await getOnboardingState(context);
  return state.progress;
}
```

- [ ] **Step 5: Implementar o setor na criação do workspace**

Em `src/server/tenant/workspaces.ts`, acrescente o import:

```ts
import { isSectorKey } from "@/lib/onboarding/sectors";
```

Troque a assinatura e o começo de `createWorkspaceForUser`:

```ts
export async function createWorkspaceForUser(name: string, sector: string): Promise<string> {
  const userId = await requireUserId();
  const clean = normalizeName(name);
  if (!clean) throw new Error("Informe um nome para o workspace.");
  if (!isSectorKey(sector)) throw new Error("Escolha o ramo do seu negócio.");
```

E o `create` dentro da transação:

```ts
    const created = await tx.workspace.create({
      data: { name: clean, slug, sector },
    });
```

Em `src/server/actions/workspaces.ts`, `createWorkspace` passa a ler o setor:

```ts
export async function createWorkspace(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "");
  const sector = String(formData.get("sector") ?? "");
  try {
    await createWorkspaceForUser(name, sector);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm exec vitest run src/server/actions/onboarding.test.ts src/server/tenant/workspaces.test.ts && pnpm exec tsc --noEmit`
Expected: PASS e o `tsc` sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/onboarding.ts src/server/actions/onboarding.test.ts src/server/tenant/workspaces.ts src/server/tenant/workspaces.test.ts src/server/actions/workspaces.ts
git commit -m "feat(onboarding): actions do onboarding e setor obrigatório ao criar workspace"
```

---

### Task 5: Escolha do setor ao criar o workspace

**Files:**
- Create: `src/components/onboarding/sector-picker.tsx`
- Modify: `src/components/workspaces/workspace-forms.tsx:16-56` (`CreateWorkspaceForm`)

**Interfaces:**
- Consumes: `SECTORS`, `SectorKey` (Task 1); `createWorkspace` com `sector` (Task 4); `timing` de `@/components/pwa/guide-parts`.
- Produces: `SectorPicker({ value: SectorKey | null; onChange: (key: SectorKey) => void; disabled?: boolean; className?: string })`.

Componente de interface sem infraestrutura de teste de DOM no projeto (vitest roda em `node`); a lógica testável (setores, validação) já está coberta nas Tarefas 1 e 4. A verificação aqui é no navegador.

- [ ] **Step 1: Criar o `SectorPicker`**

`src/components/onboarding/sector-picker.tsx`:

```tsx
"use client";

import { SECTORS, type SectorKey } from "@/lib/onboarding/sectors";
import { timing } from "@/components/pwa/guide-parts";
import { cn } from "@/lib/utils";

export function SectorPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: SectorKey | null;
  onChange: (key: SectorKey) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Ramo do negócio" className={cn("grid grid-cols-2 gap-2", className)}>
      {SECTORS.map(({ key, label, icon: Icon }, index) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(key)}
            style={timing(index * 0.04)}
            className={cn(
              "pwa-pop flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border bg-card p-3 text-left text-sm transition-colors disabled:opacity-60",
              selected ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "hover:bg-muted",
            )}
          >
            <Icon className={cn("size-5 transition-colors", selected ? "text-primary" : "text-muted-foreground")} />
            <span className="font-medium leading-tight">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Transformar o `CreateWorkspaceForm` em dois passos**

Em `src/components/workspaces/workspace-forms.tsx`, acrescente aos imports:

```tsx
import { SectorPicker } from "@/components/onboarding/sector-picker";
import type { SectorKey } from "@/lib/onboarding/sectors";
```

Substitua a função `CreateWorkspaceForm` inteira por:

```tsx
export function CreateWorkspaceForm({ onDone, redirectTo = "/dashboard" }: FormProps) {
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"name" | "sector">("name");
  const [name, setName] = useState("");
  const [sector, setSector] = useState<SectorKey | null>(null);
  const router = useRouter();

  function submit() {
    if (!sector) return;
    const formData = new FormData();
    formData.set("name", name);
    formData.set("sector", sector);
    startTransition(async () => {
      const result = await createWorkspace(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível criar o workspace.");
        return;
      }
      toast.success("Workspace criado.");
      onDone?.();
      router.push(redirectTo);
      router.refresh();
    });
  }

  if (step === "name") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) setStep("sector");
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="name">Nome do negócio</Label>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Douce Vie"
            autoComplete="off"
            autoFocus
            required
            maxLength={60}
          />
          <p className="text-xs text-muted-foreground">
            É assim que ele aparece no seletor. Dá para mudar depois.
          </p>
        </div>
        <Button type="submit" disabled={!name.trim()} className="w-full">
          Continuar
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4 duration-300 animate-in fade-in slide-in-from-right-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Qual é o ramo do seu negócio?</p>
        <p className="text-xs text-muted-foreground">
          Usamos isso para mostrar os primeiros passos certos para você.
        </p>
      </div>
      <SectorPicker value={sector} onChange={setSector} disabled={pending} />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setStep("name")} disabled={pending}>
          Voltar
        </Button>
        <Button type="button" className="flex-1" onClick={submit} disabled={pending || !sector}>
          {pending ? "Criando..." : "Criar workspace"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Checar tipos e lint**

Run: `pnpm exec tsc --noEmit && pnpm exec next lint --dir src/components/onboarding --dir src/components/workspaces`
Expected: sem erros.

- [ ] **Step 4: Verificar no navegador**

Suba o preview com `preview_start` `{ name: "cookies-dev" }`. Entre com um usuário de teste local e abra o seletor de workspace → "Criar workspace" (no desktop, na barra lateral; no celular, em Ajustes). Confira:
1. Passo 1 pede o nome; "Continuar" só habilita com nome.
2. Passo 2 mostra os 10 setores com animação de entrada; o selecionado ganha borda e anel.
3. "Criar workspace" cria e leva ao Painel. No banco: `docker exec cookies_db psql -U cookies -d cookies -c 'SELECT name, sector FROM workspace ORDER BY "createdAt" DESC LIMIT 1'` mostra o setor escolhido.
4. Em 375 px (`resize_window` preset `mobile`) a grade cabe sem rolagem horizontal.

Se o plano do usuário de teste não permitir mais um workspace, use um usuário novo sem workspace e a tela `/onboarding`.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/sector-picker.tsx src/components/workspaces/workspace-forms.tsx
git commit -m "feat(onboarding): escolha do ramo do negócio ao criar o workspace"
```

---

### Task 6: Provider do onboarding no AppShell e linhas em Ajustes

**Files:**
- Create: `src/components/onboarding/onboarding-context.tsx`
- Create: `src/components/onboarding/onboarding-provider.tsx`
- Create: `src/components/onboarding/onboarding-settings.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/app/(app)/more/page.tsx`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (em `onboarding-context.tsx`):
  - `type TourRun = { kind: "app" } | { kind: "mission"; missionId: MissionId }`
  - `type Celebrating = { kind: "mission"; missionId: MissionId } | { kind: "all" }`
  - `type OnboardingValue` (campos abaixo), `OnboardingContext`, `useOnboarding()`, `useOptionalOnboarding()`
  - `OnboardingProvider({ initial: OnboardingState; children })` em `onboarding-provider.tsx`
  - `OnboardingSettings()` em `onboarding-settings.tsx`

`OnboardingValue`:

```ts
{
  state: OnboardingState;
  model: Model | null;
  examples: SectorExamples;
  missions: MissionDef[];
  nextMission: MissionDef | null;
  counts: { done: number; total: number };
  missionsPreviewable: boolean;
  missionsVisible: boolean;
  run: TourRun | null;
  pausedMissionId: MissionId | null;
  celebrating: Celebrating | null;
  text: (input: string) => string;
  startMission: (missionId: MissionId) => void;
  pauseRun: () => void;
  stopRun: () => void;
  finishAppTour: () => Promise<void>;
  refresh: () => Promise<OnboardingProgress | null>;
  chooseSector: (sector: SectorKey) => Promise<boolean>;
  dismiss: () => Promise<void>;
  resume: () => Promise<void>;
  restartTour: () => Promise<void>;
  clearCelebration: () => void;
}
```

A regra de negócio do provider (visibilidade, próxima missão, novidades) vem das funções puras testadas na Tarefa 2. A verificação aqui é de tipos, lint e navegador.

- [ ] **Step 1: Criar o contexto**

`src/components/onboarding/onboarding-context.tsx`:

```tsx
"use client";

import { createContext, useContext } from "react";
import type { MissionDef, MissionId, OnboardingProgress } from "@/lib/onboarding/missions";
import type { Model, SectorExamples, SectorKey } from "@/lib/onboarding/sectors";
import type { OnboardingState } from "@/lib/onboarding/visibility";

export type TourRun = { kind: "app" } | { kind: "mission"; missionId: MissionId };

export type Celebrating = { kind: "mission"; missionId: MissionId } | { kind: "all" };

export type OnboardingValue = {
  state: OnboardingState;
  model: Model | null;
  examples: SectorExamples;
  missions: MissionDef[];
  nextMission: MissionDef | null;
  counts: { done: number; total: number };
  missionsPreviewable: boolean;
  missionsVisible: boolean;
  run: TourRun | null;
  pausedMissionId: MissionId | null;
  celebrating: Celebrating | null;
  text: (input: string) => string;
  startMission: (missionId: MissionId) => void;
  pauseRun: () => void;
  stopRun: () => void;
  finishAppTour: () => Promise<void>;
  refresh: () => Promise<OnboardingProgress | null>;
  chooseSector: (sector: SectorKey) => Promise<boolean>;
  dismiss: () => Promise<void>;
  resume: () => Promise<void>;
  restartTour: () => Promise<void>;
  clearCelebration: () => void;
};

export const OnboardingContext = createContext<OnboardingValue | null>(null);

export function useOnboarding(): OnboardingValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error("useOnboarding precisa do OnboardingProvider");
  return value;
}

export function useOptionalOnboarding(): OnboardingValue | null {
  return useContext(OnboardingContext);
}
```

- [ ] **Step 2: Criar o provider**

`src/components/onboarding/onboarding-provider.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { MISSIONS, type MissionId, type OnboardingProgress } from "@/lib/onboarding/missions";
import { getSector, modelOf, type SectorKey } from "@/lib/onboarding/sectors";
import { fillText } from "@/lib/onboarding/text";
import {
  allMissionsDone,
  canPreviewMissions,
  missionCounts,
  missionsOf,
  newlyCompleted,
  nextMission,
  shouldShowMissions,
  type OnboardingState,
} from "@/lib/onboarding/visibility";
import {
  chooseWorkspaceSector,
  dismissOnboarding,
  finishAppTour as finishAppTourAction,
  refreshOnboardingProgress,
  restartAppTour as restartAppTourAction,
  resumeOnboarding,
} from "@/server/actions/onboarding";
import { OnboardingContext, type Celebrating, type OnboardingValue, type TourRun } from "./onboarding-context";

const FALLBACK_EXAMPLES = getSector("outro").examples;

export function OnboardingProvider({ initial, children }: { initial: OnboardingState; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initial);
  const [run, setRun] = useState<TourRun | null>(null);
  const [pausedMissionId, setPausedMissionId] = useState<MissionId | null>(null);
  const [celebrating, setCelebrating] = useState<Celebrating | null>(null);
  const stateRef = useRef(initial);
  const runRef = useRef<TourRun | null>(null);
  const latestInitial = useRef(initial);
  latestInitial.current = initial;
  runRef.current = run;

  const commit = useCallback((next: OnboardingState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const applyProgress = useCallback(
    (progress: OnboardingProgress | null) => {
      const before = stateRef.current;
      const after = { ...before, progress };
      commit(after);
      const relevant = new Set(missionsOf(after).map((mission) => mission.id));
      const fresh = newlyCompleted(before.progress, progress).filter((id) => relevant.has(id));
      if (fresh.length === 0) return;
      const current = runRef.current;
      if (current?.kind === "mission" && fresh.includes(current.missionId)) setRun(null);
      setPausedMissionId((paused) => (paused && fresh.includes(paused) ? null : paused));
      setCelebrating(allMissionsDone(after) ? { kind: "all" } : { kind: "mission", missionId: fresh[0] });
    },
    [commit],
  );

  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    const incoming = latestInitial.current;
    stateRef.current = { ...incoming, progress: stateRef.current.progress };
    applyProgress(incoming.progress);
  }, [initialKey, applyProgress]);

  useEffect(() => {
    if (!state.appTourDone && run === null && pathname === "/dashboard") setRun({ kind: "app" });
  }, [state.appTourDone, run, pathname]);

  const tracking = state.eligible && state.sector !== null && !state.dismissed;

  const refresh = useCallback(async () => {
    const progress = await refreshOnboardingProgress();
    applyProgress(progress);
    return progress;
  }, [applyProgress]);

  useEffect(() => {
    if (tracking) void refresh().catch(() => undefined);
  }, [pathname, tracking, refresh]);

  const finishAppTour = useCallback(async () => {
    commit({ ...stateRef.current, appTourDone: true });
    setRun((current) => (current?.kind === "app" ? null : current));
    const result = await finishAppTourAction();
    if (!result.ok) toast.error(result.error ?? "Não foi possível salvar o tour.");
  }, [commit]);

  const startMission = useCallback(
    (missionId: MissionId) => {
      setPausedMissionId(null);
      setRun({ kind: "mission", missionId });
      const route = MISSIONS[missionId].startRoute;
      if (pathname !== route) router.push(route);
    },
    [pathname, router],
  );

  const pauseRun = useCallback(() => {
    const current = runRef.current;
    if (current?.kind === "mission") setPausedMissionId(current.missionId);
    setRun(null);
  }, []);

  const stopRun = useCallback(() => setRun(null), []);

  const chooseSector = useCallback(
    async (sector: SectorKey) => {
      const result = await chooseWorkspaceSector(sector);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível salvar o ramo.");
        return false;
      }
      router.refresh();
      return true;
    },
    [router],
  );

  const dismiss = useCallback(async () => {
    commit({ ...stateRef.current, dismissed: true });
    setRun((current) => (current?.kind === "mission" ? null : current));
    const result = await dismissOnboarding();
    if (!result.ok) toast.error(result.error ?? "Não foi possível esconder os primeiros passos.");
  }, [commit]);

  const resume = useCallback(async () => {
    const result = await resumeOnboarding();
    if (!result.ok) {
      toast.error(result.error ?? "Não foi possível retomar os primeiros passos.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }, [router]);

  const restartTour = useCallback(async () => {
    const result = await restartAppTourAction();
    if (!result.ok) {
      toast.error(result.error ?? "Não foi possível reiniciar o tour.");
      return;
    }
    commit({ ...stateRef.current, appTourDone: false });
    router.push("/dashboard");
    router.refresh();
  }, [commit, router]);

  const clearCelebration = useCallback(() => setCelebrating(null), []);

  const value = useMemo<OnboardingValue>(() => {
    const examples = state.sector ? getSector(state.sector).examples : FALLBACK_EXAMPLES;
    return {
      state,
      model: state.sector ? modelOf(state.sector) : null,
      examples,
      missions: missionsOf(state),
      nextMission: nextMission(state),
      counts: missionCounts(state),
      missionsPreviewable: canPreviewMissions(state),
      missionsVisible: shouldShowMissions(state, run?.kind === "app"),
      run,
      pausedMissionId,
      celebrating,
      text: (input: string) => fillText(input, examples),
      startMission,
      pauseRun,
      stopRun,
      finishAppTour,
      refresh,
      chooseSector,
      dismiss,
      resume,
      restartTour,
      clearCelebration,
    };
  }, [
    state,
    run,
    pausedMissionId,
    celebrating,
    startMission,
    pauseRun,
    stopRun,
    finishAppTour,
    refresh,
    chooseSector,
    dismiss,
    resume,
    restartTour,
    clearCelebration,
  ]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
```

- [ ] **Step 3: Ligar no layout e no AppShell**

Em `src/app/(app)/layout.tsx`, acrescente o import:

```ts
import { getOnboardingState } from "@/server/tenant/onboarding";
```

Mantenha a linha `const { workspaceId, canWrite } = await getWorkspaceContext();` como está. Depois de calcular `trial`, acrescente:

```ts
  const onboarding = await getOnboardingState({
    workspaceId: active.id,
    userId: session.user.id,
    role: active.role,
    canWrite,
  });
```

E passe para o `AppShell`:

```tsx
      trial={trial}
      onboarding={onboarding}
    >
```

Em `src/components/layout/app-shell.tsx`, acrescente os imports:

```ts
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import type { OnboardingState } from "@/lib/onboarding/visibility";
```

Acrescente `onboarding` à desestruturação (depois de `trial,`) e ao tipo das props (`onboarding: OnboardingState;` depois de `trial: TrialState | null;`). Envolva o `<div className="flex h-dvh overflow-hidden">…</div>` com o provider:

```tsx
    <ReadOnlyProvider readOnly={isReadOnly}>
      <OnboardingProvider key={onboarding.workspaceId} initial={onboarding}>
        <div className="flex h-dvh overflow-hidden">
          ...conteúdo atual, sem mudanças...
        </div>
      </OnboardingProvider>
    </ReadOnlyProvider>
```

- [ ] **Step 4: Criar as linhas de Ajustes**

`src/components/onboarding/onboarding-settings.tsx`:

```tsx
"use client";

import { useTransition, type ComponentType } from "react";
import { ChevronRight, ListChecks, Sparkles } from "lucide-react";
import { useOnboarding } from "./onboarding-context";

function SettingsRow({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 active:bg-muted disabled:opacity-60"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function OnboardingSettings() {
  const onboarding = useOnboarding();
  const [pending, startTransition] = useTransition();
  const canResume = onboarding.state.eligible && onboarding.state.dismissed;

  return (
    <div className="divide-y rounded-lg border bg-card">
      {canResume ? (
        <SettingsRow
          icon={ListChecks}
          label="Retomar primeiros passos"
          description="Volta a mostrar as missões no Painel"
          onClick={() => startTransition(onboarding.resume)}
          disabled={pending}
        />
      ) : null}
      <SettingsRow
        icon={Sparkles}
        label="Rever tour do app"
        description="Mostra de novo onde fica cada coisa"
        onClick={() => startTransition(onboarding.restartTour)}
        disabled={pending}
      />
    </div>
  );
}
```

Em `src/app/(app)/more/page.tsx`, importe `import { OnboardingSettings } from "@/components/onboarding/onboarding-settings";` e coloque `<OnboardingSettings />` logo antes de `<InstallAppItem />`.

- [ ] **Step 5: Checar tipos, lint e testes**

Run: `pnpm exec tsc --noEmit && pnpm exec next lint && pnpm test`
Expected: sem erros de tipo nem de lint; todos os testes passam.

- [ ] **Step 6: Verificar no navegador**

Com o preview `cookies-dev`, abra `/more`: aparece "Rever tour do app". Tocar nele leva ao Painel (o tour ainda não existe; isso vem na Tarefa 7). Confira no banco que `appTourCompletedAt` ficou nulo para o usuário de teste: `docker exec cookies_db psql -U cookies -d cookies -c 'SELECT email, "appTourCompletedAt" FROM "user"'`. Sem erros em `read_console_messages`.

- [ ] **Step 7: Commit**

```bash
git add src/components/onboarding/onboarding-context.tsx src/components/onboarding/onboarding-provider.tsx src/components/onboarding/onboarding-settings.tsx "src/app/(app)/layout.tsx" src/components/layout/app-shell.tsx "src/app/(app)/more/page.tsx"
git commit -m "feat(onboarding): estado do onboarding no AppShell e atalhos em Ajustes"
```

---

### Task 7: Motor do tour (nextstepjs + cartão de dica) e tour de apresentação

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (via `pnpm add`)
- Create: `src/lib/onboarding/wait-for.ts`
- Test: `src/lib/onboarding/wait-for.test.ts`
- Create: `src/components/onboarding/runner-context.ts`
- Create: `src/components/onboarding/find-target.ts`
- Create: `src/components/onboarding/tour-card-body.tsx`
- Create: `src/components/onboarding/tour-card.tsx`
- Create: `src/components/onboarding/inline-hint.tsx`
- Create: `src/components/onboarding/tour-runner.tsx`
- Modify: `src/components/onboarding/onboarding-provider.tsx` (renderiza o runner)
- Modify: `src/components/layout/bottom-nav.tsx`, `src/components/layout/side-nav.tsx`, `src/components/shared/page-header.tsx`, `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `buildSteps`, `usesSpotlight`, `stepIndexById`, `APP_TOUR`, `MISSIONS`, `isRouteOfMission` (Task 2); `useOnboarding`, `TourRun` (Task 6).
- Produces:
  - `waitFor(check: () => boolean, options: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal }): Promise<boolean>`
  - `type RunnerValue = { steps: BuiltStep[]; index: number; next: () => void; skipTo: (id: string) => void; stop: () => void }`, `RunnerContext`, `useTourRunner()`
  - `findTarget(selector: string): HTMLElement | null`
  - `TourRunner({ run: TourRun })`
  - Alvos: `nav-dashboard`, `nav-sales`, `nav-sell`, `nav-customers`, `nav-more`, `side-dashboard`, `side-consolidated`, `side-sales`, `side-customers`, `side-production`, `side-stock`, `side-purchases`, `side-catalog`, `side-admin`, `dashboard-header`, `dashboard-new-sale`
  - `PageHeader` ganha a prop opcional `tourId?: string`.
  - CSS: qualquer elemento com `data-tour-active` ganha o anel pulsante.

- [ ] **Step 1: Instalar as dependências**

Run: `pnpm add nextstepjs@2.3.0 motion@13.4.6`
Expected: `package.json` com `"nextstepjs": "2.3.0"` e `"motion": "13.4.6"` em `dependencies`; `pnpm-lock.yaml` atualizado; `yarn.lock` intocado (`git status` não lista o `yarn.lock`).

- [ ] **Step 2: Escrever o teste que falha do `waitFor`**

`src/lib/onboarding/wait-for.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "./wait-for";

describe("waitFor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolve na hora quando a condição já vale", async () => {
    await expect(waitFor(() => true, { timeoutMs: 1000 })).resolves.toBe(true);
  });

  it("espera a condição passar a valer", async () => {
    let ready = false;
    const promise = waitFor(() => ready, { timeoutMs: 1000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    ready = true;
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe(true);
  });

  it("desiste depois do tempo limite", async () => {
    const promise = waitFor(() => false, { timeoutMs: 500, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toBe(false);
  });

  it("para quando é abortado", async () => {
    const controller = new AbortController();
    const promise = waitFor(() => false, {
      timeoutMs: Number.POSITIVE_INFINITY,
      intervalMs: 100,
      signal: controller.signal,
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe(false);
  });
});
```

Run: `pnpm exec vitest run src/lib/onboarding/wait-for.test.ts`
Expected: FAIL com "Failed to resolve import "./wait-for"".

- [ ] **Step 3: Implementar o `waitFor`**

`src/lib/onboarding/wait-for.ts`:

```ts
export type WaitOptions = {
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
};

export function waitFor(check: () => boolean, { timeoutMs, intervalMs = 150, signal }: WaitOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    if (check()) {
      resolve(true);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(timer);
        resolve(false);
        return;
      }
      if (check()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs);
  });
}
```

Run: `pnpm exec vitest run src/lib/onboarding/wait-for.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 4: Criar contexto do runner, busca de alvo e o corpo do cartão**

`src/components/onboarding/runner-context.ts`:

```ts
"use client";

import { createContext, useContext } from "react";
import type { BuiltStep } from "@/lib/onboarding/build-tour";

export type RunnerValue = {
  steps: BuiltStep[];
  index: number;
  next: () => void;
  skipTo: (id: string) => void;
  stop: () => void;
};

export const RunnerContext = createContext<RunnerValue | null>(null);

export function useTourRunner(): RunnerValue {
  const value = useContext(RunnerContext);
  if (!value) throw new Error("useTourRunner precisa do TourRunner");
  return value;
}
```

`src/components/onboarding/find-target.ts`:

```ts
export function findTarget(selector: string): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return candidates.find((element) => element.getClientRects().length > 0) ?? null;
}
```

`src/components/onboarding/tour-card-body.tsx`:

```tsx
"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BuiltStep } from "@/lib/onboarding/build-tour";

const WAITING_LABEL = {
  click: "Toque no destaque para continuar",
  until: "Preencha o campo destacado para continuar",
  await: "Escolha no campo destacado para continuar",
} as const;

export function TourCardBody({
  step,
  position,
  total,
  onNext,
  onSkipTo,
  onStop,
}: {
  step: BuiltStep;
  position: number;
  total: number;
  onNext: () => void;
  onSkipTo: (id: string) => void;
  onStop: () => void;
}) {
  const advance = step.def.advance;
  const skip = step.def.skip;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Passo {position} de {total}
          </p>
          <p className="text-base font-semibold leading-snug">{step.title}</p>
        </div>
        <button
          type="button"
          onClick={onStop}
          aria-label="Sair do guia"
          className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{step.content}</p>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${(position / total) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {skip ? (
          <Button variant="ghost" size="sm" onClick={() => onSkipTo(skip.to)}>
            {skip.label}
          </Button>
        ) : null}
        {advance.on === "next" ? (
          <Button size="sm" onClick={onNext}>
            {position === total ? "Concluir" : "Próximo"}
          </Button>
        ) : (
          <p className="text-xs font-medium text-primary">{WAITING_LABEL[advance.on]}</p>
        )}
      </div>
    </div>
  );
}
```

`src/components/onboarding/tour-card.tsx`:

```tsx
"use client";

import type { CardComponentProps } from "nextstepjs";
import { useTourRunner } from "./runner-context";
import { TourCardBody } from "./tour-card-body";

export function TourCard({ arrow }: CardComponentProps) {
  const runner = useTourRunner();
  const step = runner.steps[runner.index];
  if (!step) return null;

  return (
    <div className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 text-card-foreground shadow-xl">
      <TourCardBody
        step={step}
        position={runner.index + 1}
        total={runner.steps.length}
        onNext={runner.next}
        onSkipTo={runner.skipTo}
        onStop={runner.stop}
      />
      <div className="text-card">{arrow}</div>
    </div>
  );
}
```

`src/components/onboarding/inline-hint.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { BuiltStep } from "@/lib/onboarding/build-tour";
import { cn } from "@/lib/utils";
import { useTourRunner } from "./runner-context";
import { TourCardBody } from "./tour-card-body";

export function InlineHint({ step }: { step: BuiltStep }) {
  const runner = useTourRunner();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const viewport = step.def.viewport;

  useEffect(() => {
    setHost(viewport ? document.getElementById(viewport) : document.body);
  }, [viewport]);

  if (!host) return null;

  return createPortal(
    <div
      key={step.def.id}
      className={cn(
        "z-[70] rounded-2xl border bg-card p-4 text-card-foreground shadow-xl duration-300 animate-in fade-in slide-in-from-bottom-4",
        viewport
          ? "sticky bottom-0 mt-2"
          : "fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] mx-auto max-w-sm md:inset-x-auto md:bottom-6 md:right-6 md:w-80",
      )}
    >
      <TourCardBody
        step={step}
        position={runner.index + 1}
        total={runner.steps.length}
        onNext={runner.next}
        onSkipTo={runner.skipTo}
        onStop={runner.stop}
      />
    </div>,
    host,
  );
}
```

- [ ] **Step 5: Criar o `TourRunner`**

`src/components/onboarding/tour-runner.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NextStep, NextStepProvider, useNextStep, type TourWithCustomCard } from "nextstepjs";
import { APP_TOUR } from "@/lib/onboarding/app-tour";
import { buildSteps, stepIndexById, usesSpotlight, type Viewport } from "@/lib/onboarding/build-tour";
import { MISSIONS, isRouteOfMission } from "@/lib/onboarding/missions";
import { waitFor } from "@/lib/onboarding/wait-for";
import { findTarget } from "./find-target";
import { InlineHint } from "./inline-hint";
import { useOnboarding, type TourRun } from "./onboarding-context";
import { RunnerContext, type RunnerValue } from "./runner-context";
import { TourCard } from "./tour-card";

const TOUR_NAME = "onboarding";
const TARGET_TIMEOUT_MS = 8000;
const OPTIONAL_TIMEOUT_MS = 1500;
const FINAL_POLLS = 10;
const DESKTOP_QUERY = "(min-width: 768px)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() =>
    window.matchMedia(DESKTOP_QUERY).matches ? "desktop" : "mobile",
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setViewport(query.matches ? "desktop" : "mobile");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return viewport;
}

export function TourRunner({ run }: { run: TourRun }) {
  return (
    <NextStepProvider>
      <Controller run={run} />
    </NextStepProvider>
  );
}

function Controller({ run }: { run: TourRun }) {
  const onboarding = useOnboarding();
  const onboardingRef = useRef(onboarding);
  onboardingRef.current = onboarding;
  const viewport = useViewport();
  const pathname = usePathname();
  const { startNextStep, setCurrentStep, closeNextStep } = useNextStep();
  const mission = run.kind === "mission" ? MISSIONS[run.missionId] : null;
  const [index, setIndex] = useState(-1);
  const token = useRef(0);
  const spotlightOn = useRef(false);
  const arrived = useRef(false);
  const { model, examples, missionsPreviewable } = onboarding;

  const steps = useMemo(
    () =>
      buildSteps(mission ? mission.steps : APP_TOUR, {
        model,
        viewport,
        examples,
        missionsVisible: missionsPreviewable,
      }),
    [mission, model, viewport, examples, missionsPreviewable],
  );

  const tours = useMemo<TourWithCustomCard[]>(
    () => [
      {
        tour: TOUR_NAME,
        steps: steps.map((step) => ({
          title: step.title,
          content: step.content,
          selector: step.selector,
          side: step.side,
          pointerPadding: 8,
          pointerRadius: 14,
          blockKeyboardControl: true,
          selectorRetryAttempts: 5,
          scrollOffset: 96,
        })),
      },
    ],
    [steps],
  );

  const leave = useCallback(() => {
    if (run.kind === "app") void onboardingRef.current.finishAppTour();
    else onboardingRef.current.pauseRun();
  }, [run.kind]);

  const goTo = useCallback(
    async (target: number) => {
      token.current += 1;
      const current = token.current;
      let next = target;
      while (next < steps.length) {
        const step = steps[next];
        const found = await waitFor(() => findTarget(step.selector) !== null, {
          timeoutMs: step.def.optional ? OPTIONAL_TIMEOUT_MS : TARGET_TIMEOUT_MS,
        });
        if (current !== token.current) return;
        if (found) break;
        if (!step.def.optional) {
          leave();
          return;
        }
        next += 1;
      }
      if (next >= steps.length) {
        if (run.kind === "app") void onboardingRef.current.finishAppTour();
        else onboardingRef.current.stopRun();
        return;
      }
      setIndex(next);
    },
    [steps, leave, run.kind],
  );

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const confirmFinal = useCallback(async () => {
    if (run.kind !== "mission") return;
    const current = token.current;
    for (let attempt = 0; attempt < FINAL_POLLS; attempt += 1) {
      await sleep(1000);
      if (current !== token.current) return;
      const progress = await onboardingRef.current.refresh();
      if (progress?.[run.missionId]) return;
    }
  }, [run]);

  useEffect(() => {
    void goToRef.current(0);
  }, []);

  useEffect(
    () => () => {
      token.current += 1;
      closeNextStep();
    },
    [closeNextStep],
  );

  useEffect(() => {
    if (!mission) {
      if (pathname !== "/dashboard") leave();
      return;
    }
    if (isRouteOfMission(pathname, mission)) {
      arrived.current = true;
      return;
    }
    if (arrived.current) leave();
  }, [pathname, mission, leave]);

  useEffect(() => {
    if (index < 0 || index >= steps.length) return;
    const step = steps[index];

    if (usesSpotlight(step)) {
      if (!spotlightOn.current) {
        startNextStep(TOUR_NAME);
        spotlightOn.current = true;
      }
      setCurrentStep(index);
    } else if (spotlightOn.current) {
      closeNextStep();
      spotlightOn.current = false;
    }

    const element = findTarget(step.selector);
    element?.setAttribute("data-tour-active", "");
    const cleanups: Array<() => void> = [() => element?.removeAttribute("data-tour-active")];
    const advance = step.def.advance;

    if (advance.on === "click" && element) {
      const onClick = () => {
        if (advance.final) void confirmFinal();
        else void goTo(index + 1);
      };
      element.addEventListener("click", onClick);
      cleanups.push(() => element.removeEventListener("click", onClick));
    }

    if (advance.on === "until" || advance.on === "await") {
      const abort = new AbortController();
      void waitFor(() => document.querySelector(advance.until) !== null, {
        timeoutMs: Number.POSITIVE_INFINITY,
        signal: abort.signal,
      }).then((ok) => {
        if (ok) void goTo(index + 1);
      });
      cleanups.push(() => abort.abort());
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [index, steps, startNextStep, setCurrentStep, closeNextStep, goTo, confirmFinal]);

  const runner = useMemo<RunnerValue>(
    () => ({
      steps,
      index,
      next: () => void goTo(index + 1),
      skipTo: (id: string) => {
        const target = stepIndexById(steps, id);
        if (target >= 0) void goTo(target);
      },
      stop: leave,
    }),
    [steps, index, goTo, leave],
  );

  const current = index >= 0 ? steps[index] : undefined;

  return (
    <RunnerContext.Provider value={runner}>
      <NextStep
        steps={tours}
        cardComponent={TourCard}
        shadowRgb="20, 18, 15"
        shadowOpacity="0.62"
        cardTransition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
        scrollToTop={false}
        disableConsoleLogs
      >
        <></>
      </NextStep>
      {current && !usesSpotlight(current) ? <InlineHint step={current} /> : null}
    </RunnerContext.Provider>
  );
}
```

- [ ] **Step 6: Renderizar o runner no provider**

Em `src/components/onboarding/onboarding-provider.tsx`, acrescente o import e a constante logo abaixo dos imports:

```tsx
import dynamic from "next/dynamic";
```

```tsx
const TourRunner = dynamic(() => import("./tour-runner").then((mod) => mod.TourRunner), { ssr: false });
```

E troque o `return` final por:

```tsx
  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {run ? <TourRunner key={run.kind === "app" ? "app" : run.missionId} run={run} /> : null}
    </OnboardingContext.Provider>
  );
```

- [ ] **Step 7: Alvos da navegação, do cabeçalho e do Painel**

`src/components/layout/bottom-nav.tsx`: acrescente `tour: string;` ao tipo `NavItem` e o campo em cada item:

```tsx
const leftItems: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard, tour: "nav-dashboard" },
  { href: "/sales", label: "Vendas", icon: ShoppingCart, tour: "nav-sales" },
];

const rightItems: NavItem[] = [
  { href: "/customers", label: "Clientes", icon: Users, tour: "nav-customers" },
  {
    href: "/more",
    label: "Ajustes",
    icon: Menu,
    tour: "nav-more",
    extraPrefixes: ["/production", "/stock", "/purchases", "/admin", "/workspaces"],
  },
];
```

No `NavLink`, troque `const { href, label, icon: Icon, extraPrefixes } = item;` por `const { href, label, icon: Icon, extraPrefixes, tour } = item;` e acrescente `data-tour={tour}` ao `<Link>`. No `<Link href="/sales/new" aria-label="Nova venda" …>` do botão central, acrescente `data-tour="nav-sell"`.

`src/components/layout/side-nav.tsx`: acrescente `tour: string;` ao `NavItem` e troque a lista:

```tsx
const items: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard, tour: "side-dashboard" },
  { href: "/dashboard/consolidated", label: "Consolidado", icon: Building2, tour: "side-consolidated" },
  { href: "/sales", label: "Vendas", icon: ShoppingCart, tour: "side-sales" },
  { href: "/customers", label: "Clientes", icon: Users, tour: "side-customers" },
  { href: "/production", label: "Produção", icon: Factory, tour: "side-production" },
  { href: "/stock", label: "Estoque", icon: Package, tour: "side-stock" },
  { href: "/purchases", label: "Compras", icon: ShoppingBag, tour: "side-purchases" },
  { href: "/admin/catalog", label: "Catálogo", icon: Tags, adminOnly: true, tour: "side-catalog" },
  { href: "/admin", label: "Configurações", icon: Settings, adminOnly: true, tour: "side-admin" },
];
```

No `visibleItems.map(({ href, label, icon: Icon }) => {`, troque por `visibleItems.map(({ href, label, icon: Icon, tour }) => {` e acrescente `data-tour={tour}` ao `<Link>`.

`src/components/shared/page-header.tsx`: acrescente `tourId,` à desestruturação, `tourId?: string;` ao tipo e troque `<div className="mb-5">` por `<div className="mb-5" data-tour={tourId}>`.

`src/app/(app)/dashboard/page.tsx`: no `<PageHeader title="Painel" …>`, acrescente `tourId="dashboard-header"`; no `<Link href="/sales/new">` dentro do `action`, acrescente `data-tour="dashboard-new-sale"`.

- [ ] **Step 8: Anel pulsante no CSS**

No fim de `src/app/globals.css`, acrescente:

```css
[data-tour-active] {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 3px;
  animation: tour-ring 1.6s ease-out infinite;
}

@keyframes tour-ring {
  0% {
    outline-offset: 2px;
    outline-color: hsl(var(--primary) / 0.9);
  }
  100% {
    outline-offset: 12px;
    outline-color: hsl(var(--primary) / 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-tour-active] {
    animation: none;
  }
}
```

- [ ] **Step 9: Checar tipos, lint e testes**

Run: `pnpm exec tsc --noEmit && pnpm exec next lint && pnpm test`
Expected: sem erros. Se o `tsc` acusar diferença na API do nextstepjs (por exemplo, o nome de `TourWithCustomCard` ou de `CardComponentProps`), abra `node_modules/nextstepjs/dist/types/index.d.ts` e ajuste o nome importado; os campos usados aqui existem na 2.3.0.

- [ ] **Step 10: Verificar no navegador (também valida o holofote)**

1. Zere o tour do usuário de teste: `docker exec cookies_db psql -U cookies -d cookies -c "UPDATE \"user\" SET \"appTourCompletedAt\" = NULL WHERE email = '<email do usuário de teste>'"`.
2. Preview `cookies-dev`, abra `/dashboard` em 375 px (`resize_window` preset `mobile`, depois recarregue). O tour começa sozinho: holofote no cabeçalho com "Boas-vindas …", depois "Vender" (botão central), Vendas, Clientes, Ajustes. Cada passo aparece direto no índice certo, sem piscar o primeiro passo. O anel pulsa no alvo.
3. "Próximo" no último passo, ou o "×", fecha o tour; recarregar o Painel não reabre; `appTourCompletedAt` está preenchido.
4. Repita em desktop (`resize_window` preset `desktop`): os passos apontam para a barra lateral, com o balão à direita.
5. Se o workspace de teste tiver setor e o usuário for dono, a parada "Seus primeiros passos" espera o card, que só existe na Tarefa 8: o tour fecha sozinho após 8 s nesse ponto. É esperado até a próxima tarefa.
6. `read_console_messages` sem erros. Tire um `screenshot` de um passo no celular como prova.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/onboarding/wait-for.ts src/lib/onboarding/wait-for.test.ts src/components/onboarding src/components/layout/bottom-nav.tsx src/components/layout/side-nav.tsx src/components/shared/page-header.tsx "src/app/(app)/dashboard/page.tsx" src/app/globals.css
git commit -m "feat(onboarding): motor do tour com holofote e tour de apresentação"
```

---

### Task 8: Card de missões, bolha, convite de setor e comemoração

**Files:**
- Create: `src/components/onboarding/missions-list.tsx`
- Create: `src/components/onboarding/dismiss-dialog.tsx`
- Create: `src/components/onboarding/missions-dialog.tsx`
- Create: `src/components/onboarding/sector-prompt-card.tsx`
- Create: `src/components/onboarding/onboarding-card.tsx`
- Create: `src/components/onboarding/onboarding-bubble.tsx`
- Create: `src/components/onboarding/celebration.tsx`
- Modify: `src/components/onboarding/onboarding-provider.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `useOnboarding` (Task 6), `SectorPicker` (Task 5), `shouldShowSectorPrompt` (Task 2), `MISSIONS`, `useIsFormRoute` de `@/components/layout/bottom-nav`, `timing` de `@/components/pwa/guide-parts`.
- Produces: `OnboardingCard()` (com `data-tour="onboarding-card"`), `OnboardingBubble()`, `Celebration()`, `MissionsDialog({ open, onOpenChange })`, `DismissOnboardingDialog({ open, onOpenChange })`, `MissionsList({ onStart? })`, `SectorPromptCard()`.

- [ ] **Step 1: Lista de missões e confirmação do "×"**

`src/components/onboarding/missions-list.tsx`:

```tsx
"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timing } from "@/components/pwa/guide-parts";
import { cn } from "@/lib/utils";
import { useOnboarding } from "./onboarding-context";

export function MissionsList({ onStart }: { onStart?: () => void }) {
  const onboarding = useOnboarding();
  const progress = onboarding.state.progress;

  return (
    <ul className="space-y-1">
      {onboarding.missions.map((mission, index) => {
        const done = progress?.[mission.id] ?? false;
        const isNext = onboarding.nextMission?.id === mission.id;
        return (
          <li
            key={mission.id}
            className={cn("pwa-fade flex items-center gap-3 rounded-lg p-2", isNext && "bg-primary/5")}
            style={timing(index * 0.06)}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                done ? "border-success bg-success text-success-foreground" : "border-border",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>
                {onboarding.text(mission.title)}
              </p>
              {!done ? <p className="text-xs text-muted-foreground">{onboarding.text(mission.description)}</p> : null}
            </div>
            {!done ? (
              <Button
                size="sm"
                variant={isNext ? "default" : "outline"}
                onClick={() => {
                  onStart?.();
                  onboarding.startMission(mission.id);
                }}
              >
                {onboarding.pausedMissionId === mission.id ? "Continuar" : "Fazer"}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
```

`src/components/onboarding/dismiss-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOnboarding } from "./onboarding-context";

export function DismissOnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const onboarding = useOnboarding();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Esconder os primeiros passos?</DialogTitle>
          <DialogDescription>
            O card e o atalho somem. Você pode retomar quando quiser em Ajustes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Manter
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              void onboarding.dismiss();
            }}
          >
            Esconder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/onboarding/missions-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DismissOnboardingDialog } from "./dismiss-dialog";
import { MissionsList } from "./missions-list";
import { useOnboarding } from "./onboarding-context";

export function MissionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const onboarding = useOnboarding();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { done, total } = onboarding.counts;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bottom-0 top-auto max-h-[85dvh] translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-top-[100%] data-[state=open]:slide-in-from-top-[100%] sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle>Primeiros passos</DialogTitle>
            <DialogDescription>
              {done} de {total} concluídas
            </DialogDescription>
          </DialogHeader>
          <MissionsList onStart={() => onOpenChange(false)} />
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="mx-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Esconder primeiros passos
          </button>
        </DialogContent>
      </Dialog>
      <DismissOnboardingDialog
        open={confirmOpen}
        onOpenChange={(value) => {
          setConfirmOpen(value);
          if (!value && onboarding.state.dismissed) onOpenChange(false);
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Convite de setor e card do Painel**

`src/components/onboarding/sector-prompt-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SectorKey } from "@/lib/onboarding/sectors";
import { shouldShowSectorPrompt } from "@/lib/onboarding/visibility";
import { DismissOnboardingDialog } from "./dismiss-dialog";
import { useOnboarding } from "./onboarding-context";
import { SectorPicker } from "./sector-picker";

export function SectorPromptCard() {
  const onboarding = useOnboarding();
  const [sector, setSector] = useState<SectorKey | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!shouldShowSectorPrompt(onboarding.state)) return null;

  return (
    <section className="mb-5 space-y-4 rounded-2xl border border-primary/30 bg-card p-4 shadow-sm duration-500 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Conte qual é o seu ramo</h2>
          <p className="text-xs text-muted-foreground">
            Assim mostramos os primeiros passos certos e o que ainda dá para aproveitar no app.
          </p>
        </div>
        <button
          type="button"
          aria-label="Esconder"
          onClick={() => setConfirmOpen(true)}
          className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      <SectorPicker value={sector} onChange={setSector} disabled={pending} className="sm:grid-cols-3 lg:grid-cols-5" />
      <Button
        className="w-full sm:w-auto"
        disabled={!sector || pending}
        onClick={() => {
          if (!sector) return;
          startTransition(async () => {
            await onboarding.chooseSector(sector);
          });
        }}
      >
        {pending ? "Salvando..." : "Ver meus primeiros passos"}
      </Button>
      <DismissOnboardingDialog open={confirmOpen} onOpenChange={setConfirmOpen} />
    </section>
  );
}
```

`src/components/onboarding/onboarding-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DismissOnboardingDialog } from "./dismiss-dialog";
import { MissionsDialog } from "./missions-dialog";
import { useOnboarding } from "./onboarding-context";
import { SectorPromptCard } from "./sector-prompt-card";

export function OnboardingCard() {
  const onboarding = useOnboarding();
  const [listOpen, setListOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!onboarding.missionsVisible) return <SectorPromptCard />;

  const next = onboarding.nextMission;
  if (!next) return null;

  const { done, total } = onboarding.counts;
  const position = onboarding.missions.findIndex((mission) => mission.id === next.id) + 1;
  const paused = onboarding.pausedMissionId === next.id;

  return (
    <section
      data-tour="onboarding-card"
      className="mb-5 rounded-2xl border border-primary/30 bg-card p-4 shadow-sm duration-500 animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Primeiros passos</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{total}
          </span>
        </div>
        <button
          type="button"
          aria-label="Esconder primeiros passos"
          onClick={() => setConfirmOpen(true)}
          className="-m-1 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <div key={next.id} className="mt-4 flex items-center gap-3 duration-500 animate-in fade-in slide-in-from-right-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{onboarding.text(next.title)}</p>
          <p className="text-xs text-muted-foreground">{onboarding.text(next.description)}</p>
        </div>
        <Button size="sm" onClick={() => onboarding.startMission(next.id)}>
          {paused ? "Continuar" : "Fazer"}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setListOpen(true)}
        className="mt-3 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        Ver todas as {total} missões
      </button>
      <MissionsDialog open={listOpen} onOpenChange={setListOpen} />
      <DismissOnboardingDialog open={confirmOpen} onOpenChange={setConfirmOpen} />
    </section>
  );
}
```

- [ ] **Step 3: Bolha e comemoração**

`src/components/onboarding/onboarding-bubble.tsx`:

```tsx
"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useIsFormRoute } from "@/components/layout/bottom-nav";
import { MissionsDialog } from "./missions-dialog";
import { useOnboarding } from "./onboarding-context";

export function OnboardingBubble() {
  const onboarding = useOnboarding();
  const pathname = usePathname();
  const isFormRoute = useIsFormRoute();
  const [open, setOpen] = useState(false);

  if (!onboarding.missionsVisible || onboarding.run || pathname === "/dashboard" || isFormRoute) return null;

  const { done, total } = onboarding.counts;
  const degrees = total > 0 ? (done / total) * 360 : 0;

  return (
    <>
      <button
        type="button"
        aria-label={`Primeiros passos: ${done} de ${total}`}
        onClick={() => setOpen(true)}
        className="pwa-pop fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 md:bottom-6 md:right-6"
        style={{
          backgroundImage: `conic-gradient(hsl(var(--primary)) ${degrees}deg, hsl(var(--muted)) 0deg)`,
        }}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-card text-xs font-semibold tabular-nums">
          {done}/{total}
        </span>
      </button>
      <MissionsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
```

`src/components/onboarding/celebration.tsx`:

```tsx
"use client";

import { useEffect, type CSSProperties } from "react";
import { Check, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MISSIONS } from "@/lib/onboarding/missions";
import { useOnboarding } from "./onboarding-context";

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--warning))", "hsl(var(--success))"];
const PIECE_COUNT = 28;
const PIECES = Array.from({ length: PIECE_COUNT }, (_, i) => {
  const angle = (i / PIECE_COUNT) * Math.PI * 2;
  const distance = 120 + (i % 5) * 28;
  return {
    x: Math.round(Math.cos(angle) * distance),
    y: Math.round(Math.sin(angle) * distance - 40),
    rotation: (i * 47) % 360,
    delay: (i % 7) * 0.03,
    color: COLORS[i % COLORS.length],
  };
});

export function Celebration() {
  const onboarding = useOnboarding();
  const { celebrating, clearCelebration } = onboarding;

  useEffect(() => {
    if (celebrating?.kind !== "mission") return;
    const timer = setTimeout(clearCelebration, 2600);
    return () => clearTimeout(timer);
  }, [celebrating, clearCelebration]);

  if (!celebrating) return null;

  const all = celebrating.kind === "all";
  const title = all ? "Tudo pronto!" : "Missão concluída!";
  const subtitle = all
    ? "Seu negócio está montado no app. Agora é só vender."
    : onboarding.text(MISSIONS[celebrating.missionId].title);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-6">
      <div className="relative">
        {PIECES.map((piece, i) => (
          <span
            key={i}
            className="tour-confetti"
            style={
              {
                "--x": `${piece.x}px`,
                "--y": `${piece.y}px`,
                "--r": `${piece.rotation}deg`,
                "--delay": `${piece.delay}s`,
                background: piece.color,
              } as CSSProperties
            }
          />
        ))}
        <div className="pwa-pop pointer-events-auto w-72 rounded-2xl border bg-card p-5 text-center shadow-2xl">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success text-success-foreground">
            {all ? <PartyPopper className="size-6" /> : <Check className="size-6" strokeWidth={3} />}
          </span>
          <p className="mt-3 text-lg font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {all ? (
            <Button className="mt-4 w-full" onClick={clearCelebration}>
              Começar a usar
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

No fim de `src/app/globals.css`, acrescente:

```css
.tour-confetti {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 12px;
  border-radius: 2px;
  opacity: 0;
  animation: tour-confetti 1.3s cubic-bezier(0.2, 0.7, 0.4, 1) var(--delay, 0s) forwards;
}

@keyframes tour-confetti {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) rotate(0deg) scale(0.6);
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) rotate(var(--r)) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tour-confetti {
    display: none;
  }
}
```

- [ ] **Step 4: Ligar no provider e no Painel**

Em `src/components/onboarding/onboarding-provider.tsx`, importe:

```tsx
import { Celebration } from "./celebration";
import { OnboardingBubble } from "./onboarding-bubble";
```

E troque o `return` por:

```tsx
  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <OnboardingBubble />
      <Celebration />
      {run ? <TourRunner key={run.kind === "app" ? "app" : run.missionId} run={run} /> : null}
    </OnboardingContext.Provider>
  );
```

Em `src/app/(app)/dashboard/page.tsx`, importe `import { OnboardingCard } from "@/components/onboarding/onboarding-card";` e coloque `<OnboardingCard />` logo depois do `<PageHeader … />` e antes de `<DashboardFilters`.

- [ ] **Step 5: Checar tipos, lint e testes**

Run: `pnpm exec tsc --noEmit && pnpm exec next lint && pnpm test`
Expected: sem erros.

- [ ] **Step 6: Verificar no navegador**

Com um workspace de teste de setor `roupas` (`UPDATE workspace SET sector = 'roupas' WHERE …`) e o usuário dono:
1. Zere o tour e abra `/dashboard` em 375 px: o tour termina com o holofote no card "Primeiros passos" (parada 6). Depois do tour, o card mostra "1 Monte seu produto no catálogo" e 0/4.
2. "Ver todas as 4 missões" abre a gaveta por baixo, com animação de entrada de cada linha.
3. Em `/sales`, a bolha "0/4" aparece acima da navegação; ela some em `/sales/new` e no Painel.
4. Cadastre um cliente em `/customers` (fora do guia) e volte ao Painel: a comemoração "Missão concluída!" aparece com confete, e o card mostra 1/4.
5. O "×" pede confirmação; "Esconder" some com card e bolha; em Ajustes, "Retomar primeiros passos" traz de volta.
6. Mude o workspace para `sector = NULL`: o Painel mostra "Conte qual é o seu ramo"; escolher "Revenda em geral" mostra as missões, com Cliente já marcado e sem comemoração.
7. Em desktop, a bolha fica no canto inferior direito. `read_console_messages` sem erros. Tire `screenshot` do card e da comemoração.

- [ ] **Step 7: Commit**

```bash
git add src/components/onboarding "src/app/(app)/dashboard/page.tsx" src/app/globals.css
git commit -m "feat(onboarding): card de primeiros passos, bolha de progresso, convite de setor e comemoração"
```

---

### Task 9: Missão do catálogo e guia de variações com os exemplos do setor

**Files:**
- Create: `src/lib/onboarding/guide-example.ts`
- Test: `src/lib/onboarding/guide-example.test.ts`
- Modify: `src/components/catalog/variations-guide.tsx`
- Modify: `src/components/catalog/product-editor.tsx`
- Modify: `src/components/catalog/options-editor.tsx`
- Modify: `src/components/catalog/combinations-list.tsx`
- Modify: `src/components/onboarding/tour-runner.tsx`

**Interfaces:**
- Consumes: `Axis` (Task 1), `useOptionalOnboarding` (Task 6), `TourRunner` (Task 7).
- Produces:
  - `type GuideExample = { produto: string; eixos: [Axis, Axis] }`, `DEFAULT_GUIDE_EXAMPLE`, `guideCombos(example): { name: string; on: boolean }[]`, `guidePricingRows(example): { name: string; price: string; usesDefault?: boolean; pauses?: boolean }[]`
  - `VariationsGuideDialog({ open, onOpenChange, example })` exportado de `variations-guide.tsx`; `VariationsGuide()` continua exportado, sem props.
  - Alvos: `product-name` (com `data-filled`), `product-price`, `add-variation`, `option-name` (com `data-filled`), `option-values` (com `data-count`), `combinations` (com `data-checked`), `combination-details`, `product-save`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/onboarding/guide-example.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_GUIDE_EXAMPLE, guideCombos, guidePricingRows } from "./guide-example";
import { getSector } from "./sectors";

describe("guia de variações", () => {
  it("mantém o exemplo atual do Brownie como padrão", () => {
    expect(guideCombos(DEFAULT_GUIDE_EXAMPLE)).toEqual([
      { name: "Nutella · Mini", on: true },
      { name: "Nutella · Tradicional", on: true },
      { name: "Doce de leite · Mini", on: true },
      { name: "Doce de leite · Tradicional", on: true },
      { name: "Ninho · Mini", on: false },
      { name: "Ninho · Tradicional", on: true },
    ]);
    expect(guidePricingRows(DEFAULT_GUIDE_EXAMPLE)).toEqual([
      { name: "Nutella · Tradicional", price: "R$ 14,00" },
      { name: "Nutella · Mini", price: "R$ 0,00", usesDefault: true },
      { name: "Ninho · Tradicional", price: "R$ 15,00", pauses: true },
    ]);
  });

  it("monta as combinações com os eixos do setor", () => {
    const roupas = getSector("roupas").examples;
    const combos = guideCombos(roupas);
    expect(combos.map((c) => c.name)).toEqual(["P · Azul", "P · Verde", "M · Azul", "M · Verde", "G · Azul", "G · Verde"]);
    expect(combos.filter((c) => !c.on).map((c) => c.name)).toEqual(["G · Azul"]);
    expect(guidePricingRows(roupas).map((r) => r.name)).toEqual(["P · Verde", "P · Azul", "G · Verde"]);
  });
});
```

Run: `pnpm exec vitest run src/lib/onboarding/guide-example.test.ts`
Expected: FAIL com "Failed to resolve import "./guide-example"".

- [ ] **Step 2: Implementar `guide-example.ts`**

```ts
import type { Axis } from "./sectors";

export type GuideExample = { produto: string; eixos: [Axis, Axis] };

export type GuideCombo = { name: string; on: boolean };

export type GuidePriceRow = { name: string; price: string; usesDefault?: boolean; pauses?: boolean };

export const DEFAULT_GUIDE_EXAMPLE: GuideExample = {
  produto: "Brownie",
  eixos: [
    { nome: "Sabor", opcoes: ["Nutella", "Doce de leite", "Ninho"] },
    { nome: "Tamanho", opcoes: ["Mini", "Tradicional"] },
  ],
};

export function guideCombos(example: GuideExample): GuideCombo[] {
  const [first, second] = example.eixos;
  const names = first.opcoes.flatMap((a) => second.opcoes.map((b) => `${a} · ${b}`));
  const off = names.length - 2;
  return names.map((name, index) => ({ name, on: index !== off }));
}

export function guidePricingRows(example: GuideExample): GuidePriceRow[] {
  const combos = guideCombos(example);
  return [
    { name: combos[1].name, price: "R$ 14,00" },
    { name: combos[0].name, price: "R$ 0,00", usesDefault: true },
    { name: combos[combos.length - 1].name, price: "R$ 15,00", pauses: true },
  ];
}
```

Run: `pnpm exec vitest run src/lib/onboarding/guide-example.test.ts`
Expected: PASS.

- [ ] **Step 3: Parametrizar o `VariationsGuide`**

Em `src/components/catalog/variations-guide.tsx`:

1. Troque o import de React por `import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";` e acrescente:

```tsx
import { useOptionalOnboarding } from "@/components/onboarding/onboarding-context";
import { DEFAULT_GUIDE_EXAMPLE, guideCombos, guidePricingRows, type GuideExample } from "@/lib/onboarding/guide-example";
```

2. Substitua a função `SceneVersions` inteira por:

```tsx
function SceneVersions({ example }: { example: GuideExample }) {
  const [axis] = example.eixos;
  const versions = axis.opcoes.slice(0, 3);
  const anchors = versions.length === 2 ? [96, 192] : [48, 144, 240];
  return (
    <div className="w-full max-w-72">
      <div
        className="pwa-pop mx-auto flex w-40 items-center gap-2 rounded-xl border bg-card p-2.5 shadow-sm"
        style={timing(0.1)}
      >
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
          <Package className="size-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-semibold">{example.produto}</p>
          <p className="text-[10px] text-muted-foreground">1 produto</p>
        </div>
      </div>
      <svg viewBox="0 0 288 44" className="h-11 w-full overflow-visible" aria-hidden>
        {anchors.map((x, i) => (
          <path
            key={x}
            d={`M144 2 C144 24, ${x} 18, ${x} 42`}
            pathLength={1}
            className="pwa-draw fill-none stroke-primary/60"
            strokeWidth={2}
            strokeLinecap="round"
            style={timing(0.6 + i * 0.12, 0.6)}
          />
        ))}
      </svg>
      <div className={cn("grid gap-2", versions.length === 2 ? "grid-cols-2 px-12" : "grid-cols-3")}>
        {versions.map((version, i) => (
          <div
            key={version}
            className="pwa-pop flex h-14 flex-col items-center justify-center rounded-lg border bg-card px-1 text-center"
            style={timing(1.2 + i * 0.2)}
          >
            <span className="text-[10px] text-muted-foreground">{axis.nome}</span>
            <span className="text-[11px] font-semibold leading-tight">{version}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

3. Substitua `SceneTypes` por:

```tsx
function SceneTypes({ example }: { example: GuideExample }) {
  const [first, second] = example.eixos;
  return (
    <div className="w-full max-w-72 space-y-2.5">
      <OptionBlock name={first.nome} values={first.opcoes} delay={0.1} />
      <OptionBlock name={second.nome} values={second.opcoes} delay={1.5} />
    </div>
  );
}
```

4. Apague a constante `const combos = [...]` e substitua `SceneCombinations` por:

```tsx
function SceneCombinations({ example }: { example: GuideExample }) {
  const [first, second] = example.eixos;
  const combos = guideCombos(example);
  return (
    <div className="w-full max-w-72 space-y-2">
      <p className="pwa-fade text-center text-[11px] text-muted-foreground" style={timing(0.1)}>
        {first.opcoes.length} de {first.nome} × {second.opcoes.length} de {second.nome} ={" "}
        <span className="font-semibold text-foreground">{combos.length} combinações</span>
      </p>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {combos.map(({ name, on }, i) => (
          <li
            key={name}
            className={cn("pwa-fade flex items-center gap-2 px-2.5 py-1.5", !on && "text-muted-foreground")}
            style={timing(0.3 + i * 0.12)}
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                on ? "border-primary bg-primary" : "border-muted-foreground/50",
              )}
            >
              {on && (
                <Check
                  className="pwa-pop size-2.5 text-primary-foreground"
                  strokeWidth={4}
                  style={timing(1.3 + i * 0.15)}
                />
              )}
            </span>
            <span className="text-[11px] font-medium">{name}</span>
            {!on && (
              <span className="pwa-fade ml-auto text-[10px]" style={timing(2.4)}>
                não vendo
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

5. Em `ScenePricing`, troque a assinatura para `function ScenePricing({ example }: { example: GuideExample })`, troque o array `const rows = [...]` por `const rows = guidePricingRows(example);` e o texto `Ficha: Brownie` por `Ficha: {example.produto}`. O resto do JSX fica igual.

6. Substitua tudo de `const steps: …` até o fim do arquivo por:

```tsx
type GuideStep = {
  title: string;
  description: string;
  Scene: (props: { example: GuideExample }) => ReactNode;
};

function stepsFor(example: GuideExample): GuideStep[] {
  const [first, second] = example.eixos;
  return [
    {
      title: "Um produto, várias versões",
      description: `Use variações quando o mesmo produto sai em versões diferentes, como ${first.nome.toLowerCase()} ou ${second.nome.toLowerCase()}. Fica tudo num produto só, em vez de cadastrar um para cada.`,
      Scene: SceneVersions,
    },
    {
      title: "Tipos e opções",
      description: `O tipo é o que muda (${first.nome}, ${second.nome}). As opções são as escolhas de cada tipo. Dá para criar até 3 tipos por produto.`,
      Scene: SceneTypes,
    },
    {
      title: "Marque o que você vende",
      description: "O app cruza as opções de cada tipo e monta as combinações. Marque só as que você realmente vende.",
      Scene: SceneCombinations,
    },
    {
      title: "Preço, ficha e estoque próprios",
      description:
        "Cada combinação tem preço, ficha técnica e estoque próprios. Deixe R$ 0,00 para usar o preço padrão e pause o que estiver em falta: some da venda sem perder o histórico.",
      Scene: ScenePricing,
    },
  ];
}

export function VariationsGuideDialog({
  open,
  onOpenChange,
  example,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  example: GuideExample;
}) {
  const steps = useMemo(() => stepsFor(example), [example]);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const last = step === steps.length - 1;
  const { title, description, Scene } = steps[step];

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  function go(next: number) {
    setStep(Math.max(0, Math.min(steps.length - 1, next)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl">
        <div
          className="relative flex h-[min(52dvh,370px)] select-none items-center justify-center bg-secondary/60 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:14px_14px] px-5 pb-4 pt-9"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
        >
          <div className="absolute inset-x-4 top-4 flex gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => go(i)}
                aria-label={`Ir para o passo ${i + 1}`}
                className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"
              >
                <span
                  key={i === step ? `active-${step}` : i}
                  className={cn(
                    "block h-full rounded-full bg-primary",
                    i < step && "w-full",
                    i > step && "w-0",
                    i === step && "pwa-progress",
                  )}
                  style={
                    i === step
                      ? ({
                          "--dur": `${STEP_MS}ms`,
                          animationPlayState: paused ? "paused" : "running",
                        } as CSSProperties)
                      : undefined
                  }
                  onAnimationEnd={() => {
                    if (i === step && !last) go(step + 1);
                  }}
                />
              </button>
            ))}
          </div>
          <div key={step} className="pwa-scene flex w-full justify-center" aria-hidden>
            <Scene example={example} />
          </div>
        </div>

        <div className="space-y-4 border-t bg-background p-5">
          <div key={step} className="space-y-1.5 duration-500 animate-in fade-in slide-in-from-bottom-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Passo {step + 1} de {steps.length}
            </p>
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription className="leading-relaxed">{description}</DialogDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => go(step - 1)} disabled={step === 0}>
              Voltar
            </Button>
            {last ? (
              <Button className="flex-1" onClick={() => onOpenChange(false)}>
                Entendi
              </Button>
            ) : (
              <Button className="flex-1" onClick={() => go(step + 1)}>
                Próximo
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VariationsGuide() {
  const onboarding = useOptionalOnboarding();
  const [open, setOpen] = useState(false);
  const example = onboarding?.state.sector ? onboarding.examples : DEFAULT_GUIDE_EXAMPLE;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-m-1.5 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="O que são variações?"
      >
        <CircleHelp className="size-4" />
      </button>
      <VariationsGuideDialog open={open} onOpenChange={setOpen} example={example} />
    </>
  );
}
```

- [ ] **Step 4: Alvos no editor de produto**

`src/components/catalog/product-editor.tsx`:
- O `<div className="space-y-2">` que envolve `<Label htmlFor="product-name">` vira `<div className="space-y-2" data-tour="product-name" data-filled={name.trim() ? "" : undefined}>`.
- O `<div className="space-y-2">` que envolve `<Label htmlFor="generic-price">` vira `<div className="space-y-2" data-tour="product-price">`.
- O botão "Salvar produto" (o que tem `onClick={handleSubmit}`) ganha `data-tour="product-save"`.

`src/components/catalog/options-editor.tsx`:
- `{options.map((option) => (` vira `{options.map((option, index) => (` (se já houver `index`, mantenha).
- O `<div className="flex-1 space-y-1.5">` que envolve o `Label` "Tipo de variação" vira:

```tsx
            <div
              className="flex-1 space-y-1.5"
              data-tour={index === 0 ? "option-name" : undefined}
              data-filled={index === 0 && option.name.trim() ? "" : undefined}
            >
```

- O `<div className="flex flex-wrap items-center gap-2">` que lista as opções vira:

```tsx
            <div
              className="flex flex-wrap items-center gap-2"
              data-tour={index === 0 ? "option-values" : undefined}
              data-count={index === 0 ? option.values.filter((value) => value.name.trim()).length : undefined}
            >
```

- O botão "Adicionar variação" (o que chama `onChange([...options, blankOption()])`) ganha `data-tour="add-variation"`.

`src/components/catalog/combinations-list.tsx`:
- Antes do `return` do componente `CombinationsList`, acrescente `const firstEntryKey = rows.map((valueKeys) => combinationKey(valueKeys)).find((key) => byKey.has(key));`.
- `<ul className="divide-y rounded-lg border bg-card">` vira `<ul className="divide-y rounded-lg border bg-card" data-tour="combinations" data-checked={firstEntryKey ? "" : undefined}>`.
- `<div className="flex flex-wrap items-center gap-3 pl-7">` vira `<div className="flex flex-wrap items-center gap-3 pl-7" data-tour={key === firstEntryKey ? "combination-details" : undefined}>`.

- [ ] **Step 5: Abrir o guia antes da missão do catálogo**

Em `src/components/onboarding/tour-runner.tsx`:

1. Importe `import { VariationsGuideDialog } from "@/components/catalog/variations-guide";`.
2. Logo depois de `const [index, setIndex] = useState(-1);`, acrescente:

```tsx
  const [guideOpen, setGuideOpen] = useState(mission?.intro === "variations-guide");
```

3. Troque o efeito de início:

```tsx
  useEffect(() => {
    void goToRef.current(0);
  }, []);
```

por:

```tsx
  useEffect(() => {
    if (!guideOpen) void goToRef.current(0);
  }, [guideOpen]);
```

4. Dentro do `RunnerContext.Provider`, depois do `InlineHint`, acrescente:

```tsx
      {mission?.intro === "variations-guide" ? (
        <VariationsGuideDialog open={guideOpen} onOpenChange={setGuideOpen} example={examples} />
      ) : null}
```

- [ ] **Step 6: Checar tipos, lint e testes**

Run: `pnpm exec tsc --noEmit && pnpm exec next lint && pnpm test`
Expected: sem erros.

- [ ] **Step 7: Verificar no navegador**

Workspace de teste com `sector = 'confeitaria'`, sem produtos com preço e com uma ficha técnica cadastrada:
1. Painel → missão "Monte seu produto no catálogo" → "Fazer". Abre o guia animado com "Bolo de pote", Sabor (Ninho, Nutella, Doce de leite) × Tamanho (Mini, Tradicional). "Entendi" fecha e o holofote vai para o Nome.
2. Digitar o nome avança sozinho; "Próximo" no preço; tocar em "Adicionar variação" avança; digitar "Sabor" avança; digitar duas opções avança; marcar uma combinação avança; o passo do preço da combinação e o da ficha técnica (só confeitaria) aparecem sobre a primeira combinação marcada; "Salvar produto" conclui.
3. Depois de salvar, em até ~2 s aparece "Missão concluída!" e o card avança.
4. Repita com `sector = 'roupas'`: o guia usa Camiseta, Tamanho × Cor, e não há o passo da ficha técnica da combinação.
5. Num terceiro teste, no passo "Variações", toque em "Meu produto não tem variações": vai direto para Salvar.
6. O (?) ao lado de "Variações" abre o mesmo guia com os exemplos do setor; num workspace sem setor, continua com o Brownie.
7. Faça os passos em 375 px: o holofote acompanha o botão "Salvar produto" na barra fixa de baixo. `read_console_messages` sem erros. Tire `screenshot` do guia e de um passo com holofote.

- [ ] **Step 8: Commit**

```bash
git add src/lib/onboarding/guide-example.ts src/lib/onboarding/guide-example.test.ts src/components/catalog src/components/onboarding/tour-runner.tsx
git commit -m "feat(onboarding): missão guiada do catálogo e guia de variações com exemplos do setor"
```

---

### Task 10: Alvos de compra, ficha técnica, produção, venda e cliente

**Files:**
- Modify: `src/components/purchases/purchase-dialog.tsx`
- Modify: `src/components/recipes/recipe-form.tsx`
- Modify: `src/components/production/production-form.tsx`
- Modify: `src/components/sales/sale-form.tsx`
- Modify: `src/components/customers/customer-create-dialog.tsx`

**Interfaces:**
- Consumes: `PURCHASE_DIALOG_ID = "tour-purchase-dialog"`, `CUSTOMER_DIALOG_ID = "tour-customer-dialog"` e os alvos listados na Tarefa 2.
- Produces: os atributos abaixo. Nenhuma lógica de formulário muda.

- [ ] **Step 1: Compra**

`src/components/purchases/purchase-dialog.tsx`:
- No `PurchaseDialog`, o `<Button size="sm" onClick={() => setOpen(true)}>` ganha `data-tour="purchase-new"`.
- O `<DialogContent className={[…].join(" ")}>` do `PurchaseFormDialog` ganha `id="tour-purchase-dialog"`.
- O `<div className="space-y-2">` que envolve `<Label>Fornecedor</Label>` vira `<div className="space-y-2" data-tour="purchase-supplier">`.
- `{items.map((item) => (` vira `{items.map((item, index) => (`.
- O `<div className="flex-1">` que envolve o `PurchaseItemCombobox` vira `<div className="flex-1" data-tour={index === 0 ? "purchase-item" : undefined} data-filled={index === 0 && item.item ? "" : undefined}>`.
- O `<SelectTrigger className={!item.variantId ? "text-muted-foreground" : undefined}>` da variante ganha `data-tour={index === 0 ? "purchase-variant" : undefined}` e `data-filled={index === 0 && item.variantId ? "" : undefined}`.
- O `<div className="grid grid-cols-2 gap-2">` com quantidade e unidade ganha `data-tour={index === 0 ? "purchase-values" : undefined}` e `data-filled={index === 0 && parseQty(item.quantity) > 0 && itemTotalCents(item) > 0 ? "" : undefined}`.
- O botão de envio (`<Button type="submit" disabled={saving || !canSubmit}>`) ganha `data-tour="purchase-save"`.

- [ ] **Step 2: Ficha técnica**

`src/components/recipes/recipe-form.tsx`:
- O `<div className="space-y-2">` que envolve `<Label htmlFor="recipe-name">` vira `<div className="space-y-2" data-tour="recipe-name" data-filled={name.trim() ? "" : undefined}>`.
- O `<div className="space-y-2">` que envolve `<Label htmlFor="recipe-yield">` vira `<div className="space-y-2" data-tour="recipe-yield">`.
- `{lines.map((line) => {` vira `{lines.map((line, index) => {`; no `<div key={line.key} className="grid grid-cols-[1fr_6.5rem_auto] …">` acrescente `data-tour={index === 0 ? "recipe-line" : undefined}` e `data-filled={index === 0 && line.item && rawQty > 0 ? "" : undefined}`.
- O botão "Criar ficha técnica" (`<Button onClick={handleSubmit} disabled={saving}>`) ganha `data-tour="recipe-save"`.

- [ ] **Step 3: Produção**

`src/components/production/production-form.tsx`:
- O `<div className="space-y-2">` com `<Label>Item</Label>` vira `<div className="space-y-2" data-tour="production-item" data-filled={itemId ? "" : undefined}>`.
- O `<div className="space-y-2">` com o `Label` "Ficha técnica base" vira `<div className="space-y-2" data-tour="production-recipe">`.
- O `<div className="space-y-2">` com `<Label htmlFor="qty">` vira `<div className="space-y-2" data-tour="production-qty" data-filled={Number(quantity) > 0 ? "" : undefined}>`.
- O `<Button type="submit" disabled={saving || !itemId || totalQty <= 0}>` ganha `data-tour="production-save"`.

- [ ] **Step 4: Venda**

`src/components/sales/sale-form.tsx`:
- Em `ItemRow`, acrescente `tourId,` à desestruturação e `tourId?: string;` ao tipo das props. O `<div className="rounded-lg border bg-card p-3 space-y-2">` do `return` vira `<div className="rounded-lg border bg-card p-3 space-y-2" data-tour={tourId} data-filled={tourId && line.itemId ? "" : undefined}>`.
- `{lines.map((line) => (` dentro da seção "Itens" vira `{lines.map((line, index) => (` e o `<ItemRow` ganha `tourId={index === 0 ? "sale-line" : undefined}`.
- O `<div className="space-y-2">` que envolve `<CustomerCombobox value={customer} onChange={setCustomer} />` vira `<div className="space-y-2" data-tour="sale-customer">`.
- A `<section className="space-y-4">` cujo `h2` é "Pagamento" vira `<section className="space-y-4" data-tour="sale-payment" data-installments={paymentMode === "INSTALLMENTS" ? "" : undefined}>`.
- O botão "Registrar venda" (`<Button onClick={handleSubmit} disabled={saving}>`) ganha `data-tour="sale-save"`.

- [ ] **Step 5: Cliente**

`src/components/customers/customer-create-dialog.tsx`:
- O `<Button size="sm" onClick={() => setOpen(true)}>` do gatilho padrão ganha `data-tour="customer-new"`.
- `<DialogContent className="sm:max-w-md">` vira `<DialogContent className="sm:max-w-md" id="tour-customer-dialog">`.
- O `<div className="space-y-2">` que envolve `<Label htmlFor="name">Nome *</Label>` vira `<div className="space-y-2" data-tour="customer-name">`.
- O `<Button type="submit" disabled={saving}>` ganha `data-tour="customer-save"`.

- [ ] **Step 6: Checar tipos, lint e testes**

Run: `pnpm exec tsc --noEmit && pnpm exec next lint && pnpm test`
Expected: sem erros; os testes de compras, vendas, produção e fichas continuam passando.

- [ ] **Step 7: Verificar no navegador (valida o cartão de dica dentro do diálogo)**

Workspace `confeitaria`, dono, missões zeradas (banco de dev sem compras, fichas, produções, vendas e clientes desse workspace):
1. "Registre a compra do seu primeiro insumo": holofote em "Registrar compra"; ao tocar, o diálogo abre e o cartão de dica aparece dentro dele, no rodapé, com o anel no campo do fornecedor. Tocar em "Próximo" do cartão **não** fecha o diálogo. No campo do item, criar "Farinha de trigo" como matéria-prima avança sozinho; preencher quantidade e valor avança; "Registrar compra" conclui com comemoração.
2. "Monte a ficha técnica": nome, rendimento, linha de insumo (a dica fica no rodapé enquanto o combobox está aberto), "Criar ficha técnica" conclui.
3. "Registre uma produção": o `Select` do item abre normalmente com a dica embaixo; quantidade; "Registrar produção" conclui.
4. "Lance sua primeira venda": cliente (Próximo), produto (dica com o `Select` aberto), "Registrar venda" conclui.
5. "Cadastre um cliente": "Novo cliente" → nome (Próximo, dentro do diálogo) → "Criar cliente" conclui. Com isso as 6 missões ficam feitas e aparece "Tudo pronto!".
6. Com `sector = 'artesanato'`, a "venda parcelada" só conclui depois de escolher "Parcelado"; uma venda à vista não conclui.
7. Sair da rota no meio de uma missão (tocar em Painel) pausa: o card mostra "Continuar".
8. Tudo isso em 375 px e uma passada em desktop. `read_console_messages` sem erros.

Se no passo 1 o clique no cartão dentro do diálogo ainda fechar o diálogo ou não responder, confirme que o `DialogContent` ficou com `id="tour-purchase-dialog"` e que o cartão foi renderizado dentro dele (`read_page`); o portal do `InlineHint` usa `document.getElementById(step.def.viewport)`.

- [ ] **Step 8: Commit**

```bash
git add src/components/purchases/purchase-dialog.tsx src/components/recipes/recipe-form.tsx src/components/production/production-form.tsx src/components/sales/sale-form.tsx src/components/customers/customer-create-dialog.tsx
git commit -m "feat(onboarding): alvos guiados em compras, fichas, produção, vendas e clientes"
```

---

### Task 11: Integridade dos roteiros e verificação final

**Files:**
- Test: `src/lib/onboarding/targets.test.ts`

**Interfaces:**
- Consumes: `APP_TOUR`, `MISSIONS`, `PURCHASE_DIALOG_ID`, `CUSTOMER_DIALOG_ID`.
- Produces: o teste que impede roteiro apontando para alvo inexistente depois de refatorações.

- [ ] **Step 1: Escrever o teste**

`src/lib/onboarding/targets.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_TOUR } from "./app-tour";
import { MISSIONS, type StepTarget, type TourStepDef } from "./missions";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const sources = sourceFiles(join(process.cwd(), "src")).map((file) => readFileSync(file, "utf8"));

function targetIds(target: StepTarget): string[] {
  return typeof target === "string" ? [target] : [target.mobile, target.desktop];
}

function declaresTarget(id: string): boolean {
  return sources.some((source) => source.includes("data-tour") && source.includes(`"${id}"`));
}

function declaresViewport(id: string): boolean {
  return sources.some((source) => source.includes(`id="${id}"`));
}

const allSteps: TourStepDef[] = [...APP_TOUR, ...Object.values(MISSIONS).flatMap((mission) => mission.steps)];

describe("roteiros do onboarding", () => {
  it("todo alvo citado existe como data-tour em algum componente", () => {
    const missing = allSteps.flatMap((step) => targetIds(step.target)).filter((id) => !declaresTarget(id));
    expect(missing).toEqual([]);
  });

  it("todo diálogo citado tem o id no DialogContent", () => {
    const viewports = [...new Set(allSteps.map((step) => step.viewport).filter((v): v is string => Boolean(v)))];
    expect(viewports.filter((id) => !declaresViewport(id))).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar**

Run: `pnpm exec vitest run src/lib/onboarding/targets.test.ts`
Expected: PASS. Se falhar, a lista mostra o alvo ausente: corrija o componente da Tarefa 7, 8, 9 ou 10 que deveria declarar o atributo.

- [ ] **Step 3: Provar que o teste pega regressão**

Troque temporariamente `data-tour="sale-save"` por `data-tour="sale-salvar"` em `src/components/sales/sale-form.tsx` e rode o teste: deve falhar listando `sale-save`. Desfaça a troca (`git checkout src/components/sales/sale-form.tsx`) e rode de novo: PASS.

- [ ] **Step 4: Verificação completa**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm exec next lint
```

Expected: todos os testes passam, sem erros de tipo e sem erros de lint no projeto inteiro.

- [ ] **Step 5: Passada final no navegador**

1. Usuário novo, sem workspace: `/onboarding` → nome → "Roupas e acessórios" → Painel → tour completo em 375 px → as 4 missões de revenda até "Tudo pronto!".
2. Usuário convidado como MEMBER num workspace com setor: vê só o tour (sem a parada do card) e nenhuma missão nem bolha.
3. Workspace em modo leitura (plano bloqueado no banco de dev): dono vê só o tour.
4. Tema escuro (`resize_window` com `colorScheme: "dark"`): card, bolha, balão e dica legíveis.
5. `prefers-reduced-motion`: sem anel pulsante nem confete, e o tour continua funcionando.

- [ ] **Step 6: Commit**

```bash
git add src/lib/onboarding/targets.test.ts
git commit -m "test(onboarding): garante que os roteiros apontam para alvos existentes"
```

- [ ] **Step 7: Avisar sobre o banco de produção**

Não rode nada em produção. Registre na descrição do PR (ou na mensagem ao usuário) que, antes do deploy, a migration `prisma/migrations/20261015120000_onboarding/migration.sql` precisa ser aplicada no banco de produção pelo mesmo fluxo manual, e que todo usuário existente verá o tour de apresentação uma vez.
