# Pendências dos Planos (Corre / Cresce / Escala) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** Fechar as 11 lacunas encontradas na auditoria de 2026-09-14 entre o que a tela de assinatura (`src/lib/plans.ts`) promete para Corre, Cresce e Escala e o que existe de fato no código.

**Architecture:** Não é uma feature única — são 11 lacunas independentes em subsistemas diferentes (limite de usuários, dashboard, exportação, roles, financeiro, API). Este documento só detalha em nível de Task (TDD, pronto pra codar) a lacuna que é pequena, autocontida e não depende de nenhuma decisão de produto: o limite de usuários do Corre. As demais viram um backlog priorizado por fase — cada fase vira seu próprio plano quando chegar a vez, porque metade delas depende de decisão de produto/fornecedor que ainda não foi tomada.

**Tech Stack:** Next.js 15 App Router, Prisma + PostgreSQL, Vitest.

**Spec:** Este documento (seção "Contexto"), derivado da auditoria de código de 2026-09-14 contra `src/lib/plans.ts` e do checklist publicado na conversa.

## Global Constraints

- **Sem comentários no código.** Regra do projeto (`CLAUDE.md`), sem exceção.
- Testes rodam com `pnpm test` (não `npm`/`yarn` — disco do ambiente vive perto de 100%).
- Migrations são escritas à mão e aplicadas via `docker psql` em `cookies` e `cookies_test` — **nunca** `prisma migrate dev`.
- Dinheiro em centavos inteiros; datas em `Date`, nunca string solta.
- Código e identificadores em inglês; texto visível ao usuário em português.
- Nenhum acesso a banco fora de `src/server/**`.
- Mensagens de erro para o usuário seguem o tom já usado no projeto: diretas, sem jargão técnico (ver exemplos em `workspaces.ts`).

---

## Contexto

Auditoria completa (22 itens, 3 planos) publicada em artefato separado. Resumo:

| Status | Qtde | Itens |
|---|---|---|
| ✅ Implementado | 10 | vendas/pedidos, fiado, estoque/produção, receitas com custo, clientes, painel de faturamento, limite de 4 workspaces, roles fixos, comparação de preços, relatórios comparativos |
| 🟡 Parcial | 1 | PWA instalável (falta service worker) |
| ❌ Ausente | 10 | limite de 2 usuários (Corre), painel consolidado, lista de compras automática, exportação CSV, link público, papéis personalizados, nota fiscal, CNPJ, boleto, API pública |
| 🕓 Planejado (já disclosed) | 1 | "Parcelado na Palavra" — copy já avisa "assim que for lançado", sem spec ainda; fora do escopo deste plano |

O item mais urgente é o único com risco de receita direto: o Corre vende "até 2 usuários por workspace" e hoje não há nenhum bloqueio — é a Task 1 abaixo.

## Estrutura de arquivos (Task 1)

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/plans.ts` | catálogo de planos — ganha `maxMembers` e `planMemberLimit()` (modificado) |
| `src/lib/plans.test.ts` | testes do catálogo (modificado) |
| `src/server/tenant/workspaces.ts` | convite e ingresso em workspace — ganha o gate de assentos (modificado) |
| `src/server/tenant/member-limit.test.ts` | testes de integração do gate (novo) |

---

### Task 1: Limite de usuários por workspace no plano Corre

**Files:**
- Modify: `src/lib/plans.ts`
- Modify: `src/lib/plans.test.ts`
- Modify: `src/server/tenant/workspaces.ts`
- Test: `src/server/tenant/member-limit.test.ts` (novo)

**Interfaces:**
- Consumes: `findPlan(plan)` (já existe, privada ao módulo `plans.ts`); `db` de `@/lib/db`; `getSubscription(userId)` de `./subscription` (já importado em `workspaces.ts`).
- Produces: `planMemberLimit(plan: string): number` em `src/lib/plans.ts`, usado por `workspaces.ts`.

- [ ] **Step 1: Escrever o teste de `planMemberLimit`**

Adicionar ao final de `src/lib/plans.test.ts`, e incluir `planMemberLimit` no import do topo do arquivo:

```ts
import {
  chargeAmountCents,
  effectiveLimit,
  isKnownPlan,
  monthlyPriceCents,
  planLabel,
  planLimit,
  planMemberLimit,
} from "./plans";
```

```ts
describe("limite de usuários por workspace", () => {
  it("corre permite só 2 usuários por workspace", () => {
    expect(planMemberLimit("corre")).toBe(2);
  });

  it("cresce e escala não limitam usuários", () => {
    expect(planMemberLimit("cresce")).toBe(Number.POSITIVE_INFINITY);
    expect(planMemberLimit("escala")).toBe(Number.POSITIVE_INFINITY);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test plans.test.ts`
Expected: FAIL — `planMemberLimit` não existe em `./plans`.

- [ ] **Step 3: Implementar `maxMembers` e `planMemberLimit` em `plans.ts`**

Em `src/lib/plans.ts`, adicionar o campo ao tipo:

```ts
type PlanDefinition = {
  id: string;
  label: string;
  workspacesLabel: string;
  maxWorkspaces: number;
  maxMembers: number;
  baseMonthlyCents: number | null;
  categoryLabel: string;
  tagline: string;
  inheritsFrom: string | null;
  highlight: boolean;
  features: string[];
};
```

Adicionar `maxMembers: 2` no objeto do plano `"corre"`, e `maxMembers: Number.POSITIVE_INFINITY` nos objetos `"cresce"` e `"escala"` (cada um logo depois do respectivo `maxWorkspaces`).

Adicionar a função, junto das outras exportadas por `findPlan`:

```ts
export function planMemberLimit(plan: string): number {
  return findPlan(plan).maxMembers;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test plans.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat: adiciona limite de usuários por plano ao catálogo"
```

- [ ] **Step 6: Escrever os testes de integração do gate**

Criar `src/server/tenant/member-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { createInvite, joinWithCode } = await import("./workspaces");

async function seedUserWithSession(id: string, email: string) {
  const user = await testDb.user.create({ data: { id, name: "Usuária", email } });
  const session = await testDb.session.create({
    data: {
      id: `s-${id}`,
      token: `tok-${id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  sessionResult = { user: { id: user.id }, session: { id: session.id } };
  return user;
}

describe("limite de usuários por workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("corre aceita o segundo convite e recusa o terceiro", async () => {
    const owner = await seedUserWithSession("u-owner", "owner@example.com");
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "corre", status: "ACTIVE" },
    });
    const ws = await testDb.workspace.create({ data: { name: "WS", slug: "ws-corre-limit" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });

    await createInvite(ws.id, "MEMBER", null);

    await expect(createInvite(ws.id, "MEMBER", null)).rejects.toThrow(
      "Seu plano atingiu o limite de usuários deste workspace. Cancele um convite pendente ou faça upgrade para convidar mais gente.",
    );

    expect(await testDb.invitation.count({ where: { workspaceId: ws.id } })).toBe(1);
  });

  it("recusa entrar quando o workspace já está no limite de usuários", async () => {
    const owner = await seedUserWithSession("u-owner2", "owner2@example.com");
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "corre", status: "ACTIVE" },
    });
    const ws = await testDb.workspace.create({ data: { name: "WS2", slug: "ws-corre-limit-2" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });

    const segunda = await testDb.user.create({
      data: { id: "u-segunda", name: "Segunda", email: "segunda@example.com" },
    });
    await testDb.member.create({ data: { userId: segunda.id, workspaceId: ws.id, role: "MEMBER" } });

    const invite = await testDb.invitation.create({
      data: {
        code: "ABCD1234",
        workspaceId: ws.id,
        role: "MEMBER",
        inviterId: owner.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await seedUserWithSession("u-terceira", "terceira@example.com");
    const result = await joinWithCode(invite.code);

    expect(result).toEqual({
      ok: false,
      error: "Este workspace já atingiu o limite de usuários do plano.",
    });
    expect(await testDb.member.count({ where: { workspaceId: ws.id } })).toBe(2);
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `pnpm test member-limit.test.ts`
Expected: FAIL — primeiro teste não lança a mensagem esperada (nenhum gate existe ainda); segundo teste recebe `{ ok: true, ... }` em vez do erro.

- [ ] **Step 8: Implementar o gate em `workspaces.ts`**

No topo do arquivo, trocar:

```ts
import { effectiveLimit } from "@/lib/plans";
```

por:

```ts
import { effectiveLimit, planMemberLimit } from "@/lib/plans";
```

Adicionar as duas funções auxiliares (por exemplo, logo depois de `uniqueSlug`):

```ts
async function memberLimitForWorkspace(workspaceId: string): Promise<number> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) return planMemberLimit("corre");

  const sub = await getSubscription(owner.userId);
  return planMemberLimit(sub?.plan ?? "corre");
}

async function seatsUsed(workspaceId: string): Promise<number> {
  const [members, invites] = await Promise.all([
    db.member.count({ where: { workspaceId } }),
    db.invitation.count({
      where: { workspaceId, status: "PENDING", expiresAt: { gt: new Date() } },
    }),
  ]);
  return members + invites;
}
```

Em `createInvite`, logo após `if (!workspace) throw new Error("Workspace não encontrado.");` e antes do `for (let attempt = 0; ...)`:

```ts
const limit = await memberLimitForWorkspace(workspaceId);
const seats = await seatsUsed(workspaceId);
if (seats >= limit) {
  throw new Error(
    "Seu plano atingiu o limite de usuários deste workspace. Cancele um convite pendente ou faça upgrade para convidar mais gente.",
  );
}
```

Em `joinWithCode`, logo após o bloco `if (existing) { ... return { ok: true, workspaceName: invite.workspace.name }; }` e antes de `await db.$transaction(async (tx) => {`:

```ts
const limit = await memberLimitForWorkspace(invite.workspaceId);
const currentMembers = await db.member.count({ where: { workspaceId: invite.workspaceId } });
if (currentMembers >= limit) {
  return { ok: false, error: "Este workspace já atingiu o limite de usuários do plano." };
}
```

- [ ] **Step 9: Rodar e confirmar que passa**

Run: `pnpm test member-limit.test.ts`
Expected: PASS

- [ ] **Step 10: Rodar a suíte inteira antes de commitar**

Run: `pnpm test`
Expected: PASS — inclusive `workspaces.test.ts`, que exercita `createWorkspaceForUser` e não deve ser afetado.

- [ ] **Step 11: Commit**

```bash
git add src/lib/plans.ts src/server/tenant/workspaces.ts src/server/tenant/member-limit.test.ts
git commit -m "feat: bloqueia convite e ingresso acima do limite de usuários do plano"
```

---

## Estrutura de arquivos (Tasks 2-6 — Fase 1)

| Arquivo | Responsabilidade |
|---|---|
| `src/server/queries/shopping-list.ts` | leitura de itens persistidos da lista de compras (novo) |
| `src/server/actions/shopping-list.ts` | gerar lista automática e marcar item como comprado (novo) |
| `src/components/pantry/shopping-list-actions.tsx` | botão "gerar lista" (novo) |
| `src/components/pantry/shopping-list-item-row.tsx` | linha com checkbox de comprado (novo) |
| `src/app/(app)/pantry/shopping-list/page.tsx` | soma a lista persistida à view já existente (modificado) |
| `src/lib/csv.ts` | serialização CSV genérica, sem dependência externa (novo) |
| `src/server/queries/sales.ts` | ganha `getSalesForExport` (modificado) |
| `src/app/(app)/sales/export/route.ts` | endpoint de download do CSV de vendas (novo) |
| `src/server/queries/consolidated-dashboard.ts` | soma de faturamento por workspace (novo) |
| `src/app/(app)/dashboard/consolidated/page.tsx` | tela do painel consolidado (novo) |
| `src/components/layout/side-nav.tsx` | ganha as entradas "Consolidado" e "Link público" (modificado, nas Tasks 4 e 5) |
| `prisma/schema.prisma` | `Workspace.publicToken` (modificado) |
| `prisma/migrations/20260914120000_add_workspace_public_token/migration.sql` | migração à mão (novo) |
| `src/server/tenant/public-link.ts` | geração/resolução do token público (novo) |
| `src/server/actions/public-link.ts` | ativar/desativar o link (novo) |
| `src/app/(app)/workspaces/public-link/page.tsx` | tela de configuração do link (novo) |
| `src/components/workspaces/public-link-toggle.tsx` | switch de ativar/desativar (novo) |
| `src/app/p/[token]/page.tsx` | página pública sem sessão (novo) |
| `src/middleware.ts` | libera `/p/*` do redirect de login (modificado) |
| `next.config.ts`, `package.json`, `.gitignore` | service worker via `@ducanh2912/next-pwa` (modificados) |

---

### Task 2: Lista de compras automática pelo estoque mínimo

**Files:**
- Create: `src/server/queries/shopping-list.ts`
- Create: `src/server/actions/shopping-list.ts`
- Create: `src/components/pantry/shopping-list-actions.tsx`
- Create: `src/components/pantry/shopping-list-item-row.tsx`
- Modify: `src/app/(app)/pantry/shopping-list/page.tsx`
- Test: `src/server/actions/shopping-list.test.ts` (novo)

**Interfaces:**
- Consumes: `getPantryStock()` de `@/server/queries/production` (retorna `PantryEntry[]`, com `ingredientId`, `ingredientName`, `baseUnit`, `current`, `minStock`, `belowMin`); `getScopedDb`/`assertCanWrite` de `@/server/tenant/context`; `getWorkspaceDb` (indiretamente, via `getPantryStock`); `formatQty`/`baseUnitLabel` de `@/lib/units`; `Switch` de `@/components/ui/switch`.
- Produces: `generateAutoShoppingList(): Promise<ActionResult<{ created: number; updated: number }>>` e `toggleShoppingListItem(id: string, done: boolean): Promise<ActionResult>` em `src/server/actions/shopping-list.ts`; `getShoppingListItems(): Promise<ShoppingListEntry[]>` em `src/server/queries/shopping-list.ts`.

Escopo: fecha a promessa "lista de compras automática" persistindo os itens abaixo do mínimo em `ShoppingListItem` e permitindo marcar como comprado. Não é uma reescrita de CRUD manual de lista de compras — isso já existiria via `ShoppingListItem.label`/`quantity` livres, mas não tem tela nenhuma hoje e fica fora deste escopo.

- [ ] **Step 1: Escrever o teste de `generateAutoShoppingList` (RED)**

Criar `src/server/actions/shopping-list.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "", userId: "", canWrite: true };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({
    db: scopedDb(context.workspaceId),
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: "OWNER",
    canWrite: context.canWrite,
  }),
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
  assertCanWrite: async () => {
    if (!context.canWrite) throw new Error("Este workspace está em modo somente leitura.");
  },
}));

const { generateAutoShoppingList, toggleShoppingListItem } = await import("./shopping-list");

describe("generateAutoShoppingList", () => {
  beforeEach(async () => {
    await resetDb();
    context.canWrite = true;
  });

  it("cria um item por ingrediente abaixo do mínimo, com o déficit certo", async () => {
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;

    const ingredient = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", minStock: 1000, workspaceId: workspace.id },
    });
    const market = await testDb.market.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    await testDb.ingredientPurchase.create({
      data: {
        ingredientId: ingredient.id,
        marketId: market.id,
        workspaceId: workspace.id,
        quantity: 400,
        unit: "G",
        pricePaidCents: 800,
      },
    });

    const res = await generateAutoShoppingList();

    expect(res).toEqual({ ok: true, data: { created: 1, updated: 0 } });
    const items = await testDb.shoppingListItem.findMany({ where: { workspaceId: workspace.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ingredientId: ingredient.id,
      label: "Açúcar",
      quantity: 600,
      unit: "G",
      autoGenerated: true,
      done: false,
    });
  });

  it("na segunda chamada atualiza o item existente em vez de duplicar", async () => {
    const workspace = await createWorkspace("Confeitaria 2");
    context.workspaceId = workspace.id;

    const ingredient = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", minStock: 1000, workspaceId: workspace.id },
    });
    const market = await testDb.market.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    await testDb.ingredientPurchase.create({
      data: {
        ingredientId: ingredient.id, marketId: market.id, workspaceId: workspace.id,
        quantity: 200, unit: "G", pricePaidCents: 400,
      },
    });

    await generateAutoShoppingList();
    const res = await generateAutoShoppingList();

    expect(res).toEqual({ ok: true, data: { created: 0, updated: 1 } });
    expect(await testDb.shoppingListItem.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });

  it("recusa gerar a lista com o workspace em modo somente leitura", async () => {
    const workspace = await createWorkspace("Confeitaria 3");
    context.workspaceId = workspace.id;
    context.canWrite = false;

    const res = await generateAutoShoppingList();
    expect(res.ok).toBe(false);
  });
});

describe("toggleShoppingListItem", () => {
  beforeEach(async () => {
    await resetDb();
    context.canWrite = true;
  });

  it("marca um item como comprado", async () => {
    const workspace = await createWorkspace("Confeitaria 4");
    context.workspaceId = workspace.id;
    const item = await testDb.shoppingListItem.create({
      data: { workspaceId: workspace.id, label: "Manteiga", autoGenerated: false },
    });

    const res = await toggleShoppingListItem(item.id, true);

    expect(res).toEqual({ ok: true });
    const updated = await testDb.shoppingListItem.findUnique({ where: { id: item.id } });
    expect(updated?.done).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test shopping-list.test.ts`
Expected: FAIL — `./shopping-list` (o módulo de actions) não existe ainda.

- [ ] **Step 3: Implementar as actions**

Criar `src/server/actions/shopping-list.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { BaseUnit } from "@prisma/client";
import { getScopedDb, assertCanWrite } from "@/server/tenant/context";
import { getPantryStock } from "@/server/queries/production";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function generateAutoShoppingList(): Promise<
  ActionResult<{ created: number; updated: number }>
> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    const stock = await getPantryStock();
    const belowMin = stock.filter((s) => s.belowMin && s.minStock != null);

    let created = 0;
    let updated = 0;

    for (const item of belowMin) {
      const deficit = Math.max(0, (item.minStock ?? 0) - item.current);
      const existing = await db.shoppingListItem.findFirst({
        where: {
          workspaceId,
          ingredientId: item.ingredientId,
          autoGenerated: true,
          done: false,
        },
      });

      if (existing) {
        await db.shoppingListItem.update({
          where: { id: existing.id },
          data: { quantity: deficit },
        });
        updated += 1;
        continue;
      }

      await db.shoppingListItem.create({
        data: {
          workspaceId,
          ingredientId: item.ingredientId,
          label: item.ingredientName,
          quantity: deficit,
          unit: item.baseUnit as BaseUnit,
          autoGenerated: true,
        },
      });
      created += 1;
    }

    revalidatePath("/pantry/shopping-list");
    return { ok: true, data: { created, updated } };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function toggleShoppingListItem(id: string, done: boolean): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    await db.shoppingListItem.updateMany({
      where: { id, workspaceId },
      data: { done },
    });

    revalidatePath("/pantry/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test shopping-list.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/shopping-list.ts src/server/actions/shopping-list.test.ts
git commit -m "feat: gera lista de compras automática pelo estoque mínimo"
```

- [ ] **Step 6: Criar a query de leitura**

Criar `src/server/queries/shopping-list.ts`:

```ts
import { getWorkspaceDb } from "@/server/tenant/context";

export type ShoppingListEntry = {
  id: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  autoGenerated: boolean;
};

export async function getShoppingListItems(): Promise<ShoppingListEntry[]> {
  const db = await getWorkspaceDb();
  const items = await db.shoppingListItem.findMany({
    where: { done: false },
    orderBy: [{ autoGenerated: "desc" }, { createdAt: "asc" }],
  });

  return items.map((i) => ({
    id: i.id,
    label: i.label,
    quantity: i.quantity,
    unit: i.unit,
    autoGenerated: i.autoGenerated,
  }));
}
```

Sem teste dedicado neste passo: é uma leitura direta de uma tabela já coberta pelos testes da Task 2 (Step 1) e do schema existente — cobertura vem do uso real na página (Step 8).

- [ ] **Step 7: Criar os dois componentes client**

Criar `src/components/pantry/shopping-list-actions.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateAutoShoppingList } from "@/server/actions/shopping-list";

export function GenerateShoppingListButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      const res = await generateAutoShoppingList();
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível gerar a lista.");
        return;
      }
      const { created, updated } = res.data ?? { created: 0, updated: 0 };
      if (created === 0 && updated === 0) {
        toast.info("Sua lista já está em dia.");
      } else {
        toast.success(`Lista atualizada: ${created} novo(s), ${updated} ajustado(s).`);
      }
      router.refresh();
    });
  }

  return (
    <Button onClick={onClick} disabled={pending} variant="outline" size="sm">
      <RefreshCw className="size-4" />
      {pending ? "Gerando..." : "Gerar lista de compras"}
    </Button>
  );
}
```

Criar `src/components/pantry/shopping-list-item-row.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { formatQty } from "@/lib/units";
import { toggleShoppingListItem } from "@/server/actions/shopping-list";
import type { BaseUnit } from "@prisma/client";

export function ShoppingListItemRow({
  id,
  label,
  quantity,
  unit,
}: {
  id: string;
  label: string;
  quantity: number | null;
  unit: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onCheckedChange(checked: boolean) {
    startTransition(async () => {
      const res = await toggleShoppingListItem(id, checked);
      if (!res.ok) toast.error(res.error ?? "Não foi possível atualizar o item.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <Switch checked={false} disabled={pending} onCheckedChange={onCheckedChange} aria-label="Marcar como comprado" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {quantity != null && unit != null && (
          <p className="text-xs text-muted-foreground">{formatQty(quantity, unit as BaseUnit)}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Ligar tudo na página**

Em `src/app/(app)/pantry/shopping-list/page.tsx`, adicionar os imports:

```ts
import { getShoppingListItems } from "@/server/queries/shopping-list";
import { GenerateShoppingListButton } from "@/components/pantry/shopping-list-actions";
import { ShoppingListItemRow } from "@/components/pantry/shopping-list-item-row";
```

Buscar a lista persistida junto com `stock`, logo após `const stock = await getPantryStock();`:

```ts
const persisted = await getShoppingListItems();
```

Trocar o `<PageHeader ... />` por uma linha com o botão ao lado (mantendo os mesmos `title`/`description`/`backHref`):

```tsx
<div className="flex items-start justify-between gap-3">
  <PageHeader
    title="Lista de compras"
    description="Ingredientes abaixo do estoque mínimo."
    backHref="/pantry"
  />
  <GenerateShoppingListButton />
</div>
```

Depois do bloco que hoje fecha o `</div>` da `EmptyState`/lista calculada (o `)` final antes do último `</div>` de fechamento do componente), adicionar a seção da lista persistida:

```tsx
{persisted.length > 0 && (
  <div className="mt-6 space-y-2">
    <h2 className="text-sm font-medium text-muted-foreground">Sua lista</h2>
    {persisted.map((item) => (
      <ShoppingListItemRow
        key={item.id}
        id={item.id}
        label={item.label}
        quantity={item.quantity}
        unit={item.unit}
      />
    ))}
  </div>
)}
```

- [ ] **Step 9: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/server/queries/shopping-list.ts src/components/pantry/shopping-list-actions.tsx src/components/pantry/shopping-list-item-row.tsx "src/app/(app)/pantry/shopping-list/page.tsx"
git commit -m "feat: persiste e exibe a lista de compras gerada automaticamente"
```

---

### Task 3: Exportação de vendas em CSV

**Files:**
- Create: `src/lib/csv.ts`
- Create: `src/lib/csv.test.ts`
- Modify: `src/server/queries/sales.ts`
- Test: `src/server/queries/sales-export.test.ts` (novo)
- Create: `src/app/(app)/sales/export/route.ts`

**Interfaces:**
- Consumes: `getWorkspaceDb()` de `@/server/tenant/context`; `SalesFilters` e `buildSalesWhere` (privada, já existe em `sales.ts`); `formatBRL` de `@/lib/money`.
- Produces: `toCsv<T>(rows: T[], columns: { key: keyof T; label: string }[]): string` em `src/lib/csv.ts`; `getSalesForExport(filters?: SalesFilters): Promise<SaleExportRow[]>` em `src/server/queries/sales.ts`.

Escopo: fecha a promessa "exportação de dados em CSV" com um endpoint funcional e testável por URL (`/sales/export`). Não inclui um botão na tela de Vendas — não há precedente de layout dessa página neste plano para especificar com segurança onde inserir um link sem arriscar quebrar a UI existente; fica de fast-follow.

- [ ] **Step 1: Escrever os testes do helper de CSV (RED)**

Criar `src/lib/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("monta cabeçalho e linhas na ordem das colunas", () => {
    const csv = toCsv(
      [{ name: "Ana", total: 100 }],
      [
        { key: "name", label: "Nome" },
        { key: "total", label: "Total" },
      ],
    );
    expect(csv).toBe("Nome,Total\r\nAna,100");
  });

  it("escapa vírgula, aspas e quebra de linha", () => {
    const csv = toCsv(
      [{ name: 'Ana, "Confeitaria"\nfilial 2' }],
      [{ key: "name", label: "Nome" }],
    );
    expect(csv).toBe('Nome\r\n"Ana, ""Confeitaria""\nfilial 2"');
  });

  it("lista vazia gera só o cabeçalho", () => {
    expect(toCsv([], [{ key: "name", label: "Nome" }])).toBe("Nome");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test csv.test.ts`
Expected: FAIL — `./csv` não existe.

- [ ] **Step 3: Implementar `toCsv`**

Criar `src/lib/csv.ts`:

```ts
export type CsvColumn<T> = { key: keyof T; label: string };

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(row[c.key] ?? ""))).join(","),
  );
  return [header, ...lines].join("\r\n");
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test csv.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv.ts src/lib/csv.test.ts
git commit -m "feat: adiciona serializador de CSV sem dependência externa"
```

- [ ] **Step 6: Escrever o teste da query de exportação (RED)**

Criar `src/server/queries/sales-export.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "" };

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
}));

const { getSalesForExport } = await import("./sales");

describe("getSalesForExport", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("devolve uma linha por venda, com valores formatados para CSV", async () => {
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    const user = await testDb.user.create({
      data: { id: `user-${workspace.id}`, name: "Dona", email: `dona-${workspace.id}@example.com` },
    });
    const customer = await testDb.customer.create({
      data: { workspaceId: workspace.id, name: "Ana" },
    });

    await testDb.sale.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        customerId: customer.id,
        status: "PAID",
        totalCents: 5000,
        soldAt: new Date("2026-09-05T12:00:00.000Z"),
      },
    });
    await testDb.sale.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        status: "PENDING",
        totalCents: 2000,
        soldAt: new Date("2026-09-06T12:00:00.000Z"),
        paymentForecastDate: new Date("2026-09-20T12:00:00.000Z"),
      },
    });

    const rows = await getSalesForExport();

    expect(rows).toEqual([
      {
        soldAt: "2026-09-05",
        customerName: "Ana",
        status: "Pago",
        totalCents: 5000,
        paymentForecastDate: "",
      },
      {
        soldAt: "2026-09-06",
        customerName: "Sem cliente",
        status: "Pendente",
        totalCents: 2000,
        paymentForecastDate: "2026-09-20",
      },
    ]);
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `pnpm test sales-export.test.ts`
Expected: FAIL — `getSalesForExport` não existe em `./sales`.

- [ ] **Step 8: Implementar `getSalesForExport`**

Em `src/server/queries/sales.ts`, adicionar ao final do arquivo:

```ts
export type SaleExportRow = {
  soldAt: string;
  customerName: string;
  status: string;
  totalCents: number;
  paymentForecastDate: string;
};

export async function getSalesForExport(filters: SalesFilters = {}): Promise<SaleExportRow[]> {
  const db = await getWorkspaceDb();
  const where = buildSalesWhere(filters);

  const sales = await db.sale.findMany({
    where,
    orderBy: { soldAt: "asc" },
    include: { customer: { select: { name: true } } },
  });

  return sales.map((sale) => ({
    soldAt: sale.soldAt.toISOString().slice(0, 10),
    customerName: sale.customer?.name ?? sale.customerName ?? "Sem cliente",
    status: sale.status === "PAID" ? "Pago" : "Pendente",
    totalCents: sale.totalCents,
    paymentForecastDate: sale.paymentForecastDate
      ? sale.paymentForecastDate.toISOString().slice(0, 10)
      : "",
  }));
}
```

- [ ] **Step 9: Rodar e confirmar que passa**

Run: `pnpm test sales-export.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/server/queries/sales.ts src/server/queries/sales-export.test.ts
git commit -m "feat: adiciona query de vendas para exportação"
```

- [ ] **Step 11: Criar o endpoint de download**

Criar `src/app/(app)/sales/export/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSalesForExport } from "@/server/queries/sales";
import { toCsv } from "@/lib/csv";
import { formatBRL } from "@/lib/money";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") ? new Date(sp.get("from")!) : undefined;
  const to = sp.get("to") ? new Date(sp.get("to")!) : undefined;

  const rows = await getSalesForExport({ from, to });
  const csv = toCsv(
    rows.map((r) => ({ ...r, totalReais: formatBRL(r.totalCents) })),
    [
      { key: "soldAt", label: "Data da venda" },
      { key: "customerName", label: "Cliente" },
      { key: "status", label: "Status" },
      { key: "totalReais", label: "Total" },
      { key: "paymentForecastDate", label: "Previsão de recebimento" },
    ],
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="vendas.csv"',
      "Cache-Control": "no-store",
    },
  });
}
```

Não há precedente de teste HTTP de route handler neste projeto (confirmado por pesquisa) — a cobertura vem da query testada no Step 6. Verificação manual: depois do commit, rodar `pnpm dev`, logar, e abrir `http://localhost:3000/sales/export` no navegador — deve baixar um `vendas.csv` com as vendas do workspace ativo. Reportar o resultado dessa verificação manual no relatório.

- [ ] **Step 12: Rodar a suíte inteira e commitar**

Run: `pnpm test`
Expected: PASS

```bash
git add "src/app/(app)/sales/export/route.ts"
git commit -m "feat: adiciona endpoint de exportação de vendas em CSV"
```

---

### Task 4: Painel consolidado multi-workspace

**Files:**
- Create: `src/server/queries/consolidated-dashboard.ts`
- Test: `src/server/queries/consolidated-dashboard.test.ts`
- Create: `src/app/(app)/dashboard/consolidated/page.tsx`
- Modify: `src/components/layout/side-nav.tsx`

**Interfaces:**
- Consumes: `scopedDb(workspaceId)` de `@/server/tenant/extension`; `listUserWorkspaces()` de `@/server/tenant/workspaces` (retorna `WorkspaceSummary[]`, com `role`); `activeWorkspaceIds(userId)` de `@/server/tenant/subscription` (retorna `Set<string>`); `getWorkspaceContext()` de `@/server/tenant/context`; `formatBRL` de `@/lib/money`.
- Produces: `getWorkspaceRevenueSummary(workspaceId: string, workspaceName: string, filters: { from: Date; to: Date }): Promise<WorkspaceRevenueSummary>` e `getConsolidatedSummary(workspaces: { id: string; name: string }[], filters: { from: Date; to: Date }): Promise<WorkspaceRevenueSummary[]>` em `src/server/queries/consolidated-dashboard.ts`, onde `WorkspaceRevenueSummary = { workspaceId: string; workspaceName: string; paidRevenueCents: number; salesCount: number; avgTicketCents: number }`. A Task 5 reaproveita `getWorkspaceRevenueSummary`.

Escopo: soma de faturamento pago do mês corrente por workspace, não uma réplica completa do dashboard (mix de sabores, comparação de mercado etc. são por natureza específicos de cada workspace, não somáveis). `getDashboardData` (`src/server/queries/dashboard.ts`) não é tocada — é grande demais e amarrada à sessão para valer a pena refatorar aqui; a busca por workspace é feita direto com `scopedDb`, sequencialmente (nunca `Promise.all`), porque o banco roda com `connection_limit=1` (ver comentário em `src/app/(app)/dashboard/page.tsx` sobre pool).

- [ ] **Step 1: Escrever o teste (RED)**

Criar `src/server/queries/consolidated-dashboard.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { getConsolidatedSummary } from "./consolidated-dashboard";

describe("getConsolidatedSummary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("soma o faturamento pago de vários workspaces, ignorando o pendente e fora do período", async () => {
    const wsA = await createWorkspace("Loja A");
    const wsB = await createWorkspace("Loja B");
    const user = await testDb.user.create({
      data: { id: "u-consolidado", name: "Dona", email: "dona@example.com" },
    });

    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-30T23:59:59.999Z");

    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsA.id, status: "PAID", totalCents: 1000, soldAt: new Date("2026-09-05") },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsA.id, status: "PENDING", totalCents: 5000, soldAt: new Date("2026-09-06") },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsB.id, status: "PAID", totalCents: 3000, soldAt: new Date("2026-09-10") },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: wsB.id, status: "PAID", totalCents: 3000, soldAt: new Date("2026-08-10") },
    });

    const result = await getConsolidatedSummary(
      [
        { id: wsA.id, name: "Loja A" },
        { id: wsB.id, name: "Loja B" },
      ],
      { from, to },
    );

    expect(result).toEqual([
      { workspaceId: wsA.id, workspaceName: "Loja A", paidRevenueCents: 1000, salesCount: 1, avgTicketCents: 1000 },
      { workspaceId: wsB.id, workspaceName: "Loja B", paidRevenueCents: 3000, salesCount: 1, avgTicketCents: 3000 },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test consolidated-dashboard.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/server/queries/consolidated-dashboard.ts`:

```ts
import { scopedDb } from "@/server/tenant/extension";

export type WorkspaceRevenueSummary = {
  workspaceId: string;
  workspaceName: string;
  paidRevenueCents: number;
  salesCount: number;
  avgTicketCents: number;
};

export async function getWorkspaceRevenueSummary(
  workspaceId: string,
  workspaceName: string,
  filters: { from: Date; to: Date },
): Promise<WorkspaceRevenueSummary> {
  const db = scopedDb(workspaceId);
  const sales = await db.sale.findMany({
    where: { status: "PAID", soldAt: { gte: filters.from, lte: filters.to } },
    select: { totalCents: true },
  });

  const paidRevenueCents = sales.reduce((sum, s) => sum + s.totalCents, 0);
  const salesCount = sales.length;
  const avgTicketCents = salesCount > 0 ? Math.round(paidRevenueCents / salesCount) : 0;

  return { workspaceId, workspaceName, paidRevenueCents, salesCount, avgTicketCents };
}

export async function getConsolidatedSummary(
  workspaces: { id: string; name: string }[],
  filters: { from: Date; to: Date },
): Promise<WorkspaceRevenueSummary[]> {
  const summaries: WorkspaceRevenueSummary[] = [];
  for (const ws of workspaces) {
    summaries.push(await getWorkspaceRevenueSummary(ws.id, ws.name, filters));
  }
  return summaries;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test consolidated-dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/queries/consolidated-dashboard.ts src/server/queries/consolidated-dashboard.test.ts
git commit -m "feat: soma faturamento pago entre workspaces do usuário"
```

- [ ] **Step 6: Criar a página**

Criar `src/app/(app)/dashboard/consolidated/page.tsx`:

```tsx
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { listUserWorkspaces } from "@/server/tenant/workspaces";
import { activeWorkspaceIds } from "@/server/tenant/subscription";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getConsolidatedSummary } from "@/server/queries/consolidated-dashboard";
import { formatBRL } from "@/lib/money";

function monthRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export default async function ConsolidatedDashboardPage() {
  const { userId } = await getWorkspaceContext();
  const [owned, active] = await Promise.all([listUserWorkspaces(), activeWorkspaceIds(userId)]);
  const workspaces = owned.filter((w) => w.role === "OWNER" && active.has(w.id));

  const { from, to } = monthRange();
  const summaries = workspaces.length > 0 ? await getConsolidatedSummary(workspaces, { from, to }) : [];

  const totalRevenueCents = summaries.reduce((sum, s) => sum + s.paidRevenueCents, 0);
  const totalSales = summaries.reduce((sum, s) => sum + s.salesCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel consolidado"
        description="Soma do faturamento pago de todos os seus workspaces neste mês."
      />

      {summaries.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhum workspace para consolidar"
          description="Você precisa ser dono de mais de um workspace ativo para ver o consolidado."
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Faturamento pago no mês (todos os workspaces)</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(totalRevenueCents)}</p>
            <p className="text-xs text-muted-foreground">{totalSales} vendas</p>
          </div>

          <div className="space-y-2">
            {summaries.map((s) => (
              <div key={s.workspaceId} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
                <div>
                  <p className="font-medium">{s.workspaceName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.salesCount} vendas · ticket médio {formatBRL(s.avgTicketCents)}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{formatBRL(s.paidRevenueCents)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Adicionar ao menu**

Em `src/components/layout/side-nav.tsx`, adicionar `Building2` ao import existente de `lucide-react` (junto dos outros ícones já importados, como `LayoutDashboard`), e no array `items`, logo depois da entrada `{ href: "/dashboard", label: "Painel", icon: LayoutDashboard }`:

```ts
{ href: "/dashboard/consolidated", label: "Consolidado", icon: Building2 },
```

- [ ] **Step 8: Rodar a suíte inteira e commitar**

Run: `pnpm test`
Expected: PASS

```bash
git add src/server/queries/consolidated-dashboard.ts src/server/queries/consolidated-dashboard.test.ts "src/app/(app)/dashboard/consolidated/page.tsx" src/components/layout/side-nav.tsx
git commit -m "feat: adiciona painel consolidado multi-workspace"
```

---

### Task 5: Link público do painel

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260914120000_add_workspace_public_token/migration.sql`
- Create: `src/server/tenant/public-link.ts`
- Test: `src/server/tenant/public-link.test.ts`
- Create: `src/server/actions/public-link.ts`
- Test: `src/server/actions/public-link.test.ts`
- Create: `src/app/(app)/workspaces/public-link/page.tsx`
- Create: `src/components/workspaces/public-link-toggle.tsx`
- Create: `src/app/p/[token]/page.tsx`
- Modify: `src/middleware.ts`
- Modify: `src/components/layout/side-nav.tsx`

**Interfaces:**
- Consumes: `getWorkspaceRevenueSummary` (da Task 4, `src/server/queries/consolidated-dashboard.ts`); `getScopedDb`/`getWorkspaceContext` de `@/server/tenant/context`; `db` de `@/lib/db`; `Switch`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` de `@/components/ui/*`; `formatBRL` de `@/lib/money`.
- Produces: `enablePublicLink(workspaceId): Promise<string>`, `disablePublicLink(workspaceId): Promise<void>`, `resolveWorkspaceByPublicToken(token): Promise<{id,name}|null>`, `getPublicLinkState(workspaceId): Promise<{token: string|null}>` em `src/server/tenant/public-link.ts`; `togglePublicLink(enabled: boolean): Promise<ActionResult<{token: string|null}>>` em `src/server/actions/public-link.ts`.

Escopo: resumo público somente leitura (faturamento pago do mês) atrás de um token — sem nenhum outro dado sensível (nomes de clientes, custos etc). Este é o único item da Fase 1 com migração de schema.

- [ ] **Step 1: Alterar o schema e escrever a migração**

Em `prisma/schema.prisma`, no `model Workspace`, adicionar o campo logo após `slug`:

```prisma
model Workspace {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  publicToken String?  @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  ...
```

Criar `prisma/migrations/20260914120000_add_workspace_public_token/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_publicToken_key" ON "workspace"("publicToken");
```

Aplicar nos dois bancos locais (padrão já usado neste projeto para migrações escritas à mão — nunca `prisma migrate dev`):

```bash
docker exec -i cookies_db psql -U cookies -d cookies < prisma/migrations/20260914120000_add_workspace_public_token/migration.sql
docker exec -i cookies_db psql -U cookies -d cookies_test < prisma/migrations/20260914120000_add_workspace_public_token/migration.sql
pnpm exec prisma generate
```

- [ ] **Step 2: Commit do schema**

```bash
git add prisma/schema.prisma prisma/migrations/20260914120000_add_workspace_public_token/migration.sql
git commit -m "feat: adiciona publicToken ao workspace"
```

- [ ] **Step 3: Escrever os testes de `public-link.ts` (RED)**

Criar `src/server/tenant/public-link.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";

const {
  enablePublicLink,
  disablePublicLink,
  resolveWorkspaceByPublicToken,
  getPublicLinkState,
} = await import("./public-link");

describe("link público do workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("ativa, resolve pelo token e desativa", async () => {
    const workspace = await createWorkspace("Confeitaria");

    expect(await getPublicLinkState(workspace.id)).toEqual({ token: null });

    const token = await enablePublicLink(workspace.id);
    expect(token).toHaveLength(22);
    expect(await getPublicLinkState(workspace.id)).toEqual({ token });

    const resolved = await resolveWorkspaceByPublicToken(token);
    expect(resolved).toEqual({ id: workspace.id, name: "Confeitaria" });

    await disablePublicLink(workspace.id);
    expect(await getPublicLinkState(workspace.id)).toEqual({ token: null });
    expect(await resolveWorkspaceByPublicToken(token)).toBeNull();
  });

  it("token desconhecido não resolve nenhum workspace", async () => {
    expect(await resolveWorkspaceByPublicToken("token-que-nao-existe")).toBeNull();
  });
});
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `pnpm test public-link.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 5: Implementar `public-link.ts`**

Criar `src/server/tenant/public-link.ts`:

```ts
import { db } from "@/lib/db";

const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 22;
const MAX_TOKEN_ATTEMPTS = 5;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
}

export type PublicWorkspaceRef = { id: string; name: string };

export async function enablePublicLink(workspaceId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const token = randomToken();
    const taken = await db.workspace.findUnique({ where: { publicToken: token } });
    if (taken) continue;

    await db.workspace.update({ where: { id: workspaceId }, data: { publicToken: token } });
    return token;
  }

  throw new Error("Não foi possível gerar o link. Tente de novo.");
}

export async function disablePublicLink(workspaceId: string): Promise<void> {
  await db.workspace.update({ where: { id: workspaceId }, data: { publicToken: null } });
}

export async function resolveWorkspaceByPublicToken(
  token: string,
): Promise<PublicWorkspaceRef | null> {
  return db.workspace.findUnique({
    where: { publicToken: token },
    select: { id: true, name: true },
  });
}

export async function getPublicLinkState(workspaceId: string): Promise<{ token: string | null }> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { publicToken: true },
  });
  return { token: workspace?.publicToken ?? null };
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `pnpm test public-link.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/tenant/public-link.ts src/server/tenant/public-link.test.ts
git commit -m "feat: geração e resolução do token de link público"
```

- [ ] **Step 8: Escrever o teste da action (RED)**

Criar `src/server/actions/public-link.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { togglePublicLink } = await import("./public-link");

async function seedOwnerSession(workspaceId: string) {
  const user = await testDb.user.create({
    data: { id: `owner-${workspaceId}`, name: "Dona", email: `dona-${workspaceId}@example.com` },
  });
  await testDb.member.create({ data: { userId: user.id, workspaceId, role: "OWNER" } });
  const session = await testDb.session.create({
    data: {
      id: `s-${user.id}`,
      token: `tok-${user.id}`,
      userId: user.id,
      activeWorkspaceId: workspaceId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  sessionResult = { user: { id: user.id }, session: { id: session.id, activeWorkspaceId: workspaceId } };
}

describe("togglePublicLink", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("dono ativa e recebe um token", async () => {
    const workspace = await createWorkspace("Confeitaria");
    await seedOwnerSession(workspace.id);

    const res = await togglePublicLink(true);

    expect(res.ok).toBe(true);
    expect(res.data?.token).toHaveLength(22);
  });

  it("dono desativa e o token some", async () => {
    const workspace = await createWorkspace("Confeitaria 2");
    await seedOwnerSession(workspace.id);
    await togglePublicLink(true);

    const res = await togglePublicLink(false);

    expect(res).toEqual({ ok: true, data: { token: null } });
  });
});
```

- [ ] **Step 9: Rodar e confirmar que falha**

Run: `pnpm test src/server/actions/public-link.test.ts`
Expected: FAIL — `./public-link` (actions) não existe.

- [ ] **Step 10: Implementar a action**

Criar `src/server/actions/public-link.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getScopedDb } from "@/server/tenant/context";
import { enablePublicLink, disablePublicLink } from "@/server/tenant/public-link";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function togglePublicLink(
  enabled: boolean,
): Promise<ActionResult<{ token: string | null }>> {
  try {
    const { workspaceId } = await getScopedDb("OWNER");

    if (!enabled) {
      await disablePublicLink(workspaceId);
      revalidatePath("/workspaces/public-link");
      return { ok: true, data: { token: null } };
    }

    const token = await enablePublicLink(workspaceId);
    revalidatePath("/workspaces/public-link");
    return { ok: true, data: { token } };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
```

- [ ] **Step 11: Rodar e confirmar que passa**

Run: `pnpm test src/server/actions/public-link.test.ts`
Expected: PASS

- [ ] **Step 12: Rodar a suíte inteira e commitar**

Run: `pnpm test`
Expected: PASS

```bash
git add src/server/actions/public-link.ts src/server/actions/public-link.test.ts
git commit -m "feat: action de ativar/desativar o link público"
```

- [ ] **Step 13: Tela de configuração**

Criar `src/components/workspaces/public-link-toggle.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { togglePublicLink } from "@/server/actions/public-link";

export function PublicLinkToggle({
  canManage,
  enabled,
  publicUrl,
}: {
  canManage: boolean;
  enabled: boolean;
  publicUrl: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onChange(checked: boolean) {
    startTransition(async () => {
      const res = await togglePublicLink(checked);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível atualizar o link.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Link público
          <Switch checked={enabled} onCheckedChange={onChange} disabled={pending || !canManage} />
        </CardTitle>
        <CardDescription>
          {canManage
            ? "Qualquer pessoa com o link vê o faturamento do mês, sem poder editar nada."
            : "Só o dono do workspace pode ativar ou desativar o link."}
        </CardDescription>
      </CardHeader>
      {publicUrl && (
        <CardContent>
          <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{publicUrl}</p>
        </CardContent>
      )}
    </Card>
  );
}
```

Criar `src/app/(app)/workspaces/public-link/page.tsx`:

```tsx
import { PageHeader } from "@/components/shared/page-header";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getPublicLinkState } from "@/server/tenant/public-link";
import { PublicLinkToggle } from "@/components/workspaces/public-link-toggle";

export default async function PublicLinkPage() {
  const { workspaceId, role } = await getWorkspaceContext();
  const { token } = await getPublicLinkState(workspaceId);
  const publicUrl = token
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/p/${token}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Link público do painel"
        description="Compartilhe o faturamento do mês sem precisar dar login a ninguém."
      />
      <PublicLinkToggle canManage={role === "OWNER"} enabled={token !== null} publicUrl={publicUrl} />
    </div>
  );
}
```

Criar `src/app/p/[token]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { resolveWorkspaceByPublicToken } from "@/server/tenant/public-link";
import { getWorkspaceRevenueSummary } from "@/server/queries/consolidated-dashboard";
import { formatBRL } from "@/lib/money";

function monthRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export default async function PublicWorkspacePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const workspace = await resolveWorkspaceByPublicToken(token);
  if (!workspace) notFound();

  const { from, to } = monthRange();
  const summary = await getWorkspaceRevenueSummary(workspace.id, workspace.name, { from, to });

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{workspace.name}</p>
        <h1 className="text-2xl font-semibold">Faturamento do mês</h1>
      </div>
      <div className="rounded-lg border bg-card px-4 py-4">
        <p className="text-3xl font-semibold tabular-nums">{formatBRL(summary.paidRevenueCents)}</p>
        <p className="text-sm text-muted-foreground">
          {summary.salesCount} vendas · ticket médio {formatBRL(summary.avgTicketCents)}
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 14: Liberar a rota no middleware**

Em `src/middleware.ts`, trocar:

```ts
const PUBLIC_PATHS = ["/sign-in", "/not-authorized", "/splash-debug"];
```

por:

```ts
const PUBLIC_PATHS = ["/sign-in", "/not-authorized", "/splash-debug", "/p"];
```

E no `matcher`, trocar:

```ts
"/((?!api/auth|api/webhooks|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png|splash/|sign-in|not-authorized).*)",
```

por:

```ts
"/((?!api/auth|api/webhooks|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png|splash/|p/|sign-in|not-authorized).*)",
```

- [ ] **Step 15: Adicionar ao menu**

Em `src/components/layout/side-nav.tsx`, no array `items`, logo depois da entrada `{ href: "/dashboard/consolidated", label: "Consolidado", icon: Building2 }` adicionada na Task 4:

```ts
{ href: "/workspaces/public-link", label: "Link público", icon: Share2 },
```

Adicionar `Share2` ao mesmo import de `lucide-react` usado para `Building2`.

- [ ] **Step 16: Rodar a suíte inteira e commitar**

Run: `pnpm test`
Expected: PASS

```bash
git add src/components/workspaces/public-link-toggle.tsx "src/app/(app)/workspaces/public-link/page.tsx" "src/app/p/[token]/page.tsx" src/middleware.ts src/components/layout/side-nav.tsx
git commit -m "feat: adiciona tela pública do painel por link"
```

---

### Task 6: PWA completo — service worker

**Files:**
- Modify: `package.json` (nova dependência)
- Modify: `next.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `src/app/manifest.ts` (já existente, não modificado — os ícones/nome já estão corretos).
- Produces: nada consumido por outra task — item isolado.

Escopo: só o registro do service worker (instalação nativa + cache básico). Não é TDD — é configuração de build, sem unidade testável por `vitest`; a verificação é rodar o build e conferir que o arquivo gerado existe.

- [ ] **Step 1: Instalar a dependência**

```bash
pnpm add @ducanh2912/next-pwa
```

- [ ] **Step 2: Configurar o plugin**

Substituir o conteúdo de `next.config.ts`:

```ts
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withPWA(nextConfig);
```

- [ ] **Step 3: Ignorar os arquivos gerados**

Adicionar ao final de `.gitignore`:

```
public/sw.js
public/sw.js.map
public/workbox-*.js
public/workbox-*.js.map
```

- [ ] **Step 4: Verificar que o build gera o service worker**

Run: `pnpm build`
Expected: build passa sem erro, e o arquivo `public/sw.js` existe depois do build (`ls public/sw.js`).

Se o build falhar por incompatibilidade do plugin com esta versão do Next (15.1.11) ou com Turbopack, **não tente contornar sozinho** — reporte `DONE_WITH_CONCERNS` ou `BLOCKED` com o erro exato. Este passo é o único ponto de risco real da task.

- [ ] **Step 5: Rodar a suíte inteira e commitar**

Run: `pnpm test`
Expected: PASS — nada nos testes depende de build de produção.

```bash
git add package.json pnpm-lock.yaml next.config.ts .gitignore
git commit -m "feat: registra service worker para instalação PWA nativa"
```

---

## Backlog priorizado (Fase 2 a 4)

Nenhuma dessas é do tamanho de uma Task só — cada fase vira seu próprio plano detalhado quando chegar a vez.

**Achado da pesquisa que vale para as Tasks 2, 4 e 5 acima:** não existe hoje nenhum mecanismo de bloqueio de feature por plano no código (nem `requirePlan`/`hasFeature`). Ruling: as Tasks 2, 4 e 5 foram implementadas sem gating — qualquer workspace, inclusive no plano Corre, passa a ter acesso a elas assim que o código sobe. Fechar esse gap (afinal essas features são vendidas como exclusivas do Cresce) é trabalho novo, não coberto por este plano — precisa de uma Fase própria de feature-gating antes de anunciar a Fase 1 como "recurso do Cresce" para o cliente.

### Fase 2 — Papéis e permissões personalizados (Escala)

Exige decisão de produto antes de codar: quais recursos/ações viram permissões granuláveis? Hoje só existe `OWNER/ADMIN/MEMBER` fixo, checado em `requireRole`/`getScopedDb` (`src/server/tenant/context.ts`). Recomendo `superpowers:brainstorming` dedicado pra desenhar a matriz de permissões antes de tocar nesse arquivo — ele é usado por praticamente toda action do sistema, erro de design aqui é caro de desfazer.

### Fase 3 — Financeiro/fiscal (Escala)

Três itens interligados, cada um com uma decisão de fornecedor:

- **Nota fiscal (NF-e/NFS-e):** escolher provedor de emissão (ex.: Focus NFe, eNotas, NFE.io) é decisão comercial, não técnica — sem isso não dá pra desenhar o schema nem o fluxo.
- **Faturamento por CNPJ:** schema precisa de campo `cnpj` (hoje só existe `User.cpf`) e ajuste no fluxo de vendas pra registrar o documento do comprador. Pode andar solto, não depende da nota fiscal.
- **Boleto:** verificar antes se o Stripe (já integrado em `src/server/tenant/stripe.ts`) aceita boleto como `payment_method_types` no Brasil — pode ser só configuração, não implementação nova.

### Fase 4 — Integrações e API pública (Escala)

Precisa de decisão de design de API antes de codar: autenticação (API key por workspace?), versionamento, rate limit, e qual superfície expor primeiro (leitura de vendas? webhook de saída?). Hoje `src/app/api` só tem rotas internas (`auth`, `webhooks/interpix`, `webhooks/stripe`) — seria a primeira API pública do produto, vale o mesmo cuidado de brainstorm da Fase 2.

### Fora do backlog

"Parcelado na Palavra" não entra em nenhuma fase — a própria copy do plano já avisa que é "assim que for lançado" e não existe spec nenhuma ainda. Precisa de uma sessão de `product-management:write-spec` ou `superpowers:brainstorming` antes de virar plano.
