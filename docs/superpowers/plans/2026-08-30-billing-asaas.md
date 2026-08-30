# Billing via Asaas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cobrar assinatura recorrente por quantidade de workspaces, com Pix Automático via Asaas, e travar escrita quando não há plano ativo.

**Architecture:** a assinatura pertence ao usuário, não ao workspace — um plano permite N workspaces onde a pessoa é `OWNER`. O estado da assinatura é derivado dos webhooks de cobrança do Asaas (que não emite webhook de assinatura) e reconciliado diariamente. Assinaturas atribuídas à mão convivem com as do gateway através do campo `source`.

**Tech Stack:** Next.js 15 (App Router), Prisma 6, PostgreSQL, TypeScript strict, Vitest, npm, Asaas API v3.

**Spec:** `docs/superpowers/specs/2026-08-29-multi-tenant-workspaces-design.md` (seção 10)

## Global Constraints

- Código em **inglês**; UI e mensagens ao usuário em **português**
- **Nunca escrever comentários no código** — regra do projeto, sem exceção
- Dinheiro sempre em **centavos (Int)**; o Asaas trabalha em reais decimais, então a conversão acontece na borda da integração
- Gerenciador de pacotes: **npm**. O deploy usa **pnpm** — ao adicionar dependência, rode `pnpm install --lockfile-only` e commite o `pnpm-lock.yaml`, senão o build de produção falha com `ERR_PNPM_OUTDATED_LOCKFILE`
- Migrations rodam pela `DIRECT_URL`; `prisma migrate dev` é interativo e não funciona em sessão automatizada — use `prisma migrate diff` para gerar e `migrate deploy` para aplicar
- Nenhum arquivo em `src/server/` pode importar `@/lib/db`; a regra de lint barra. Exceções: `src/server/tenant/**` e `src/server/actions/allowlist.ts`
- **Nunca chame a API do Asaas em teste.** Todo teste usa dublê; a chave real só existe em runtime.

## Tabela de planos

| Plano | Workspaces | Mensal | Anual (por mês) |
|---|---|---|---|
| `solo` | 1 | R$ 29,90 | R$ 19,90 |
| `team` | 4 | R$ 99,90 | R$ 89,90 |
| `unlimited` | sem teto | sob consulta | sob consulta |

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/plans.ts` | tabela de planos, limites e preços em centavos |
| `src/server/tenant/subscription.ts` | leitura da assinatura, cálculo de workspaces ativos e excedentes |
| `src/server/tenant/asaas.ts` | cliente HTTP do Asaas (única fronteira com a API) |
| `src/server/actions/subscription.ts` | server actions de contratação e gestão |
| `src/app/api/webhooks/asaas/route.ts` | recebe e processa eventos de cobrança |
| `src/app/(app)/workspaces/plan/page.tsx` | tela de assinatura |
| `src/components/workspaces/plan-panel.tsx` | UI de contratação e status |

---

## Fase 1 — Modelo e regras, sem gateway

### Task 1: Model `Subscription` e remoção dos campos de `Workspace`

Os campos `plan`, `subscriptionStatus`, `trialEndsAt` e `graceUntil` foram adicionados a `Workspace` numa versão anterior do desenho, que assumia assinatura por workspace. Eles saem.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration em `prisma/migrations/`
- Test: `src/server/tenant/subscription.test.ts`

**Interfaces:**
- Produces: model `Subscription`, enums `SubscriptionStatus` (já existe) e `SubscriptionSource`

- [ ] **Step 1: Escrever o teste que falha**

`src/server/tenant/subscription.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";

describe("model de assinatura", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura ligada ao usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-sub", name: "Ana", email: "ana@example.com" },
    });

    const sub = await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    expect(sub.status).toBe("TRIALING");
    expect(sub.asaasSubscriptionId).toBeNull();
  });

  it("permite no máximo uma assinatura por usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dup", name: "Bia", email: "bia@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    await expect(
      testDb.subscription.create({
        data: { userId: user.id, plan: "team", source: "MANUAL" },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- subscription`
Expected: FAIL — `Property 'subscription' does not exist`.

- [ ] **Step 3: Acrescentar o model ao schema**

Em `prisma/schema.prisma`, ao lado dos demais enums:

```prisma
enum SubscriptionSource {
  ASAAS
  MANUAL
}
```

E o model:

```prisma
model Subscription {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  plan   String             @default("solo")
  status SubscriptionStatus @default(TRIALING)
  source SubscriptionSource @default(ASAAS)

  asaasCustomerId     String?
  asaasSubscriptionId String?

  trialEndsAt      DateTime?
  graceUntil       DateTime?
  currentPeriodEnd DateTime?

  notes String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("subscription")
}
```

Acrescente a `User`: `subscription Subscription?`

- [ ] **Step 4: Remover os campos de `Workspace`**

Em `model Workspace`, apague as quatro linhas:

```prisma
  plan               String             @default("pro")
  subscriptionStatus SubscriptionStatus @default(TRIALING)
  trialEndsAt        DateTime?
  graceUntil         DateTime?
```

- [ ] **Step 5: Gerar e aplicar a migration**

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_subscription_per_user
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/*_subscription_per_user/migration.sql
npx prisma migrate deploy
npx prisma generate
```

Confira o SQL gerado antes de aplicar: ele deve criar `subscription`, criar o enum `SubscriptionSource` e remover as quatro colunas de `workspace`. Se aparecer qualquer `DROP TABLE`, **pare e reporte**.

- [ ] **Step 6: Corrigir os consumidores dos campos removidos**

`src/server/tenant/workspaces.ts` seta `trialEndsAt` ao criar workspace e devolve `subscriptionStatus` em `listUserWorkspaces`. Remova ambos por ora — a Task 4 devolve o status pela assinatura. `src/app/(app)/layout.tsx` e `src/components/layout/app-shell.tsx` passam `planStatus`; deixe-os passando a string `"TRIALING"` fixa até a Task 4.

- [ ] **Step 7: Rodar tudo**

```bash
npm run test:db:setup && npm test && npx tsc --noEmit
```

Expected: testes passando, tsc limpo.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/server/tenant src/app src/components
git commit -m "feat: assinatura passa a pertencer ao usuario"
```

---

### Task 2: Tabela de planos

**Files:**
- Create: `src/lib/plans.ts`, `src/lib/plans.test.ts`

**Interfaces:**
- Produces: `PLANS`, `planLimit(plan: string): number`, `planPriceCents(plan: string, cycle: "MONTHLY" | "YEARLY"): number | null`, `effectiveLimit(plan: string, status: string): number`, `planLabel(plan: string): string`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/plans.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { effectiveLimit, planLimit, planPriceCents } from "./plans";

describe("planos", () => {
  it("define o limite de workspaces por plano", () => {
    expect(planLimit("solo")).toBe(1);
    expect(planLimit("team")).toBe(4);
    expect(planLimit("unlimited")).toBe(Number.POSITIVE_INFINITY);
  });

  it("plano desconhecido cai no mais restritivo", () => {
    expect(planLimit("inexistente")).toBe(1);
  });

  it("guarda os preços em centavos", () => {
    expect(planPriceCents("solo", "MONTHLY")).toBe(2990);
    expect(planPriceCents("solo", "YEARLY")).toBe(1990);
    expect(planPriceCents("team", "MONTHLY")).toBe(9990);
    expect(planPriceCents("team", "YEARLY")).toBe(8990);
  });

  it("plano ilimitado nao tem preco de checkout", () => {
    expect(planPriceCents("unlimited", "MONTHLY")).toBeNull();
  });

  it("durante o trial o limite e sempre 1, qualquer que seja o plano", () => {
    expect(effectiveLimit("solo", "TRIALING")).toBe(1);
    expect(effectiveLimit("team", "TRIALING")).toBe(1);
    expect(effectiveLimit("unlimited", "TRIALING")).toBe(1);
  });

  it("fora do trial vale o limite do plano", () => {
    expect(effectiveLimit("team", "ACTIVE")).toBe(4);
    expect(effectiveLimit("unlimited", "ACTIVE")).toBe(Number.POSITIVE_INFINITY);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- plans`
Expected: FAIL — `Cannot find module './plans'`.

- [ ] **Step 3: Implementar `src/lib/plans.ts`**

```ts
export type PlanCycle = "MONTHLY" | "YEARLY";

type PlanDefinition = {
  id: string;
  label: string;
  maxWorkspaces: number;
  priceCents: Record<PlanCycle, number> | null;
};

export const PLANS: PlanDefinition[] = [
  {
    id: "solo",
    label: "1 workspace",
    maxWorkspaces: 1,
    priceCents: { MONTHLY: 2990, YEARLY: 1990 },
  },
  {
    id: "team",
    label: "Até 4 workspaces",
    maxWorkspaces: 4,
    priceCents: { MONTHLY: 9990, YEARLY: 8990 },
  },
  {
    id: "unlimited",
    label: "Workspaces ilimitados",
    maxWorkspaces: Number.POSITIVE_INFINITY,
    priceCents: null,
  },
];

function findPlan(plan: string): PlanDefinition {
  return PLANS.find((p) => p.id === plan) ?? PLANS[0];
}

export function planLimit(plan: string): number {
  return findPlan(plan).maxWorkspaces;
}

export function planPriceCents(plan: string, cycle: PlanCycle): number | null {
  return findPlan(plan).priceCents?.[cycle] ?? null;
}

export function effectiveLimit(plan: string, status: string): number {
  return status === "TRIALING" ? 1 : planLimit(plan);
}

export function planLabel(plan: string): string {
  return findPlan(plan).label;
}
```

O preço anual é **por mês**; a cobrança anual multiplica por doze na borda da integração.

- [ ] **Step 4: Rodar os testes**

Run: `npm test -- plans`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat: tabela de planos com limites e precos"
```

---

### Task 3: Workspaces ativos e excedentes

Esta é a regra de negócio central: com plano `solo` e três workspaces, o mais antigo funciona e os dois mais novos entram em somente-leitura.

**Files:**
- Create: `src/server/tenant/subscription.ts`
- Modify: `src/server/tenant/subscription.test.ts`

**Interfaces:**
- Consumes: `effectiveLimit` da Task 2
- Produces: `activeWorkspaceIds(userId: string): Promise<Set<string>>`, `getSubscription(userId: string): Promise<Subscription | null>`, `isSubscriptionUsable(sub: Subscription | null, now?: Date): boolean`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `src/server/tenant/subscription.test.ts`:

```ts
import { activeWorkspaceIds, isSubscriptionUsable } from "./subscription";

describe("workspaces ativos por plano", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function ownerWith(plan: string, count: number) {
    const user = await testDb.user.create({
      data: { id: `u-${plan}-${count}`, name: "Dono", email: `${plan}${count}@example.com` },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan, source: "MANUAL", status: "ACTIVE" },
    });

    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const ws = await testDb.workspace.create({
        data: { name: `WS ${i}`, slug: `${plan}-${count}-${i}` },
      });
      await testDb.member.create({
        data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
      });
      ids.push(ws.id);
    }
    return { user, ids };
  }

  it("plano solo com tres workspaces ativa so o mais antigo", async () => {
    const { user, ids } = await ownerWith("solo", 3);
    const active = await activeWorkspaceIds(user.id);

    expect(active.has(ids[0])).toBe(true);
    expect(active.has(ids[1])).toBe(false);
    expect(active.has(ids[2])).toBe(false);
  });

  it("plano team ativa os quatro primeiros", async () => {
    const { user, ids } = await ownerWith("team", 5);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(4);
    expect(active.has(ids[4])).toBe(false);
  });

  it("plano unlimited ativa todos", async () => {
    const { user, ids } = await ownerWith("unlimited", 7);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(ids.length);
  });

  it("ser member nao consome cota do proprio plano", async () => {
    const { user, ids } = await ownerWith("solo", 1);
    const alheio = await testDb.workspace.create({
      data: { name: "Alheio", slug: "alheio-cota" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: alheio.id, role: "MEMBER" },
    });

    const active = await activeWorkspaceIds(user.id);
    expect(active.has(ids[0])).toBe(true);
  });
});

describe("assinatura utilizavel", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("ACTIVE vale", () => {
    expect(isSubscriptionUsable({ status: "ACTIVE" } as never, now)).toBe(true);
  });

  it("TRIALING dentro do prazo vale", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-09-10") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("TRIALING vencido nao vale", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-08-20") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("PAST_DUE dentro da tolerancia vale", () => {
    const sub = { status: "PAST_DUE", graceUntil: new Date("2026-09-05") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PAST_DUE com tolerancia vencida nao vale", () => {
    const sub = { status: "PAST_DUE", graceUntil: new Date("2026-08-25") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("sem assinatura nao vale", () => {
    expect(isSubscriptionUsable(null, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- subscription`
Expected: FAIL — `Cannot find module './subscription'`.

- [ ] **Step 3: Implementar `src/server/tenant/subscription.ts`**

```ts
import type { Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { effectiveLimit } from "@/lib/plans";

export async function getSubscription(userId: string): Promise<Subscription | null> {
  return db.subscription.findUnique({ where: { userId } });
}

export function isSubscriptionUsable(
  sub: Subscription | null,
  now: Date = new Date(),
): boolean {
  if (!sub) return false;
  if (sub.status === "ACTIVE") return true;
  if (sub.status === "TRIALING") {
    return sub.trialEndsAt === null || sub.trialEndsAt > now;
  }
  if (sub.status === "PAST_DUE") {
    return sub.graceUntil !== null && sub.graceUntil > now;
  }
  return false;
}

export async function activeWorkspaceIds(userId: string): Promise<Set<string>> {
  const [sub, owned] = await Promise.all([
    getSubscription(userId),
    db.member.findMany({
      where: { userId, role: "OWNER" },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    }),
  ]);

  const limit = effectiveLimit(sub?.plan ?? "solo", sub?.status ?? "TRIALING");
  const allowed = owned.slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);
  return new Set(allowed.map((m) => m.workspaceId));
}
```

A ordenação por `createdAt` do `Member` reflete a ordem em que a pessoa passou a ser dona de cada workspace, que é o que a regra do spec pede.

- [ ] **Step 4: Rodar os testes**

Run: `npm test -- subscription`
Expected: PASS — 10 testes.

- [ ] **Step 5: Commit**

```bash
git add src/server/tenant/subscription.ts src/server/tenant/subscription.test.ts
git commit -m "feat: calcula workspaces ativos conforme o plano"
```

---

### Task 4: Travar escrita quando não há plano

**Files:**
- Modify: `src/server/tenant/context.ts`, `src/app/(app)/layout.tsx`, `src/components/layout/app-shell.tsx`, `src/components/layout/plan-banner.tsx`
- Test: `src/server/tenant/subscription.test.ts`

**Interfaces:**
- Consumes: `activeWorkspaceIds`, `isSubscriptionUsable`, `getSubscription`
- Produces: `assertCanWrite(): Promise<void>` exportada de `src/server/tenant/context.ts`; `WorkspaceContext` ganha `canWrite: boolean`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente a `src/server/tenant/subscription.test.ts`:

```ts
import { canWriteInWorkspace } from "./subscription";

describe("permissao de escrita", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("workspace excedente fica somente leitura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-write", name: "Dono", email: "write@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL", status: "ACTIVE" },
    });

    const primeiro = await testDb.workspace.create({
      data: { name: "Primeiro", slug: "primeiro-write" },
    });
    const segundo = await testDb.workspace.create({
      data: { name: "Segundo", slug: "segundo-write" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: primeiro.id, role: "OWNER" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: segundo.id, role: "OWNER" },
    });

    expect(await canWriteInWorkspace(primeiro.id)).toBe(true);
    expect(await canWriteInWorkspace(segundo.id)).toBe(false);
  });

  it("workspace sem owner com assinatura utilizavel fica somente leitura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-nosub", name: "Sem plano", email: "nosub@example.com" },
    });
    const ws = await testDb.workspace.create({
      data: { name: "Sem plano", slug: "sem-plano" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });

    expect(await canWriteInWorkspace(ws.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- subscription`
Expected: FAIL — `canWriteInWorkspace is not exported`.

- [ ] **Step 3: Implementar `canWriteInWorkspace`**

Acrescente a `src/server/tenant/subscription.ts`:

```ts
export async function canWriteInWorkspace(workspaceId: string): Promise<boolean> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) return false;

  const sub = await getSubscription(owner.userId);
  if (!isSubscriptionUsable(sub)) return false;

  const active = await activeWorkspaceIds(owner.userId);
  return active.has(workspaceId);
}
```

- [ ] **Step 4: Expor no contexto**

Em `src/server/tenant/context.ts`, acrescente `canWrite` ao tipo `WorkspaceContext`, preencha-o em `getWorkspaceContext` chamando `canWriteInWorkspace(workspaceId)`, e exporte:

```ts
export async function assertCanWrite(): Promise<void> {
  const { canWrite } = await getWorkspaceContext();
  if (!canWrite) {
    throw new Error(
      "Este workspace está em modo somente leitura. Ative um plano para voltar a registrar.",
    );
  }
}
```

- [ ] **Step 5: Chamar `assertCanWrite` nas actions de escrita**

Em cada função exportada que grava, logo após obter o client escopado, acrescente `await assertCanWrite();`. Os arquivos: `src/server/actions/sales.ts`, `customers.ts`, `production.ts`, `markets.ts`, `catalog.ts`, `ingredients.ts`, `recipes.ts`. **Não** acrescente em `src/server/actions/workspaces.ts` nem em `subscription.ts` — quem está bloqueado precisa conseguir contratar plano e gerenciar o workspace.

- [ ] **Step 6: Ligar o banner ao estado real**

`src/app/(app)/layout.tsx` passa hoje `planStatus="TRIALING"` fixo. Troque pelo status real: leia a assinatura do OWNER do workspace ativo e passe `status` mais um booleano `isOverLimit` (verdadeiro quando a assinatura é utilizável mas o workspace não está entre os ativos). Em `src/components/layout/plan-banner.tsx`, acrescente o caso de excedente com a mensagem: "Este workspace está além do limite do seu plano. Os mais antigos continuam ativos — faça upgrade para liberar este."

- [ ] **Step 7: Rodar tudo**

```bash
npm test && npx tsc --noEmit && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/server src/app src/components
git commit -m "feat: trava escrita sem plano ativo e sinaliza excedente"
```

---

### Task 5: Trial de 14 dias na criação do primeiro workspace

**Files:**
- Modify: `src/server/tenant/workspaces.ts`
- Test: `src/server/tenant/subscription.test.ts`

**Interfaces:**
- Consumes: `getSubscription`
- Produces: `ensureTrialSubscription(userId: string): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { ensureTrialSubscription } from "./subscription";

describe("trial na criacao do primeiro workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura em trial de 14 dias", async () => {
    const user = await testDb.user.create({
      data: { id: "u-trial", name: "Nova", email: "trial@example.com" },
    });

    await ensureTrialSubscription(user.id);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });

    expect(sub?.status).toBe("TRIALING");
    expect(sub?.plan).toBe("solo");
    const dias = Math.round(
      ((sub?.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86400000,
    );
    expect(dias).toBe(14);
  });

  it("nao renova o trial de quem ja tem assinatura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-retrial", name: "Velha", email: "retrial@example.com" },
    });
    const antiga = new Date("2026-01-01");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        source: "MANUAL",
        trialEndsAt: antiga,
      },
    });

    await ensureTrialSubscription(user.id);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });

    expect(sub?.trialEndsAt?.toISOString()).toBe(antiga.toISOString());
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- subscription`
Expected: FAIL — `ensureTrialSubscription is not exported`.

- [ ] **Step 3: Implementar**

Em `src/server/tenant/subscription.ts`:

```ts
const TRIAL_DAYS = 14;

export async function ensureTrialSubscription(userId: string): Promise<void> {
  const existing = await db.subscription.findUnique({ where: { userId } });
  if (existing) return;

  await db.subscription.create({
    data: {
      userId,
      plan: "solo",
      source: "ASAAS",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
}
```

O trial nasce sem contraparte no Asaas; `source` vira `MANUAL` só quando alguém atribui um plano à mão.

- [ ] **Step 4: Chamar na criação de workspace**

Em `src/server/tenant/workspaces.ts`, dentro de `createWorkspaceForUser`, chame `await ensureTrialSubscription(userId);` antes da transação.

- [ ] **Step 5: Bloquear criação acima do limite**

Ainda em `createWorkspaceForUser`, depois de garantir o trial. Importe `effectiveLimit` de `@/lib/plans` e `getSubscription` de `./subscription`:

```ts
const sub = await getSubscription(userId);
const owned = await db.member.count({ where: { userId, role: "OWNER" } });
const limit = effectiveLimit(sub?.plan ?? "solo", sub?.status ?? "TRIALING");
if (owned + 1 > limit) {
  throw new Error(
    sub?.status === "TRIALING"
      ? "Durante o teste você pode ter um workspace. Assine um plano para criar outro."
      : "Seu plano não permite mais workspaces. Faça upgrade para criar outro.",
  );
}
```

- [ ] **Step 6: Rodar tudo**

```bash
npm test && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/server/tenant
git commit -m "feat: trial de 14 dias e limite de workspaces na criacao"
```

---

### Task 5b: Contagem regressiva do trial

Uma faixa fina no topo mostra quantos dias faltam enquanto a assinatura está em teste. Ela é informativa, não um alerta — some quando a assinatura vira `ACTIVE`.

**Files:**
- Create: `src/components/layout/trial-banner.tsx`, `src/lib/trial.test.ts`, `src/lib/trial.ts`
- Modify: `src/components/layout/app-shell.tsx`, `src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `daysUntil(date: Date | null, now?: Date): number | null`, componente `TrialBanner`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/trial.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { daysUntil } from "./trial";

describe("contagem de dias do trial", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("conta dias inteiros que faltam", () => {
    expect(daysUntil(new Date("2026-09-15T12:00:00Z"), now)).toBe(14);
    expect(daysUntil(new Date("2026-09-02T12:00:00Z"), now)).toBe(1);
  });

  it("arredonda para cima quando sobra parte do dia", () => {
    expect(daysUntil(new Date("2026-09-02T06:00:00Z"), now)).toBe(1);
  });

  it("hoje e o ultimo dia vale zero", () => {
    expect(daysUntil(new Date("2026-09-01T20:00:00Z"), now)).toBe(0);
  });

  it("data passada vale zero, nao negativo", () => {
    expect(daysUntil(new Date("2026-08-20T12:00:00Z"), now)).toBe(0);
  });

  it("sem data devolve null", () => {
    expect(daysUntil(null, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- trial`
Expected: FAIL — `Cannot find module './trial'`.

- [ ] **Step 3: Implementar `src/lib/trial.ts`**

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test -- trial`
Expected: PASS — 5 testes.

- [ ] **Step 5: Criar o componente**

`src/components/layout/trial-banner.tsx`:

```tsx
import Link from "next/link";
import { Clock } from "lucide-react";

export function TrialBanner({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return null;

  const label =
    daysLeft === 0
      ? "Seu teste termina hoje"
      : daysLeft === 1
        ? "Falta 1 dia de teste"
        : `Faltam ${daysLeft} dias de teste`;

  return (
    <div className="border-b bg-primary/5 px-4 py-1.5">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-xs md:max-w-5xl">
        <Clock className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        <Link
          href="/workspaces/plan"
          className="shrink-0 font-medium text-primary underline underline-offset-4"
        >
          Assinar
        </Link>
      </div>
    </div>
  );
}
```

A faixa tem `py-1.5` e texto `text-xs` de propósito: ela fica em toda tela durante duas semanas, então precisa custar o mínimo de altura no celular.

- [ ] **Step 6: Ligar ao shell**

Em `src/app/(app)/layout.tsx`, leia a assinatura do usuário e calcule `daysLeft = subscription?.status === "TRIALING" ? daysUntil(subscription.trialEndsAt) : null`. Passe para `AppShell`, que renderiza `<TrialBanner daysLeft={daysLeft} />` acima do `PlanBanner`.

- [ ] **Step 7: Verificar**

```bash
npm test && npx tsc --noEmit && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/trial.ts src/lib/trial.test.ts src/components/layout src/app
git commit -m "feat: contagem regressiva do trial no topo"
```

---

## Fase 2 — Integração com o Asaas

### Task 6: Cliente HTTP do Asaas

Toda chamada à API passa por aqui. Nenhum teste bate na API real.

**Files:**
- Create: `src/server/tenant/asaas.ts`, `src/server/tenant/asaas.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `asaasFetch<T>(path: string, init?: RequestInit): Promise<T>`, `createAsaasCustomer(input)`, `createAsaasSubscription(input)`, `getAsaasSubscription(id)`

- [ ] **Step 1: Escrever o teste que falha**

`src/server/tenant/asaas.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { asaasFetch, brlFromCents } from "./asaas";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cliente asaas", () => {
  it("converte centavos para o decimal que a API espera", () => {
    expect(brlFromCents(2990)).toBe(29.9);
    expect(brlFromCents(9990)).toBe(99.9);
    expect(brlFromCents(100)).toBe(1);
  });

  it("envia a chave no header access_token", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "sub_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await asaasFetch("/subscriptions");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).access_token).toBe("chave-de-teste");
  });

  it("lanca com a mensagem da API quando a resposta falha", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ errors: [{ description: "Cliente inválido" }] }),
          { status: 400 },
        ),
      ),
    );

    await expect(asaasFetch("/subscriptions")).rejects.toThrow("Cliente inválido");
  });

  it("lanca quando a chave nao esta configurada", async () => {
    vi.stubEnv("ASAAS_API_KEY", "");
    await expect(asaasFetch("/subscriptions")).rejects.toThrow(
      "ASAAS_API_KEY não configurada",
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- asaas`
Expected: FAIL — `Cannot find module './asaas'`.

- [ ] **Step 3: Implementar**

```ts
const SANDBOX = "https://api-sandbox.asaas.com/v3";
const PRODUCTION = "https://api.asaas.com/v3";

function baseUrl(): string {
  return process.env.ASAAS_ENV === "production" ? PRODUCTION : SANDBOX;
}

export function brlFromCents(cents: number): number {
  return Math.round(cents) / 100;
}

type AsaasError = { errors?: Array<{ description?: string }> };

export async function asaasFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY não configurada");

  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      access_token: key,
      "Content-Type": "application/json",
    },
  });

  const body = (await response.json()) as T & AsaasError;

  if (!response.ok) {
    const message = body.errors?.[0]?.description ?? `Asaas respondeu ${response.status}`;
    throw new Error(message);
  }

  return body;
}
```

- [ ] **Step 4: Acrescentar as funções de domínio**

```ts
export type AsaasCustomer = { id: string };
export type AsaasSubscription = { id: string; status: string; nextDueDate: string };

export async function createAsaasCustomer(input: {
  name: string;
  email: string;
  cpfCnpj: string;
}): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createAsaasSubscription(input: {
  customer: string;
  billingType: "PIX" | "CREDIT_CARD" | "BOLETO";
  value: number;
  nextDueDate: string;
  cycle: "MONTHLY" | "YEARLY";
  description: string;
}): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ ...input, paymentCreationMode: "SUBSCRIPTION" }),
  });
}

export async function getAsaasSubscription(id: string): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>(`/subscriptions/${id}`);
}
```

`paymentCreationMode: "SUBSCRIPTION"` é o que ativa o Pix Automático. **Confirme na documentação vigente** (https://docs.asaas.com/reference/criar-nova-assinatura) que o campo e os valores de `cycle` continuam com esses nomes antes de considerar a task pronta, e registre no relatório o que verificou.

- [ ] **Step 5: Documentar as variáveis**

Acrescente ao `.env.example`:

```
# Asaas (cobranca)
ASAAS_API_KEY=""
ASAAS_ENV="sandbox"
ASAAS_WEBHOOK_TOKEN=""
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test -- asaas`
Expected: PASS — 4 testes.

- [ ] **Step 7: Commit**

```bash
git add src/server/tenant/asaas.ts src/server/tenant/asaas.test.ts .env.example
git commit -m "feat: cliente http do asaas"
```

---

### Task 7: Webhook de cobrança

O Asaas **não emite webhook de assinatura**, apenas de cobrança. Toda cobrança de uma assinatura carrega o campo `subscription` no payload, e é por ele que se faz o vínculo.

**Files:**
- Create: `src/app/api/webhooks/asaas/route.ts`, `src/server/tenant/asaas-events.ts`, `src/server/tenant/asaas-events.test.ts`
- Modify: `prisma/schema.prisma` (model `ProcessedWebhookEvent`)

**Interfaces:**
- Consumes: `getSubscription`
- Produces: `applyPaymentEvent(event: PaymentEvent): Promise<"applied" | "duplicate" | "unknown">`

- [ ] **Step 1: Escrever os testes que falham**

`src/server/tenant/asaas-events.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { applyPaymentEvent } from "./asaas-events";

async function subscriptionFor(email: string, asaasId: string) {
  const user = await testDb.user.create({
    data: { id: `u-${asaasId}`, name: "Dono", email },
  });
  return testDb.subscription.create({
    data: {
      userId: user.id,
      plan: "solo",
      source: "ASAAS",
      status: "TRIALING",
      asaasSubscriptionId: asaasId,
    },
  });
}

describe("eventos de cobranca", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("pagamento confirmado ativa a assinatura", async () => {
    const sub = await subscriptionFor("conf@example.com", "sub_conf");

    await applyPaymentEvent({
      id: "evt_1",
      event: "PAYMENT_CONFIRMED",
      subscriptionId: "sub_conf",
      dueDate: "2026-10-01",
    });

    const updated = await testDb.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.graceUntil).toBeNull();
  });

  it("pagamento vencido marca inadimplencia com sete dias de tolerancia", async () => {
    const sub = await subscriptionFor("over@example.com", "sub_over");

    await applyPaymentEvent({
      id: "evt_2",
      event: "PAYMENT_OVERDUE",
      subscriptionId: "sub_over",
      dueDate: "2026-10-01",
    });

    const updated = await testDb.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.status).toBe("PAST_DUE");
    const dias = Math.round(
      ((updated?.graceUntil?.getTime() ?? 0) - Date.now()) / 86400000,
    );
    expect(dias).toBe(7);
  });

  it("evento repetido nao reaplica efeito", async () => {
    await subscriptionFor("dup@example.com", "sub_dup");

    const first = await applyPaymentEvent({
      id: "evt_3",
      event: "PAYMENT_CONFIRMED",
      subscriptionId: "sub_dup",
      dueDate: "2026-10-01",
    });
    const second = await applyPaymentEvent({
      id: "evt_3",
      event: "PAYMENT_OVERDUE",
      subscriptionId: "sub_dup",
      dueDate: "2026-10-01",
    });

    expect(first).toBe("applied");
    expect(second).toBe("duplicate");

    const sub = await testDb.subscription.findFirst({
      where: { asaasSubscriptionId: "sub_dup" },
    });
    expect(sub?.status).toBe("ACTIVE");
  });

  it("assinatura desconhecida nao quebra", async () => {
    const result = await applyPaymentEvent({
      id: "evt_4",
      event: "PAYMENT_CONFIRMED",
      subscriptionId: "sub_inexistente",
      dueDate: "2026-10-01",
    });
    expect(result).toBe("unknown");
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- asaas-events`
Expected: FAIL — `Cannot find module './asaas-events'`.

- [ ] **Step 3: Acrescentar o model de idempotência**

Em `prisma/schema.prisma`:

```prisma
model ProcessedWebhookEvent {
  id         String   @id
  event      String
  receivedAt DateTime @default(now())

  @@map("processed_webhook_event")
}
```

Gere e aplique a migration como na Task 1, e rode `npx prisma generate`.

- [ ] **Step 4: Implementar**

`src/server/tenant/asaas-events.ts`:

```ts
import { db } from "@/lib/db";

const GRACE_DAYS = 7;

export type PaymentEvent = {
  id: string;
  event: string;
  subscriptionId: string | null;
  dueDate: string | null;
};

export type EventOutcome = "applied" | "duplicate" | "unknown";

export async function applyPaymentEvent(event: PaymentEvent): Promise<EventOutcome> {
  const seen = await db.processedWebhookEvent.findUnique({ where: { id: event.id } });
  if (seen) return "duplicate";

  if (!event.subscriptionId) {
    await db.processedWebhookEvent.create({
      data: { id: event.id, event: event.event },
    });
    return "unknown";
  }

  const sub = await db.subscription.findFirst({
    where: { asaasSubscriptionId: event.subscriptionId },
  });

  if (!sub) {
    await db.processedWebhookEvent.create({
      data: { id: event.id, event: event.event },
    });
    return "unknown";
  }

  const data = statusFor(event.event, event.dueDate);

  if (data) {
    await db.$transaction([
      db.subscription.update({ where: { id: sub.id }, data }),
      db.processedWebhookEvent.create({
        data: { id: event.id, event: event.event },
      }),
    ]);
    return "applied";
  }

  await db.processedWebhookEvent.create({
    data: { id: event.id, event: event.event },
  });
  return "applied";
}

function statusFor(event: string, dueDate: string | null) {
  if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
    return {
      status: "ACTIVE" as const,
      graceUntil: null,
      currentPeriodEnd: dueDate ? new Date(dueDate) : null,
    };
  }
  if (event === "PAYMENT_OVERDUE") {
    return {
      status: "PAST_DUE" as const,
      graceUntil: new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000),
    };
  }
  return null;
}
```

- [ ] **Step 5: Criar a rota do webhook**

`src/app/api/webhooks/asaas/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { applyPaymentEvent } from "@/server/tenant/asaas-events";

export async function POST(request: NextRequest) {
  const token = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!token || request.headers.get("asaas-access-token") !== token) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const body = (await request.json()) as {
    id?: string;
    event?: string;
    payment?: { subscription?: string; dueDate?: string };
  };

  if (!body.id || !body.event) {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const outcome = await applyPaymentEvent({
    id: body.id,
    event: body.event,
    subscriptionId: body.payment?.subscription ?? null,
    dueDate: body.payment?.dueDate ?? null,
  });

  return NextResponse.json({ outcome });
}
```

O header de autenticação é `asaas-access-token`, configurado no painel do Asaas junto da URL. **Confirme o nome do header e o formato do payload** na documentação vigente antes de fechar a task, e registre no relatório.

- [ ] **Step 6: Rodar os testes**

```bash
npm run test:db:setup && npm test -- asaas-events
```

Expected: PASS — 4 testes.

- [ ] **Step 7: Commit**

```bash
git add prisma src/server/tenant/asaas-events.ts src/server/tenant/asaas-events.test.ts src/app/api/webhooks
git commit -m "feat: webhook de cobranca do asaas com idempotencia"
```

---

### Task 8: Reconciliação diária

Um evento perdido ou fora de ordem desalinha o status. Esta rotina compara com a verdade do gateway — e **ignora assinaturas manuais**, que não têm contraparte lá.

**Files:**
- Create: `scripts/reconcile-subscriptions.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `getAsaasSubscription` da Task 6

- [ ] **Step 1: Implementar o script**

```ts
import { PrismaClient } from "@prisma/client";
import { DIRECT_DATABASE_URL } from "./direct-database-url";
import { getAsaasSubscription } from "../src/server/tenant/asaas";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

async function main() {
  const subs = await db.subscription.findMany({
    where: { source: "ASAAS", asaasSubscriptionId: { not: null } },
  });

  let checked = 0;
  let corrected = 0;

  for (const sub of subs) {
    checked += 1;
    try {
      const remote = await getAsaasSubscription(sub.asaasSubscriptionId as string);
      const expected = remote.status === "ACTIVE" ? "ACTIVE" : "PAST_DUE";
      if (sub.status !== expected && sub.status !== "CANCELED") {
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: expected },
        });
        corrected += 1;
        console.log(`corrigido ${sub.id}: ${sub.status} -> ${expected}`);
      }
    } catch (e) {
      console.error(`falha ao consultar ${sub.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`verificadas: ${checked}, corrigidas: ${corrected}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

O filtro `source: "ASAAS"` é o que impede a rotina de derrubar a assinatura de um cliente negociado à mão, que não existe no gateway.

- [ ] **Step 2: Registrar o script**

Em `package.json`, dentro de `"scripts"`:

```json
"reconcile": "dotenv -e .env -- tsx scripts/reconcile-subscriptions.ts"
```

- [ ] **Step 3: Provar que assinaturas manuais são ignoradas**

Crie no banco local uma assinatura com `source = MANUAL` e `asaasSubscriptionId = null`, rode `npm run reconcile`, e confirme pela saída que ela não foi consultada nem alterada. Registre a saída no relatório.

- [ ] **Step 4: Commit**

```bash
git add scripts/reconcile-subscriptions.ts package.json
git commit -m "feat: reconciliacao diaria de assinaturas"
```

---

## Fase 3 — Contratação

### Task 9: Tela de assinatura

**Files:**
- Create: `src/app/(app)/workspaces/plan/page.tsx`, `src/components/workspaces/plan-panel.tsx`, `src/server/actions/subscription.ts`

**Interfaces:**
- Consumes: `PLANS`, `planPriceCents`, `getSubscription`, `activeWorkspaceIds`, `createAsaasCustomer`, `createAsaasSubscription`
- Produces: `subscribe(formData: FormData): Promise<ActionResult>`

- [ ] **Step 1: Criar a action de contratação**

`src/server/actions/subscription.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { planPriceCents, type PlanCycle } from "@/lib/plans";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getSubscription } from "@/server/tenant/subscription";
import { brlFromCents, createAsaasCustomer, createAsaasSubscription } from "@/server/tenant/asaas";
import { db } from "@/lib/db";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

export async function subscribe(formData: FormData): Promise<ActionResult> {
  const plan = String(formData.get("plan") ?? "solo");
  const cycle = String(formData.get("cycle") ?? "MONTHLY") as PlanCycle;
  const cpfCnpj = String(formData.get("cpfCnpj") ?? "").replace(/\D/g, "");

  const priceCents = planPriceCents(plan, cycle);
  if (priceCents === null) {
    return { ok: false, error: "Este plano é contratado por atendimento." };
  }
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return { ok: false, error: "Informe um CPF ou CNPJ válido." };
  }

  try {
    const { userId } = await getWorkspaceContext();
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    const existing = await getSubscription(userId);

    const customerId =
      existing?.asaasCustomerId ??
      (await createAsaasCustomer({ name: user.name, email: user.email, cpfCnpj })).id;

    const value = cycle === "YEARLY" ? brlFromCents(priceCents * 12) : brlFromCents(priceCents);

    const remote = await createAsaasSubscription({
      customer: customerId,
      billingType: "PIX",
      value,
      nextDueDate: new Date().toISOString().slice(0, 10),
      cycle,
      description: `Coolkies — plano ${plan}`,
    });

    await db.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan,
        source: "ASAAS",
        status: "TRIALING",
        asaasCustomerId: customerId,
        asaasSubscriptionId: remote.id,
      },
      update: {
        plan,
        source: "ASAAS",
        asaasCustomerId: customerId,
        asaasSubscriptionId: remote.id,
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na contratação." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
```

O status só vira `ACTIVE` quando o webhook confirmar o pagamento — a contratação não presume que o dinheiro entrou.

- [ ] **Step 2: Criar a tela**

`src/app/(app)/workspaces/plan/page.tsx` lê a assinatura e a contagem de workspaces do usuário e passa para o painel:

```tsx
import { PageHeader } from "@/components/shared/page-header";
import { PlanPanel } from "@/components/workspaces/plan-panel";
import { getWorkspaceContext } from "@/server/tenant/context";
import { activeWorkspaceIds, getSubscription } from "@/server/tenant/subscription";
import { db } from "@/lib/db";

export default async function PlanPage() {
  const { userId } = await getWorkspaceContext();
  const [sub, owned, active] = await Promise.all([
    getSubscription(userId),
    db.member.count({ where: { userId, role: "OWNER" } }),
    activeWorkspaceIds(userId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assinatura"
        description="Seu plano define quantos workspaces você pode ter."
      />
      <PlanPanel
        currentPlan={sub?.plan ?? null}
        status={sub?.status ?? null}
        source={sub?.source ?? null}
        ownedCount={owned}
        activeCount={active.size}
      />
    </div>
  );
}
```

- [ ] **Step 3: Criar o painel**

`src/components/workspaces/plan-panel.tsx` mostra os três planos em cartões, com preço mensal e anual vindos de `PLANS`, marcando o atual. O plano `unlimited` não tem botão de contratar: exibe "Fale com a gente" e um `mailto:`. Para os demais, um dialog pede CPF ou CNPJ e chama `subscribe`.

Quando `source === "MANUAL"`, exiba um aviso de que a assinatura foi atribuída manualmente e não é gerenciada por aqui, sem botão de troca de plano — mexer nela pelo app apagaria o acordo feito por fora.

Quando `ownedCount > activeCount`, mostre quantos workspaces estão em somente-leitura e qual plano resolveria.

- [ ] **Step 4: Verificar**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app src/components src/server/actions/subscription.ts
git commit -m "feat: tela de assinatura e contratacao"
```

---

## Estado ao fim deste plano

- Assinatura por usuário, com trial de 14 dias na criação do primeiro workspace
- Limite de workspaces por plano, com os mais antigos ativos e os excedentes em somente-leitura
- Escrita travada quando não há plano utilizável, leitura sempre livre
- Cobrança por Pix Automático via Asaas, com estado derivado dos webhooks de cobrança e reconciliado diariamente
- Assinaturas atribuídas à mão convivem com as do gateway e não são tocadas pela reconciliação

## O que fica fora

- Troca de plano com cálculo proporcional (upgrade/downgrade no meio do ciclo)
- Cancelamento pela interface — hoje é conversa e `UPDATE`
- Emissão de nota fiscal
- Cupons e descontos
- Cobrança por cartão e boleto: o cliente existe na API, mas a interface só oferece Pix
