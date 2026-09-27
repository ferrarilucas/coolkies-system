# Bloqueantes para abrir o SaaS — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 5 bloqueantes que impedem abrir o cadastro do Coolkies para desconhecidos: liberação de recursos por plano, verificação de e-mail e recuperação de senha, termos/privacidade/LGPD, limite de requisições e reconciliação de assinaturas agendada.

**Architecture:** São 5 subsistemas independentes, entregues como 5 fases em sequência. Cada fase termina com o app funcionando e pode ir para produção sozinha. A liberação por plano é uma camada pura (`planHasFeature`) mais um resolvedor no servidor (`workspaceHasFeature`), aplicada nos 3 pontos de entrada dos recursos do Cresce. E-mail e rate limit de `/api/auth/*` usam o que o better-auth 1.6.15 já oferece (`emailVerification`, `sendResetPassword`, `rateLimit.storage = "database"`). A API `/api/v1/*` ganha um limitador próprio em Postgres, preso ao ponto único de autenticação MCP. A reconciliação sai do script manual e vira uma rota de cron da Vercel protegida por `CRON_SECRET`.

**Tech Stack:** Next.js 15.1 App Router, better-auth 1.6.15, Prisma 6 + PostgreSQL, Resend, Vitest, Vercel Cron.

**Spec:** Não há spec formal. As decisões vêm da auditoria de 2026-09-27 (resposta "O que falta pra virar SaaS", seção 🔴) e das respostas do dono nesta sessão:

| Decisão | Resposta |
|---|---|
| Trial dá acesso a quê | **Cresce completo** durante os 14 dias (o limite de 1 workspace no trial continua) |
| O que exige Cresce | **Painel consolidado, link público do painel, lista de compras automática.** CSV continua liberado para todos |
| Exclusão de conta de quem é OWNER | **Exclui em cascata** a conta e todos os workspaces próprios, com os dados dos outros membros |
| Contas de e-mail/senha antigas sem verificação | **Marcar como verificadas** numa migration; a exigência vale só para cadastros novos |

Documentos relacionados que o executor deve ler antes: [2026-08-29-multi-tenant-workspaces-design.md](../specs/2026-08-29-multi-tenant-workspaces-design.md) (isolamento, papéis, somente-leitura) e [2026-09-14-pendencias-planos.md](./2026-09-14-pendencias-planos.md) (onde a falta de liberação por plano foi registrada).

## Global Constraints

- **Sem comentários no código.** Regra do projeto (`~/.claude/CLAUDE.md`), sem exceção.
- Testes rodam com `pnpm test` (nunca `npm`/`yarn`: o disco do ambiente vive perto de 100%).
- Migrations são escritas à mão em `prisma/migrations/<YYYYMMDDHHMMSS>_<nome>/migration.sql` e aplicadas via `docker exec -i cookies_db psql -U cookies -d cookies < arquivo` **e** `-d cookies_test`, seguidas de `pnpm exec prisma generate`. **Nunca** `prisma migrate dev`. Em produção, a mesma SQL é aplicada via `DIRECT_URL` (porta 5432) **antes** do deploy do código que depende dela.
- `@/lib/db` (client cru) só pode ser importado em `src/server/tenant/**` e nos arquivos já listados em `eslint.config.mjs`. Código de domínio usa `getScopedDb()`/`getWorkspaceDb()`.
- Código e identificadores em inglês. Texto visível ao usuário em português, com acentuação correta.
- Mensagens de erro diretas e sem jargão, no tom das que já existem em `src/server/tenant/workspaces.ts`.
- Dinheiro em centavos inteiros; datas como `Date`.
- Toda rota nova sem sessão precisa entrar **nas duas** listas do `src/middleware.ts`: `PUBLIC_PATHS` e a exclusão negativa do `config.matcher`.
- Tabela nova que os testes gravam precisa entrar em `TABLES` de `src/test/db.ts`.
- Commits pequenos, um por Task, mensagem em português no padrão `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Trial que venceu sem assinatura:** a pessoa perde os recursos do Cresce, e um link público que ela já tinha compartilhado passa a responder 404 (não 500 nem dados). Teste na Task 2 (`workspaceHasFeature` com trial vencido) e na Task 3 (`/p/[token]` usa o mesmo resolvedor).
2. **Link de redefinição de senha usado duas vezes ou expirado:** a segunda tentativa falha com mensagem clara e não troca a senha. Teste na Task 8.
3. **Excluir a conta com assinatura ativa quando o provedor (InterPix/Stripe) está fora do ar:** nada é excluído e a pessoa recebe um erro; senão a cobrança continuaria sem cliente. Teste na Task 13.
4. **Excluir a conta de quem registrou vendas no workspace de outra pessoa:** as vendas continuam lá, com `userId` nulo; o workspace alheio não perde nada. Teste na Task 13.
5. **Cron chamado sem segredo, ou com `CRON_SECRET` ausente no ambiente:** responde 401 e não roda nada. Não pode ficar aberto por falta de configuração. Teste na Task 19.

---

# Fase 1 — Liberação de recursos por plano

Estado ao fim: Corre não acessa consolidado, link público nem sugestões automáticas; Cresce, Escala e trial acessam. O CSV continua aberto e a copy da página de planos passa a dizer isso.

### Task 1: `planHasFeature` e o plano efetivo de recursos

**Files:**
- Modify: `src/lib/plans.ts`
- Modify: `src/server/tenant/subscription.ts`
- Test: `src/lib/plans.test.ts`
- Test: `src/server/tenant/subscription.test.ts`

**Interfaces:**
- Produces: `type PlanFeature = "consolidatedDashboard" | "publicLink" | "autoShoppingList"`, `TRIAL_FEATURE_PLAN = "cresce"`, `planHasFeature(plan: string, feature: PlanFeature): boolean` em `@/lib/plans`.
- Produces: `featurePlanFor(sub: Subscription | null, now?: Date): string` e `subscriptionHasFeature(sub: Subscription | null, feature: PlanFeature, now?: Date): boolean` em `@/server/tenant/subscription`.

- [ ] **Step 1: Write the failing tests**

Em `src/lib/plans.test.ts`, acrescentar `planHasFeature` e `PLANS` ao import de `./plans` e adicionar ao final:

```ts
describe("planHasFeature", () => {
  it("corre não tem nenhum recurso do Cresce", () => {
    expect(planHasFeature("corre", "consolidatedDashboard")).toBe(false);
    expect(planHasFeature("corre", "publicLink")).toBe(false);
    expect(planHasFeature("corre", "autoShoppingList")).toBe(false);
  });

  it("cresce e escala têm todos os recursos", () => {
    for (const plan of ["cresce", "escala"]) {
      expect(planHasFeature(plan, "consolidatedDashboard")).toBe(true);
      expect(planHasFeature(plan, "publicLink")).toBe(true);
      expect(planHasFeature(plan, "autoShoppingList")).toBe(true);
    }
  });

  it("plano desconhecido cai no corre", () => {
    expect(planHasFeature("plano-que-nao-existe", "publicLink")).toBe(false);
  });

  it("todo plano do catálogo tem mapa de recursos", () => {
    for (const p of PLANS) {
      expect(() => planHasFeature(p.id, "publicLink")).not.toThrow();
    }
  });

  it("CSV é anunciado no Corre, não no Cresce", () => {
    const corre = PLANS.find((p) => p.id === "corre");
    const cresce = PLANS.find((p) => p.id === "cresce");
    expect(corre?.features.some((f) => f.includes("CSV"))).toBe(true);
    expect(cresce?.features.some((f) => f.includes("CSV"))).toBe(false);
  });
});
```

Em `src/server/tenant/subscription.test.ts`, acrescentar `featurePlanFor` e `subscriptionHasFeature` ao import de `./subscription` e adicionar ao final (usa o `buildSubscription` que já existe no topo do arquivo):

```ts
describe("recursos por plano", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const future = new Date("2026-10-05T00:00:00Z");
  const past = new Date("2026-09-20T00:00:00Z");

  it("sem assinatura vale corre e não tem recurso nenhum", () => {
    expect(featurePlanFor(null, now)).toBe("corre");
    expect(subscriptionHasFeature(null, "publicLink", now)).toBe(false);
  });

  it("trial em andamento libera o Cresce mesmo com plano corre gravado", () => {
    const sub = buildSubscription({ plan: "corre", status: "TRIALING", trialEndsAt: future });
    expect(featurePlanFor(sub, now)).toBe("cresce");
    expect(subscriptionHasFeature(sub, "consolidatedDashboard", now)).toBe(true);
  });

  it("checkout pendente dentro do trial continua com o Cresce", () => {
    const sub = buildSubscription({ plan: "corre", status: "PENDING_AUTH", trialEndsAt: future });
    expect(subscriptionHasFeature(sub, "autoShoppingList", now)).toBe(true);
  });

  it("trial vencido não libera nada", () => {
    const sub = buildSubscription({ plan: "corre", status: "TRIALING", trialEndsAt: past });
    expect(subscriptionHasFeature(sub, "publicLink", now)).toBe(false);
  });

  it("corre ativo não tem recursos do Cresce", () => {
    const sub = buildSubscription({ plan: "corre", status: "ACTIVE" });
    expect(subscriptionHasFeature(sub, "publicLink", now)).toBe(false);
  });

  it("cresce ativo tem os recursos", () => {
    const sub = buildSubscription({ plan: "cresce", status: "ACTIVE" });
    expect(subscriptionHasFeature(sub, "publicLink", now)).toBe(true);
  });

  it("cresce cancelado sem período pago não tem os recursos", () => {
    const sub = buildSubscription({ plan: "cresce", status: "CANCELED" });
    expect(subscriptionHasFeature(sub, "publicLink", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/plans.test.ts src/server/tenant/subscription.test.ts`
Expected: FAIL com `planHasFeature is not a function` / `featurePlanFor is not a function`, e o teste de CSV falhando.

- [ ] **Step 3: Implement**

Em `src/lib/plans.ts`, logo depois do array `PLANS`:

```ts
export type PlanFeature = "consolidatedDashboard" | "publicLink" | "autoShoppingList";

const CRESCE_FEATURES: ReadonlyArray<PlanFeature> = [
  "consolidatedDashboard",
  "publicLink",
  "autoShoppingList",
];

const PLAN_FEATURES: Record<string, ReadonlyArray<PlanFeature>> = {
  corre: [],
  cresce: CRESCE_FEATURES,
  escala: CRESCE_FEATURES,
};

export const TRIAL_FEATURE_PLAN = "cresce";

export function planHasFeature(plan: string, feature: PlanFeature): boolean {
  return PLAN_FEATURES[findPlan(plan).id].includes(feature);
}
```

No mesmo arquivo, mover a linha `"Exportação dos dados em CSV para contador e sócio",` da lista `features` do `cresce` para a lista do `corre`, logo depois de `"Painel de faturamento, ticket médio e filtros por período",`.

Em `src/server/tenant/subscription.ts`, trocar o import de `@/lib/plans` por:

```ts
import { effectiveLimit, planHasFeature, TRIAL_FEATURE_PLAN, type PlanFeature } from "@/lib/plans";
```

e adicionar, logo depois de `isSubscriptionUsable`:

```ts
export function featurePlanFor(sub: Subscription | null, now: Date = new Date()): string {
  if (!sub) return "corre";
  const trialRunning = sub.trialEndsAt !== null && sub.trialEndsAt > now;
  if (sub.status === "TRIALING" && (sub.trialEndsAt === null || trialRunning)) {
    return TRIAL_FEATURE_PLAN;
  }
  if (sub.status === "PENDING_AUTH" && trialRunning) return TRIAL_FEATURE_PLAN;
  return sub.plan;
}

export function subscriptionHasFeature(
  sub: Subscription | null,
  feature: PlanFeature,
  now: Date = new Date(),
): boolean {
  if (!isSubscriptionUsable(sub, now)) return false;
  return planHasFeature(featurePlanFor(sub, now), feature);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/plans.test.ts src/server/tenant/subscription.test.ts`
Expected: PASS. Depois `pnpm test` completo: se algum teste de copy (`plan-card-state`, `plan-checkout-card-copy`) contava itens da lista de features, ajustar a contagem esperada ao novo número. A mudança de copy é intencional.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts src/server/tenant/subscription.ts src/server/tenant/subscription.test.ts
git commit -m "feat(planos): mapa de recursos por plano com trial liberando o Cresce"
```

### Task 2: Resolvedor de recursos no servidor

**Files:**
- Create: `src/server/tenant/features.ts`
- Test: `src/server/tenant/features.test.ts`

**Interfaces:**
- Consumes: `getSubscription`, `subscriptionHasFeature` (Task 1).
- Produces: `FEATURE_UNAVAILABLE_MESSAGE: string`, `class FeatureUnavailableError`, `userHasFeature(userId: string, feature: PlanFeature): Promise<boolean>`, `workspaceHasFeature(workspaceId: string, feature: PlanFeature): Promise<boolean>`, `assertWorkspaceFeature(workspaceId: string, feature: PlanFeature): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import {
  assertWorkspaceFeature,
  FEATURE_UNAVAILABLE_MESSAGE,
  userHasFeature,
  workspaceHasFeature,
} from "./features";

const DAY = 24 * 60 * 60 * 1000;

async function ownerWith(id: string, sub: { plan: string; status: "ACTIVE" | "TRIALING"; trialEndsAt?: Date }) {
  const user = await testDb.user.create({ data: { id, name: "Dona", email: `${id}@example.com` } });
  await testDb.subscription.create({ data: { userId: user.id, ...sub } });
  const ws = await createWorkspace(`WS ${id}`);
  await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "OWNER" } });
  return { user, ws };
}

describe("features", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("dono no cresce libera o recurso no workspace", async () => {
    const { user, ws } = await ownerWith("u-cresce", { plan: "cresce", status: "ACTIVE" });
    expect(await userHasFeature(user.id, "consolidatedDashboard")).toBe(true);
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(true);
  });

  it("dono no corre não libera", async () => {
    const { ws } = await ownerWith("u-corre", { plan: "corre", status: "ACTIVE" });
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(false);
  });

  it("trial em andamento libera, trial vencido não", async () => {
    const running = await ownerWith("u-trial", {
      plan: "corre",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + 3 * DAY),
    });
    const expired = await ownerWith("u-trial-vencido", {
      plan: "corre",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() - DAY),
    });
    expect(await workspaceHasFeature(running.ws.id, "autoShoppingList")).toBe(true);
    expect(await workspaceHasFeature(expired.ws.id, "autoShoppingList")).toBe(false);
  });

  it("membro comum herda o plano do dono", async () => {
    const { ws } = await ownerWith("u-dona", { plan: "cresce", status: "ACTIVE" });
    const member = await testDb.user.create({ data: { id: "u-membro", name: "M", email: "m@example.com" } });
    await testDb.member.create({ data: { userId: member.id, workspaceId: ws.id, role: "MEMBER" } });
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(true);
    expect(await userHasFeature(member.id, "publicLink")).toBe(false);
  });

  it("workspace sem dono não libera", async () => {
    const ws = await createWorkspace("Órfão");
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(false);
  });

  it("assertWorkspaceFeature lança a mensagem de upgrade", async () => {
    const { ws } = await ownerWith("u-corre-2", { plan: "corre", status: "ACTIVE" });
    await expect(assertWorkspaceFeature(ws.id, "publicLink")).rejects.toThrow(FEATURE_UNAVAILABLE_MESSAGE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/server/tenant/features.test.ts`
Expected: FAIL com `Failed to resolve import "./features"`.

- [ ] **Step 3: Implement**

```ts
import type { PlanFeature } from "@/lib/plans";
import { db } from "@/lib/db";
import { getSubscription, subscriptionHasFeature } from "./subscription";

export const FEATURE_UNAVAILABLE_MESSAGE =
  "Este recurso faz parte do plano Cresce. Faça upgrade para usar.";

export class FeatureUnavailableError extends Error {
  constructor() {
    super(FEATURE_UNAVAILABLE_MESSAGE);
    this.name = "FeatureUnavailableError";
  }
}

export async function userHasFeature(userId: string, feature: PlanFeature): Promise<boolean> {
  return subscriptionHasFeature(await getSubscription(userId), feature);
}

export async function workspaceHasFeature(
  workspaceId: string,
  feature: PlanFeature,
): Promise<boolean> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) return false;
  return userHasFeature(owner.userId, feature);
}

export async function assertWorkspaceFeature(
  workspaceId: string,
  feature: PlanFeature,
): Promise<void> {
  if (!(await workspaceHasFeature(workspaceId, feature))) {
    throw new FeatureUnavailableError();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/server/tenant/features.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tenant/features.ts src/server/tenant/features.test.ts
git commit -m "feat(planos): resolvedor de recursos por workspace e por usuário"
```

### Task 3: Link público exige Cresce

**Files:**
- Create: `src/components/shared/upgrade-notice.tsx`
- Modify: `src/server/actions/public-link.ts`
- Modify: `src/app/p/[token]/page.tsx`
- Modify: `src/app/(app)/workspaces/public-link/page.tsx`
- Test: `src/server/actions/public-link.test.ts`

**Interfaces:**
- Consumes: `assertWorkspaceFeature`, `workspaceHasFeature`, `FEATURE_UNAVAILABLE_MESSAGE` (Task 2).
- Produces: `UpgradeNotice({ title: string; description: string })`, componente server-safe usado nas Tasks 4 e 5.

- [ ] **Step 1: Write the failing tests**

Em `src/server/actions/public-link.test.ts`, o helper `seedOwnerSession` passa a receber o plano e criar a assinatura. Substituir a assinatura e o corpo do helper por:

```ts
async function seedOwnerSession(workspaceId: string, plan: string = "cresce") {
  const user = await testDb.user.create({
    data: { id: `owner-${workspaceId}`, name: "Dona", email: `dona-${workspaceId}@example.com` },
  });
  await testDb.subscription.create({ data: { userId: user.id, plan, status: "ACTIVE" } });
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
```

Adicionar `import { FEATURE_UNAVAILABLE_MESSAGE } from "@/server/tenant/features";` e, dentro do `describe("togglePublicLink")`:

```ts
  it("dono no corre não consegue ativar", async () => {
    const workspace = await createWorkspace("Confeitaria Corre");
    await seedOwnerSession(workspace.id, "corre");

    const res = await togglePublicLink(true);

    expect(res).toEqual({ ok: false, error: FEATURE_UNAVAILABLE_MESSAGE });
    const row = await testDb.workspace.findUnique({ where: { id: workspace.id } });
    expect(row?.publicToken).toBeNull();
  });

  it("dono no corre ainda consegue desativar um link antigo", async () => {
    const workspace = await createWorkspace("Confeitaria Rebaixada");
    await seedOwnerSession(workspace.id, "corre");
    await testDb.workspace.update({ where: { id: workspace.id }, data: { publicToken: "token-antigo-123456789" } });

    const res = await togglePublicLink(false);

    expect(res.ok).toBe(true);
    const row = await testDb.workspace.findUnique({ where: { id: workspace.id } });
    expect(row?.publicToken).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/server/actions/public-link.test.ts`
Expected: FAIL em "dono no corre não consegue ativar" (hoje ativa e devolve token).

- [ ] **Step 3: Implement**

`src/components/shared/upgrade-notice.tsx`:

```tsx
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export function UpgradeNotice({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      icon={Sparkles}
      title={title}
      description={description}
      action={
        <Button asChild>
          <Link href="/workspaces/plan">Ver planos</Link>
        </Button>
      }
    />
  );
}
```

Em `src/server/actions/public-link.ts`, importar `assertWorkspaceFeature` de `@/server/tenant/features` e inserir, logo antes de `const token = await enablePublicLink(workspaceId);`:

```ts
    await assertWorkspaceFeature(workspaceId, "publicLink");
```

Em `src/app/p/[token]/page.tsx`, importar `workspaceHasFeature` de `@/server/tenant/features` e, logo depois de `if (!active) notFound();`:

```tsx
  if (!(await workspaceHasFeature(workspace.id, "publicLink"))) notFound();
```

Substituir o corpo de `src/app/(app)/workspaces/public-link/page.tsx` por:

```tsx
import { PageHeader } from "@/components/shared/page-header";
import { UpgradeNotice } from "@/components/shared/upgrade-notice";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getPublicLinkState } from "@/server/tenant/public-link";
import { workspaceHasFeature } from "@/server/tenant/features";
import { PublicLinkToggle } from "@/components/workspaces/public-link-toggle";

export default async function PublicLinkPage() {
  const { workspaceId, role } = await getWorkspaceContext();
  const [{ token }, allowed] = await Promise.all([
    getPublicLinkState(workspaceId),
    workspaceHasFeature(workspaceId, "publicLink"),
  ]);
  const publicUrl = token
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/p/${token}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Link público do painel"
        description="Compartilhe o faturamento do mês sem precisar dar login a ninguém."
      />
      {allowed ? (
        <PublicLinkToggle canManage={role === "OWNER"} enabled={token !== null} publicUrl={publicUrl} />
      ) : (
        <UpgradeNotice
          title="O link público faz parte do plano Cresce"
          description="Com o Cresce, quem precisa só olhar acompanha o faturamento do mês sem login. Links já compartilhados ficam desativados até o upgrade."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/server/actions/public-link.test.ts src/server/tenant/public-link.test.ts`
Expected: PASS. Se `src/server/tenant/public-link.test.ts` renderizar `/p/[token]` ou chamar `canWriteInWorkspace` com dono sem assinatura, ele não é afetado; só a action e a página mudaram.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/upgrade-notice.tsx src/server/actions/public-link.ts src/server/actions/public-link.test.ts "src/app/p/[token]/page.tsx" "src/app/(app)/workspaces/public-link/page.tsx"
git commit -m "feat(planos): link público do painel exige o plano Cresce"
```

### Task 4: Lista de compras automática exige Cresce

**Files:**
- Modify: `src/server/actions/shopping-list.ts`
- Modify: `src/app/(app)/stock/shopping-list/page.tsx`
- Test: `src/server/actions/shopping-list.test.ts`

**Interfaces:**
- Consumes: `assertWorkspaceFeature`, `workspaceHasFeature`, `FeatureUnavailableError`, `FEATURE_UNAVAILABLE_MESSAGE` (Task 2).

- [ ] **Step 1: Write the failing test**

Em `src/server/actions/shopping-list.test.ts`, logo depois do `vi.mock("@/server/tenant/context", ...)`:

```ts
const features = { allowed: true };

vi.mock("@/server/tenant/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/tenant/features")>();
  return {
    ...actual,
    assertWorkspaceFeature: async () => {
      if (!features.allowed) throw new actual.FeatureUnavailableError();
    },
  };
});
```

No `beforeEach` de topo, acrescentar `features.allowed = true;`. Adicionar `import { FEATURE_UNAVAILABLE_MESSAGE } from "@/server/tenant/features";` e, dentro do `describe("addSuggestedItem")`:

```ts
  it("recusa a sugestão quando o plano não tem lista automática", async () => {
    const ws = await createWorkspace("Loja E2");
    context.workspaceId = ws.id;
    features.allowed = false;
    const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 } });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 200, workspaceId: ws.id } });

    const res = await addSuggestedItem(item.id);

    expect(res).toEqual({ ok: false, error: FEATURE_UNAVAILABLE_MESSAGE });
    expect(await getShoppingListItems()).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/server/actions/shopping-list.test.ts`
Expected: FAIL no teste novo (hoje cria a linha).

- [ ] **Step 3: Implement**

Em `src/server/actions/shopping-list.ts`, importar `assertWorkspaceFeature` de `@/server/tenant/features` e, dentro de `addSuggestedItem`, logo depois de `await assertCanWrite();`:

```ts
    await assertWorkspaceFeature(workspaceId, "autoShoppingList");
```

Em `src/app/(app)/stock/shopping-list/page.tsx`:
- trocar o import de contexto por `import { getWorkspaceContext, getWorkspaceDb } from "@/server/tenant/context";`
- adicionar `import Link from "next/link";` e `import { workspaceHasFeature } from "@/server/tenant/features";`
- substituir o início da função até o fim do `Promise.all` por:

```tsx
export default async function ShoppingListPage() {
  const { workspaceId } = await getWorkspaceContext();
  const [db, canSuggest] = await Promise.all([
    getWorkspaceDb(),
    workspaceHasFeature(workspaceId, "autoShoppingList"),
  ]);
  const [items, suggestions, availableItems] = await Promise.all([
    getShoppingListItems(),
    canSuggest ? getShoppingListSuggestions() : Promise.resolve([]),
    db.item.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        sellable: true,
        variants: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    }),
  ]);
```

- substituir `<ShoppingListSuggestions suggestions={suggestions} />` por:

```tsx
      {canSuggest ? (
        <ShoppingListSuggestions suggestions={suggestions} />
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Sugestões automáticas pelo estoque mínimo fazem parte do plano Cresce.{" "}
          <Link href="/workspaces/plan" className="font-medium text-primary underline-offset-4 hover:underline">
            Ver planos
          </Link>
        </p>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/server/actions/shopping-list.test.ts`
Expected: PASS, incluindo o teste antigo de `addSuggestedItem` (o mock libera por padrão).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/shopping-list.ts src/server/actions/shopping-list.test.ts "src/app/(app)/stock/shopping-list/page.tsx"
git commit -m "feat(planos): sugestões automáticas da lista de compras exigem o Cresce"
```

### Task 5: Painel consolidado exige Cresce, com verificação no navegador

**Files:**
- Modify: `src/app/(app)/dashboard/consolidated/page.tsx`

**Interfaces:**
- Consumes: `userHasFeature` (Task 2), `UpgradeNotice` (Task 3).

O consolidado soma os workspaces **da própria pessoa**, então o que vale é a assinatura dela (`userHasFeature`), não a do dono do workspace ativo. Os itens de navegação continuam visíveis de propósito: a página vira a vitrine do upgrade.

- [ ] **Step 1: Implement**

Importar `userHasFeature` de `@/server/tenant/features` e `UpgradeNotice` de `@/components/shared/upgrade-notice`. Logo depois de `const { userId } = await getWorkspaceContext();`:

```tsx
  if (!(await userHasFeature(userId, "consolidatedDashboard"))) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Painel consolidado"
          description="Soma do faturamento pago de todos os seus workspaces neste mês."
        />
        <UpgradeNotice
          title="O painel consolidado faz parte do plano Cresce"
          description="Com o Cresce, você vê o faturamento de todos os seus workspaces somado numa tela só."
        />
      </div>
    );
  }
```

- [ ] **Step 2: Typecheck, lint e testes**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: sem erros.

- [ ] **Step 3: Verificar no navegador**

Subir o dev server com `preview_start { name: "cookies-dev" }`. Com um usuário local no plano `corre` e `status = 'ACTIVE'` (`UPDATE subscription SET plan='corre', status='ACTIVE', "trialEndsAt"=NULL WHERE "userId"='<id>'` via `docker exec cookies_db psql -U cookies -d cookies`), abrir `/dashboard/consolidated`, `/workspaces/public-link` e `/stock/shopping-list` e confirmar o aviso de upgrade nas três. Trocar para `plan='cresce'` e confirmar que as três voltam a funcionar. Tirar screenshot das duas situações e checar o console por erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/consolidated/page.tsx"
git commit -m "feat(planos): painel consolidado exige o plano Cresce"
```

---

# Fase 2 — Verificação de e-mail e recuperação de senha

Estado ao fim: cadastro por e-mail/senha só entra depois de confirmar o e-mail; "Esqueci minha senha" funciona de ponta a ponta; contas antigas não são trancadas para fora; erros do better-auth aparecem em português.

### Task 6: Migration que marca contas antigas como verificadas

**Files:**
- Create: `prisma/migrations/20260927100000_verify_legacy_emails/migration.sql`

- [ ] **Step 1: Write the migration**

```sql
BEGIN;

UPDATE "user" SET "emailVerified" = true WHERE "emailVerified" = false;

COMMIT;
```

- [ ] **Step 2: Apply locally and check**

Run:
```bash
docker exec -i cookies_db psql -U cookies -d cookies < prisma/migrations/20260927100000_verify_legacy_emails/migration.sql
docker exec -i cookies_db psql -U cookies -d cookies_test < prisma/migrations/20260927100000_verify_legacy_emails/migration.sql
docker exec cookies_db psql -U cookies -d cookies -Atc 'select count(*) from "user" where "emailVerified" = false'
```
Expected: `UPDATE <n>` / `COMMIT` nos dois bancos e contagem `0`.

**Produção:** esta SQL roda **imediatamente antes** do deploy da Task 8. Rodar muito antes deixa uma janela em que cadastros novos ficam não verificados e seriam trancados quando o código subir.

- [ ] **Step 3: Commit**

```bash
git add prisma/migrations/20260927100000_verify_legacy_emails
git commit -m "chore(auth): marca contas existentes como verificadas antes de exigir verificação"
```

### Task 7: Templates de e-mail de verificação e redefinição, com escape de HTML

**Files:**
- Modify: `src/lib/email.ts`
- Test: `src/lib/email.test.ts`

**Interfaces:**
- Produces: `escapeHtml(value: string): string`, `actionEmailHtml(input: ActionEmail): string`, `sendVerificationEmail(input: { to: string; name: string; url: string }): Promise<SendResult>`, `sendPasswordResetEmail(input: { to: string; name: string; url: string }): Promise<SendResult>`. `sendInviteEmail` mantém a assinatura.

Achado de passagem que entra aqui: `inviteHtml` interpola `workspaceName` e `inviterName` sem escape. Um workspace chamado `<a href=...>` injeta HTML no e-mail de convite de outra pessoa. O helper novo escapa tudo, e o convite passa a usá-lo.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionEmailHtml,
  escapeHtml,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email";

describe("email", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("escapa caracteres de HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("o template de ação escapa o título e mantém o link", () => {
    const html = actionEmailHtml({
      heading: "Olá, <script>alert(1)</script>",
      body: "Corpo",
      ctaLabel: "Confirmar",
      ctaUrl: "https://app.example.com/api/auth/verify-email?token=abc&callbackURL=%2Fdashboard",
      footer: "Rodapé",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://app.example.com/api/auth/verify-email?token=abc&amp;callbackURL=%2Fdashboard"');
  });

  it("sem RESEND_API_KEY, a verificação não envia e imprime o link no console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await sendVerificationEmail({ to: "ana@example.com", name: "Ana", url: "http://localhost:3000/v?token=1" });
    expect(res.sent).toBe(false);
    expect(info.mock.calls[0][0]).toContain("http://localhost:3000/v?token=1");
  });

  it("sem RESEND_API_KEY, a redefinição não envia e imprime o link no console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await sendPasswordResetEmail({ to: "ana@example.com", name: "Ana", url: "http://localhost:3000/r/2" });
    expect(res.sent).toBe(false);
    expect(info.mock.calls[0][0]).toContain("http://localhost:3000/r/2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/email.test.ts`
Expected: FAIL com `escapeHtml is not a function`. Se `.env.test` tiver `RESEND_API_KEY` preenchida, esvaziar essa variável lá: testes não devem mandar e-mail de verdade.

- [ ] **Step 3: Implement**

Reescrever `src/lib/email.ts` inteiro:

```ts
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "Coolkies <onboarding@resend.dev>";

const resend = apiKey ? new Resend(apiKey) : null;

export type SendResult = { sent: boolean; reason?: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ActionEmail = {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
  highlight?: string;
};

export function actionEmailHtml({ heading, body, ctaLabel, ctaUrl, footer, highlight }: ActionEmail): string {
  const highlightBlock = highlight
    ? `<div style="margin:0 0 24px;padding:16px;background:#f6f5f3;border-radius:8px;text-align:center">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;font-weight:600;letter-spacing:3px">${escapeHtml(highlight)}</span>
      </div>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#57534e">${escapeHtml(body)}</p>
      ${highlightBlock}
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 20px;background:#8B5E3C;color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500">${escapeHtml(ctaLabel)}</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#78716c">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`;
}

async function deliver(input: {
  to: string;
  subject: string;
  html: string;
  devFallback: string;
}): Promise<SendResult> {
  if (!resend) {
    console.info(`[email] RESEND_API_KEY ausente. ${input.devFallback}`);
    return { sent: false, reason: "Envio de e-mail não configurado." };
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    if (error) return { sent: false, reason: error.message };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Falha no envio." };
  }
}

type InviteEmail = {
  to: string;
  code: string;
  workspaceName: string;
  inviterName: string;
  roleLabel: string;
  appUrl: string;
};

export async function sendInviteEmail(invite: InviteEmail): Promise<SendResult> {
  return deliver({
    to: invite.to,
    subject: `Convite para ${invite.workspaceName} no Coolkies`,
    html: actionEmailHtml({
      heading: `${invite.inviterName} convidou você para ${invite.workspaceName}`,
      body: `Você vai entrar como ${invite.roleLabel}. Use o código abaixo na tela “Entrar com código”.`,
      highlight: invite.code,
      ctaLabel: "Abrir o Coolkies",
      ctaUrl: invite.appUrl,
      footer: "O código vale por 7 dias. Se você não esperava este convite, pode ignorar esta mensagem.",
    }),
    devFallback: `Convite para ${invite.to}: código ${invite.code}`,
  });
}

type LinkEmail = { to: string; name: string; url: string };

export async function sendVerificationEmail({ to, name, url }: LinkEmail): Promise<SendResult> {
  return deliver({
    to,
    subject: "Confirme seu e-mail no Coolkies",
    html: actionEmailHtml({
      heading: `Olá, ${name}! Falta confirmar seu e-mail`,
      body: "Clique no botão abaixo para confirmar seu e-mail e começar a usar o Coolkies.",
      ctaLabel: "Confirmar e-mail",
      ctaUrl: url,
      footer: "O link vale por 24 horas. Se você não criou uma conta no Coolkies, pode ignorar esta mensagem.",
    }),
    devFallback: `Verificação para ${to}: ${url}`,
  });
}

export async function sendPasswordResetEmail({ to, name, url }: LinkEmail): Promise<SendResult> {
  return deliver({
    to,
    subject: "Redefina sua senha do Coolkies",
    html: actionEmailHtml({
      heading: `Olá, ${name}! Vamos trocar sua senha`,
      body: "Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova.",
      ctaLabel: "Redefinir senha",
      ctaUrl: url,
      footer: "O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a troca, ignore esta mensagem: sua senha continua a mesma.",
    }),
    devFallback: `Redefinição de senha para ${to}: ${url}`,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/email.test.ts && pnpm test`
Expected: PASS. Os testes de convite existentes que olham `sendInviteEmail` continuam verdes, porque a assinatura e o `SendResult` são os mesmos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/lib/email.test.ts
git commit -m "feat(email): templates de verificação e redefinição de senha com escape de HTML"
```

### Task 8: Ligar verificação obrigatória e redefinição de senha no better-auth

**Files:**
- Modify: `src/lib/auth.ts`
- Test: `src/lib/auth-email.test.ts`

**Interfaces:**
- Consumes: `sendVerificationEmail`, `sendPasswordResetEmail` (Task 7).

Os e-mails são enviados com `await`, e não com `void`. Na Vercel, a função pode ser congelada depois da resposta, e o e-mail nunca sairia. O ganho de tempo constante do `void` não compensa perder o e-mail.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

const sent = vi.hoisted(() => ({ verification: [] as string[], reset: [] as string[] }));

vi.mock("./email", () => ({
  sendVerificationEmail: async ({ url }: { url: string }) => {
    sent.verification.push(url);
    return { sent: true };
  },
  sendPasswordResetEmail: async ({ url }: { url: string }) => {
    sent.reset.push(url);
    return { sent: true };
  },
}));

const { auth } = await import("./auth");

const email = "ana@example.com";
const password = "senha-segura-1";

async function signUp() {
  return auth.api.signUpEmail({ body: { name: "Ana", email, password } });
}

function tokenFromVerification(url: string): string {
  return new URL(url).searchParams.get("token") as string;
}

function tokenFromReset(url: string): string {
  return new URL(url).pathname.split("/").pop() as string;
}

describe("verificação de e-mail", () => {
  beforeEach(async () => {
    await resetDb();
    sent.verification.length = 0;
    sent.reset.length = 0;
  });

  it("cadastro envia o link e não abre sessão", async () => {
    const res = await signUp();
    expect(res.token).toBeNull();
    expect(sent.verification).toHaveLength(1);
    expect(sent.verification[0]).toContain("/api/auth/verify-email?token=");
  });

  it("login antes de confirmar é recusado com EMAIL_NOT_VERIFIED", async () => {
    await signUp();
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject({
      body: { code: "EMAIL_NOT_VERIFIED" },
    });
  });

  it("depois de confirmar, o login funciona", async () => {
    await signUp();
    await auth.api.verifyEmail({ query: { token: tokenFromVerification(sent.verification[0]) } });
    const res = await auth.api.signInEmail({ body: { email, password } });
    expect(res.token).toBeTruthy();
  });
});

describe("redefinição de senha", () => {
  beforeEach(async () => {
    await resetDb();
    sent.verification.length = 0;
    sent.reset.length = 0;
    await signUp();
    await testDb.user.update({ where: { email }, data: { emailVerified: true } });
  });

  it("pedido envia o link de redefinição", async () => {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
    });
    expect(sent.reset).toHaveLength(1);
    expect(sent.reset[0]).toContain("/api/auth/reset-password/");
  });

  it("pedido para e-mail inexistente não envia nada e não revela nada", async () => {
    await auth.api.requestPasswordReset({
      body: { email: "ninguem@example.com", redirectTo: "http://localhost:3000/reset-password" },
    });
    expect(sent.reset).toHaveLength(0);
  });

  it("troca a senha, derruba as sessões antigas e o token não serve duas vezes", async () => {
    await auth.api.signInEmail({ body: { email, password } });
    const user = await testDb.user.findUniqueOrThrow({ where: { email } });
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(1);

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
    });
    const token = tokenFromReset(sent.reset[0]);

    await auth.api.resetPassword({ body: { newPassword: "outra-senha-2", token } });

    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toBeTruthy();
    const ok = await auth.api.signInEmail({ body: { email, password: "outra-senha-2" } });
    expect(ok.token).toBeTruthy();

    await expect(
      auth.api.resetPassword({ body: { newPassword: "terceira-senha-3", token } }),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/auth-email.test.ts`
Expected: FAIL. O cadastro devolve token de sessão, nenhum link é enviado e `requestPasswordReset` falha por falta de `sendResetPassword`.

- [ ] **Step 3: Implement**

Em `src/lib/auth.ts`, adicionar `import { sendPasswordResetEmail, sendVerificationEmail } from "./email";` e substituir o bloco `emailAndPassword` por:

```ts
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ to: user.email, name: user.name, url });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({ to: user.email, name: user.name, url });
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/auth-email.test.ts src/lib/auth.test.ts`
Expected: PASS. Se o shape de algum retorno divergir (por exemplo `res.token` ausente em vez de `null` no cadastro), ajustar **só a asserção** para `expect(res.token ?? null).toBeNull()`. O comportamento exigido não muda: sem sessão antes de confirmar.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth-email.test.ts
git commit -m "feat(auth): exige confirmação de e-mail e habilita redefinição de senha"
```

### Task 9: Mensagens de erro de autenticação em português

**Files:**
- Create: `src/lib/auth-errors.ts`
- Test: `src/lib/auth-errors.test.ts`

**Interfaces:**
- Produces: `GENERIC_AUTH_ERROR: string`, `authErrorMessage(error: { code?: string; status?: number } | null | undefined): string`. Usado na Task 10.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { authErrorMessage, GENERIC_AUTH_ERROR } from "./auth-errors";

describe("authErrorMessage", () => {
  it("traduz os códigos conhecidos", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("E-mail ou senha incorretos.");
    expect(authErrorMessage({ code: "EMAIL_NOT_VERIFIED" })).toContain("Confirme seu e-mail");
    expect(authErrorMessage({ code: "INVALID_TOKEN" })).toContain("expirou ou já foi usado");
  });

  it("429 vira aviso de muitas tentativas, qualquer que seja o código", () => {
    expect(authErrorMessage({ status: 429 })).toBe("Muitas tentativas. Espere um pouco e tente de novo.");
  });

  it("código desconhecido ou erro ausente cai na mensagem genérica", () => {
    expect(authErrorMessage({ code: "ALGO_NOVO" })).toBe(GENERIC_AUTH_ERROR);
    expect(authErrorMessage(null)).toBe(GENERIC_AUTH_ERROR);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/auth-errors.test.ts`
Expected: FAIL com `Failed to resolve import "./auth-errors"`.

- [ ] **Step 3: Implement**

```ts
export const GENERIC_AUTH_ERROR = "Não foi possível continuar. Tente de novo.";

const TOO_MANY_REQUESTS = "Muitas tentativas. Espere um pouco e tente de novo.";
const ALREADY_EXISTS = "Já existe uma conta com este e-mail. Entre ou redefina sua senha.";

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  EMAIL_NOT_VERIFIED: "Confirme seu e-mail antes de entrar. Enviamos um novo link para você.",
  USER_ALREADY_EXISTS: ALREADY_EXISTS,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: ALREADY_EXISTS,
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha está longa demais.",
  INVALID_TOKEN: "Este link expirou ou já foi usado. Peça um novo.",
};

export function authErrorMessage(
  error: { code?: string; status?: number } | null | undefined,
): string {
  if (!error) return GENERIC_AUTH_ERROR;
  if (error.status === 429) return TOO_MANY_REQUESTS;
  return (error.code && MESSAGES[error.code]) || GENERIC_AUTH_ERROR;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/auth-errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-errors.ts src/lib/auth-errors.test.ts
git commit -m "feat(auth): mensagens de erro de autenticação em português"
```

### Task 10: Telas de cadastro, "Esqueci minha senha" e redefinição

**Files:**
- Modify: `src/lib/auth-client.ts`
- Modify: `src/app/(auth)/sign-in/page.tsx`
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Create: `src/components/auth/reset-password-form.tsx`
- Modify: `src/middleware.ts`
- Test: `src/middleware.test.ts`

**Interfaces:**
- Consumes: `authErrorMessage` (Task 9).
- Produces: `requestPasswordReset(email: string)`, `resetPassword(input: { token: string; newPassword: string })` em `@/lib/auth-client`.

- [ ] **Step 1: Write the failing middleware test**

Adicionar ao `describe("middleware")` de `src/middleware.test.ts`:

```ts
  it.each(["/forgot-password", "/reset-password"])("deixa %s passar sem sessão", (path) => {
    const res = middleware(req(path));
    expect(res.status).not.toBe(307);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/middleware.test.ts`
Expected: FAIL com status 307 nas duas rotas.

- [ ] **Step 3: Implement middleware**

Em `src/middleware.ts`, acrescentar `"/forgot-password", "/reset-password"` ao array `PUBLIC_PATHS` e `forgot-password|reset-password|` logo depois de `sign-in|` no `config.matcher`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement client helpers**

Em `src/lib/auth-client.ts`, mudar `signUpWithEmail` para mandar `callbackURL: "/dashboard"` junto de `name/email/password`, e adicionar ao final:

```ts
export async function requestPasswordReset(email: string) {
  return authClient.requestPasswordReset({
    email,
    redirectTo: `${window.location.origin}/reset-password`,
  });
}

export async function resetPassword(input: { token: string; newPassword: string }) {
  return authClient.resetPassword(input);
}
```

- [ ] **Step 6: Implement sign-in page changes**

Em `src/app/(auth)/sign-in/page.tsx`:
- importar `Link from "next/link"` e `authErrorMessage` de `@/lib/auth-errors`;
- adicionar `const [notice, setNotice] = useState<string | null>(null);`;
- substituir o trecho de `onSubmit` a partir de `setPending(false);` por:

```tsx
    setPending(false);

    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }

    if (mode === "signup") {
      setNotice(`Enviamos um link de confirmação para ${email}. Abra o e-mail para ativar sua conta.`);
      setPassword("");
      return;
    }

    router.push("/dashboard");
    router.refresh();
```

- no `onValueChange` das Tabs, acrescentar `setNotice(null);`;
- logo depois do `<div>` do campo de senha, dentro do form:

```tsx
            {mode === "signin" && (
              <div className="text-right">
                <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                  Esqueci minha senha
                </Link>
              </div>
            )}
```

- logo antes de `{error && ...}`: `{notice && <p className="text-sm text-muted-foreground">{notice}</p>}`.

- [ ] **Step 7: Implement forgot-password page**

`src/app/(auth)/forgot-password/page.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await requestPasswordReset(email);
    setPending(false);
    if (result.error && result.error.status === 429) {
      setError(authErrorMessage(result.error));
      return;
    }
    setDone(true);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Esqueci minha senha</h1>
            <p className="text-sm text-muted-foreground">
              Informe seu e-mail e enviamos um link para você escolher uma nova senha.
            </p>
          </div>

          {done ? (
            <p className="text-sm text-muted-foreground">
              Se existir uma conta com {email}, o link já está a caminho. Confira também o spam.
            </p>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : "Enviar link"}
              </Button>
            </form>
          )}

          <Link href="/sign-in" className="block text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
            Voltar para o login
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
```

A tela mostra a mesma mensagem exista ou não a conta. É isso que impede usar o formulário para descobrir quem tem conta.

- [ ] **Step 8: Implement reset-password page and form**

`src/app/(auth)/reset-password/page.tsx`:

```tsx
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const valid = Boolean(token) && !error;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6">
          <h1 className="text-lg font-semibold">Nova senha</h1>
          {valid ? (
            <ResetPasswordForm token={token as string} />
          ) : (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Este link expirou ou já foi usado.</p>
              <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
                Pedir um novo link
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

`src/components/auth/reset-password-form.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("As duas senhas não são iguais.");
      return;
    }
    setPending(true);
    const result = await resetPassword({ token, newPassword: password });
    setPending(false);
    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Senha trocada. Por segurança, saímos da sua conta em todos os aparelhos.</p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Entrar</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="password">Nova senha</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Repita a nova senha</Label>
        <Input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Salvar nova senha"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 9: Typecheck, lint, testes e navegador**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: sem erros.

No navegador (`preview_start { name: "cookies-dev" }`), com `RESEND_API_KEY` vazia no `.env`:
1. Criar conta nova por e-mail/senha → aparece o aviso de confirmação e o link sai em `preview_logs` (`[email] ... Verificação para`).
2. Tentar entrar antes de confirmar → mensagem em português e novo link no log.
3. Abrir o link do log → cai em `/dashboard` já logado (ou em `/onboarding`, se não houver workspace).
4. Sair, ir em "Esqueci minha senha", pegar o link no log, trocar a senha, entrar com a nova.
5. Abrir de novo o mesmo link de redefinição → "Este link expirou ou já foi usado".
Tirar screenshot dos passos 1, 4 e 5 e checar o console.

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth-client.ts "src/app/(auth)" src/components/auth src/middleware.ts src/middleware.test.ts
git commit -m "feat(auth): telas de confirmação de e-mail, esqueci minha senha e nova senha"
```

---

# Fase 3 — Termos, privacidade e direitos do titular (LGPD)

Estado ao fim: termos de uso e política de privacidade públicos; toda pessoa (Google ou e-mail, nova ou antiga) aceita a versão vigente antes de usar o app; "Minha conta" permite baixar os dados pessoais e excluir a conta, o que apaga em cascata os workspaces próprios.

> **Antes de publicar em produção:** os textos das Tasks 11 são uma base sólida, mas precisam de revisão jurídica. O código trata a versão em `TERMS_VERSION`, então uma revisão posterior só troca o texto e a data, e todo mundo aceita de novo.

### Task 11: Páginas públicas de termos e privacidade

**Files:**
- Create: `src/lib/legal.ts`
- Create: `src/lib/legal-content.ts`
- Create: `src/components/legal/legal-document.tsx`
- Create: `src/app/terms/page.tsx`
- Create: `src/app/privacy/page.tsx`
- Modify: `src/middleware.ts`
- Modify: `src/app/(auth)/sign-in/page.tsx`
- Modify: `.env.example`
- Test: `src/lib/legal.test.ts`
- Test: `src/middleware.test.ts`

**Interfaces:**
- Produces: `TERMS_VERSION: string`, `type LegalEntity = { name: string; document: string; contactEmail: string }`, `legalEntity(env?: Record<string, string | undefined>): LegalEntity` em `@/lib/legal`.
- Produces: `type LegalSection = { heading: string; paragraphs: string[] }`, `termsSections(entity: LegalEntity): LegalSection[]`, `privacySections(entity: LegalEntity): LegalSection[]` em `@/lib/legal-content`.

Os dados da empresa (razão social, CNPJ ou CPF, e-mail de contato do encarregado) vêm de variáveis de ambiente, não do código. Sem elas, `legalEntity()` lança erro: um build de produção sem esses dados falha alto em vez de publicar termos sem responsável.

- [ ] **Step 1: Write the failing tests**

`src/lib/legal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { legalEntity, TERMS_VERSION } from "./legal";
import { privacySections, termsSections } from "./legal-content";

const env = {
  LEGAL_ENTITY_NAME: "Coolkies Tecnologia Ltda",
  LEGAL_ENTITY_DOCUMENT: "00.000.000/0001-00",
  LEGAL_CONTACT_EMAIL: "privacidade@coolkies.example",
};

describe("legal", () => {
  it("lê os dados da empresa do ambiente", () => {
    expect(legalEntity(env)).toEqual({
      name: "Coolkies Tecnologia Ltda",
      document: "00.000.000/0001-00",
      contactEmail: "privacidade@coolkies.example",
    });
  });

  it("falha se faltar qualquer dado", () => {
    expect(() => legalEntity({ ...env, LEGAL_CONTACT_EMAIL: undefined })).toThrow("LEGAL_CONTACT_EMAIL");
  });

  it("a versão dos termos é uma data ISO", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("os textos citam a empresa e o contato", () => {
    const entity = legalEntity(env);
    const terms = JSON.stringify(termsSections(entity));
    const privacy = JSON.stringify(privacySections(entity));
    expect(terms).toContain(entity.name);
    expect(terms).toContain(entity.document);
    expect(privacy).toContain(entity.contactEmail);
    expect(privacy).toContain("Minha conta");
  });
});
```

Em `src/middleware.test.ts`, trocar o `it.each` da Task 10 para `it.each(["/forgot-password", "/reset-password", "/terms", "/privacy"])`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/legal.test.ts src/middleware.test.ts`
Expected: FAIL (módulos inexistentes; `/terms` e `/privacy` com 307).

- [ ] **Step 3: Implement `legal.ts`**

```ts
export const TERMS_VERSION = "2026-09-27";

export type LegalEntity = { name: string; document: string; contactEmail: string };

export function legalEntity(env: Record<string, string | undefined> = process.env): LegalEntity {
  const name = env.LEGAL_ENTITY_NAME;
  const document = env.LEGAL_ENTITY_DOCUMENT;
  const contactEmail = env.LEGAL_CONTACT_EMAIL;
  if (!name || !document || !contactEmail) {
    throw new Error(
      "Defina LEGAL_ENTITY_NAME, LEGAL_ENTITY_DOCUMENT e LEGAL_CONTACT_EMAIL para publicar os termos.",
    );
  }
  return { name, document, contactEmail };
}
```

- [ ] **Step 4: Implement `legal-content.ts`**

```ts
import type { LegalEntity } from "./legal";

export type LegalSection = { heading: string; paragraphs: string[] };

export function termsSections(e: LegalEntity): LegalSection[] {
  return [
    {
      heading: "1. Quem somos",
      paragraphs: [
        `O Coolkies é oferecido por ${e.name}, inscrita sob o documento ${e.document}. Dúvidas sobre estes termos: ${e.contactEmail}.`,
      ],
    },
    {
      heading: "2. O serviço",
      paragraphs: [
        "O Coolkies é um sistema on-line para pequenos negócios registrarem vendas, clientes, estoque, produção e compras. Cada negócio funciona num workspace separado, e só quem foi convidado para ele enxerga os seus dados.",
      ],
    },
    {
      heading: "3. Conta e acesso",
      paragraphs: [
        "Você entra com Google ou com e-mail e senha. Contas com e-mail e senha precisam confirmar o e-mail antes do primeiro acesso.",
        "Você é responsável por manter sua senha em sigilo e pelas ações feitas com a sua conta. Quem administra um workspace responde pelos acessos que concede a outras pessoas.",
      ],
    },
    {
      heading: "4. Planos, teste grátis e cobrança",
      paragraphs: [
        "Toda conta nova tem 14 dias de teste grátis. Depois disso, para continuar registrando dados, é preciso assinar um plano.",
        "As assinaturas se renovam automaticamente a cada ciclo (mensal ou anual) por Pix Automático ou cartão de crédito, até você cancelar. Você pode cancelar a qualquer momento na tela de assinatura, e o acesso pago vai até o fim do ciclo já pago. Não há reembolso proporcional de ciclos em andamento.",
        "Se o pagamento não for feito, o workspace entra em modo somente leitura: você continua vendo tudo, mas não registra nada novo até regularizar.",
      ],
    },
    {
      heading: "5. Seus dados e os dados dos seus clientes",
      paragraphs: [
        "Os dados que você registra no Coolkies são seus. Em relação aos dados pessoais dos seus clientes, você é o controlador e nós atuamos como operador, tratando esses dados apenas para prestar o serviço.",
        "Você declara ter base legal para registrar os dados dos seus clientes e se compromete a atender os pedidos deles sobre esses dados.",
      ],
    },
    {
      heading: "6. Uso aceitável",
      paragraphs: [
        "É proibido usar o Coolkies para atividades ilegais, tentar acessar dados de outros workspaces, sobrecarregar o serviço de propósito ou automatizar acessos fora da API oficial. Podemos suspender contas que violem estas regras.",
      ],
    },
    {
      heading: "7. Disponibilidade",
      paragraphs: [
        "Trabalhamos para manter o serviço no ar e os dados protegidos, mas não garantimos funcionamento ininterrupto. Manutenções e falhas de fornecedores podem causar indisponibilidades temporárias.",
      ],
    },
    {
      heading: "8. Exclusão da conta",
      paragraphs: [
        "Você pode excluir sua conta a qualquer momento em Minha conta. A exclusão cancela sua assinatura e apaga, de forma definitiva, todos os workspaces em que você é dono, com todos os dados deles, inclusive os registrados por outros membros. Nos workspaces de outras pessoas, os registros que você fez continuam, sem vínculo com a sua conta.",
      ],
    },
    {
      heading: "9. Mudanças nestes termos",
      paragraphs: [
        "Quando estes termos mudarem, avisaremos no próprio app e pediremos um novo aceite antes de você continuar usando o serviço.",
      ],
    },
    {
      heading: "10. Lei aplicável",
      paragraphs: [
        "Estes termos seguem as leis brasileiras, incluindo o Código de Defesa do Consumidor e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).",
      ],
    },
  ];
}

export function privacySections(e: LegalEntity): LegalSection[] {
  return [
    {
      heading: "1. Quem cuida dos seus dados",
      paragraphs: [
        `${e.name} (${e.document}) é a controladora dos dados da sua conta. O contato do encarregado pelo tratamento de dados é ${e.contactEmail}.`,
      ],
    },
    {
      heading: "2. Que dados coletamos",
      paragraphs: [
        "Da sua conta: nome, e-mail, foto (quando você entra com Google) e senha, que guardamos só em forma criptografada.",
        "Para cobrança: CPF e os dados da assinatura. Os dados do cartão são digitados diretamente na Stripe e nunca passam pelos nossos servidores.",
        "Do uso: endereço IP e registros técnicos de acesso, usados para segurança e para limitar tentativas abusivas.",
        "Dos seus negócios: tudo o que você registra nos workspaces, como vendas, clientes, estoque e compras.",
      ],
    },
    {
      heading: "3. Para que usamos",
      paragraphs: [
        "Para prestar o serviço e cobrar a assinatura (execução de contrato), cumprir obrigações legais e fiscais (obrigação legal) e proteger o serviço contra fraude e abuso (legítimo interesse). Não vendemos seus dados e não os usamos para publicidade.",
      ],
    },
    {
      heading: "4. Com quem compartilhamos",
      paragraphs: [
        "Somente com os fornecedores necessários para o serviço funcionar: hospedagem (Vercel), banco de dados (Supabase), envio de e-mail (Resend), login (Google) e pagamentos (Stripe, e Banco Inter por meio do nosso gateway Pix). Eles tratam os dados só para essas finalidades.",
      ],
    },
    {
      heading: "5. Por quanto tempo guardamos",
      paragraphs: [
        "Enquanto sua conta existir. Quando você a exclui, apagamos seus dados e os workspaces em que você é dono. Registros de pagamento podem continuar com os provedores de pagamento pelo prazo que a lei exige.",
      ],
    },
    {
      heading: "6. Seus direitos",
      paragraphs: [
        "Em Minha conta você pode baixar uma cópia dos seus dados pessoais e excluir sua conta. Para corrigir dados, tirar dúvidas ou exercer qualquer outro direito previsto na LGPD, escreva para " + e.contactEmail + ".",
      ],
    },
    {
      heading: "7. Cookies",
      paragraphs: [
        "Usamos apenas o cookie de sessão, necessário para manter você conectado. Não usamos cookies de publicidade nem de rastreamento.",
      ],
    },
    {
      heading: "8. Segurança",
      paragraphs: [
        "Os dados trafegam criptografados, as senhas são guardadas com hash e cada workspace é isolado dos demais na camada de acesso ao banco.",
      ],
    },
    {
      heading: "9. Mudanças nesta política",
      paragraphs: [
        "Quando esta política mudar, avisaremos no próprio app e pediremos um novo aceite.",
      ],
    },
  ];
}
```

- [ ] **Step 5: Implement components and pages**

`src/components/legal/legal-document.tsx`:

```tsx
import Link from "next/link";
import type { LegalSection } from "@/lib/legal-content";

export function LegalDocument({
  title,
  version,
  sections,
}: {
  title: string;
  version: string;
  sections: LegalSection[];
}) {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
      <div className="space-y-1">
        <Link href="/sign-in" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          Coolkies
        </Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">Versão de {version}</p>
      </div>
      {sections.map((s) => (
        <section key={s.heading} className="space-y-2">
          <h2 className="font-medium">{s.heading}</h2>
          {s.paragraphs.map((p) => (
            <p key={p} className="text-sm leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
```

`src/app/terms/page.tsx`:

```tsx
import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalEntity, TERMS_VERSION } from "@/lib/legal";
import { termsSections } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Termos de uso · Coolkies" };

export default function TermsPage() {
  return <LegalDocument title="Termos de uso" version={TERMS_VERSION} sections={termsSections(legalEntity())} />;
}
```

`src/app/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { legalEntity, TERMS_VERSION } from "@/lib/legal";
import { privacySections } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Política de privacidade · Coolkies" };

export default function PrivacyPage() {
  return (
    <LegalDocument title="Política de privacidade" version={TERMS_VERSION} sections={privacySections(legalEntity())} />
  );
}
```

Em `src/middleware.ts`, acrescentar `"/terms", "/privacy"` a `PUBLIC_PATHS` e `terms|privacy|` ao `config.matcher`, ao lado de `forgot-password|reset-password|`.

Em `src/app/(auth)/sign-in/page.tsx`, substituir o parágrafo final `Usamos seus dados só para acessar o app.` por:

```tsx
          <p className="text-center text-xs text-muted-foreground">
            Ao continuar, você concorda com os{" "}
            <Link href="/terms" className="underline underline-offset-4">Termos de uso</Link> e a{" "}
            <Link href="/privacy" className="underline underline-offset-4">Política de privacidade</Link>.
          </p>
```

Em `.env.example`, adicionar ao final:

```
# ── Dados legais (termos e política de privacidade) ─────────────────────
# Obrigatórios: sem eles /terms e /privacy lançam erro e o build falha.
LEGAL_ENTITY_NAME=""
LEGAL_ENTITY_DOCUMENT=""
LEGAL_CONTACT_EMAIL=""
```

Preencher as três no `.env` local com os dados reais da empresa (pedir ao dono se não souber) e cadastrar as três na Vercel (Production e Preview) antes do deploy.

- [ ] **Step 6: Run tests, typecheck, navegador**

Run: `pnpm test src/lib/legal.test.ts src/middleware.test.ts && pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS. Abrir `/terms` e `/privacy` deslogado, confirmar que renderizam com os dados do `.env` e tirar screenshot em largura de celular (`resize_window { preset: "mobile" }`, depois voltar a `desktop`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/legal.ts src/lib/legal-content.ts src/lib/legal.test.ts src/components/legal src/app/terms src/app/privacy src/middleware.ts src/middleware.test.ts "src/app/(auth)/sign-in/page.tsx" .env.example
git commit -m "feat(lgpd): termos de uso e política de privacidade públicos"
```

### Task 12: Registro do aceite da versão vigente

**Files:**
- Create: `prisma/migrations/20260927110000_terms_acceptance/migration.sql`
- Modify: `prisma/schema.prisma` (model `User`)
- Create: `src/server/tenant/account.ts`
- Create: `src/server/actions/account.ts`
- Create: `src/app/accept-terms/page.tsx`
- Create: `src/components/legal/accept-terms-form.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/onboarding/page.tsx`
- Modify: `src/app/checkout/page.tsx`
- Test: `src/server/tenant/account.test.ts`

**Interfaces:**
- Consumes: `TERMS_VERSION` (Task 11), `requireUserId` de `@/server/tenant/workspaces`.
- Produces: `hasAcceptedCurrentTerms(userId: string): Promise<boolean>`, `acceptCurrentTerms(userId: string, now?: Date): Promise<void>` em `@/server/tenant/account`; action `acceptTerms(): Promise<ActionResult>` em `@/server/actions/account`.

O aceite é pedido **dentro do app**, e não num checkbox do cadastro, porque só assim cobre ao mesmo tempo quem entra com Google (não passa pelo formulário), as contas que já existem e as próximas versões dos termos.

- [ ] **Step 1: Migration e schema**

```sql
BEGIN;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);

COMMIT;
```

No `model User`, logo depois de `cpf String?`:

```prisma
  termsVersion    String?
  termsAcceptedAt DateTime?
```

Run:
```bash
docker exec -i cookies_db psql -U cookies -d cookies < prisma/migrations/20260927110000_terms_acceptance/migration.sql
docker exec -i cookies_db psql -U cookies -d cookies_test < prisma/migrations/20260927110000_terms_acceptance/migration.sql
pnpm exec prisma generate
```
Expected: `ALTER TABLE` duas vezes em cada banco.

- [ ] **Step 2: Write the failing test**

`src/server/tenant/account.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { TERMS_VERSION } from "@/lib/legal";
import { acceptCurrentTerms, hasAcceptedCurrentTerms } from "./account";

describe("aceite dos termos", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("conta nova ainda não aceitou", async () => {
    await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    expect(await hasAcceptedCurrentTerms("u1")).toBe(false);
  });

  it("aceitar grava a versão e a data", async () => {
    await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const now = new Date("2026-09-27T15:00:00Z");
    await acceptCurrentTerms("u1", now);
    const user = await testDb.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.termsVersion).toBe(TERMS_VERSION);
    expect(user.termsAcceptedAt).toEqual(now);
    expect(await hasAcceptedCurrentTerms("u1")).toBe(true);
  });

  it("aceite de versão antiga não vale", async () => {
    await testDb.user.create({
      data: { id: "u1", name: "Ana", email: "ana@example.com", termsVersion: "2020-01-01" },
    });
    expect(await hasAcceptedCurrentTerms("u1")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/server/tenant/account.test.ts`
Expected: FAIL com `Failed to resolve import "./account"`.

- [ ] **Step 4: Implement server functions and action**

`src/server/tenant/account.ts`:

```ts
import { db } from "@/lib/db";
import { TERMS_VERSION } from "@/lib/legal";

export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { termsVersion: true } });
  return user?.termsVersion === TERMS_VERSION;
}

export async function acceptCurrentTerms(userId: string, now: Date = new Date()): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: now },
  });
}
```

`src/server/actions/account.ts`:

```ts
"use server";

import { acceptCurrentTerms } from "@/server/tenant/account";
import { requireUserId } from "@/server/tenant/workspaces";

export type ActionResult = { ok: boolean; error?: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function acceptTerms(): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    await acceptCurrentTerms(userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/server/tenant/account.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the acceptance screen and gates**

`src/components/legal/accept-terms-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptTerms } from "@/server/actions/account";

export function AcceptTermsForm() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();

  function onAccept() {
    startTransition(async () => {
      const res = await acceptTerms();
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível registrar o aceite.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>
          Li e aceito os{" "}
          <Link href="/terms" target="_blank" className="underline underline-offset-4">Termos de uso</Link> e a{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-4">Política de privacidade</Link>.
        </span>
      </label>
      <Button className="w-full" disabled={!checked || pending} onClick={onAccept}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Continuar"}
      </Button>
    </div>
  );
}
```

`src/app/accept-terms/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { AcceptTermsForm } from "@/components/legal/accept-terms-form";
import { hasAcceptedCurrentTerms } from "@/server/tenant/account";

export default async function AcceptTermsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (await hasAcceptedCurrentTerms(session.user.id)) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Antes de continuar</h1>
            <p className="text-sm text-muted-foreground">
              Atualizamos nossos termos e nossa política de privacidade. Leia e aceite para seguir usando o Coolkies.
            </p>
          </div>
          <AcceptTermsForm />
        </CardContent>
      </Card>
    </main>
  );
}
```

Nos três pontos de entrada, logo depois da linha `if (!session) redirect("/sign-in");`, importar `hasAcceptedCurrentTerms` de `@/server/tenant/account` e inserir:

```tsx
  if (!(await hasAcceptedCurrentTerms(session.user.id))) redirect("/accept-terms");
```

- `src/app/(app)/layout.tsx`
- `src/app/onboarding/page.tsx`
- `src/app/checkout/page.tsx`: se a variável de sessão tiver outro nome nesse arquivo, usar o nome que estiver lá. Se o arquivo não ler a sessão, adicionar a leitura no mesmo padrão do `onboarding/page.tsx`.

- [ ] **Step 7: Typecheck, testes e navegador**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: sem erros.

No navegador: com um usuário que tem `termsVersion` nulo, abrir `/dashboard` → cai em `/accept-terms`; o botão só habilita com o checkbox; ao aceitar, vai para `/dashboard`. Recarregar e confirmar que não pede de novo. Screenshot da tela de aceite.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260927110000_terms_acceptance src/server/tenant/account.ts src/server/tenant/account.test.ts src/server/actions/account.ts src/app/accept-terms src/components/legal/accept-terms-form.tsx "src/app/(app)/layout.tsx" src/app/onboarding/page.tsx src/app/checkout/page.tsx
git commit -m "feat(lgpd): registra o aceite da versão vigente dos termos antes de usar o app"
```

### Task 13: Exclusão da conta em cascata

**Files:**
- Create: `prisma/migrations/20260927120000_sale_user_set_null/migration.sql`
- Modify: `prisma/schema.prisma` (model `Sale`)
- Modify: `src/server/tenant/account.ts`
- Test: `src/server/tenant/account-deletion.test.ts`

**Interfaces:**
- Consumes: `getSubscription` (`./subscription`), `cancelInterPixSubscription` (`./interpix`), `cancelStripeSubscription` (`./stripe`).
- Produces: `DELETION_BILLING_ERROR: string`, `class AccountDeletionError`, `deleteUserAccount(userId: string): Promise<void>`, `listOwnedWorkspaceNames(userId: string): Promise<string[]>` em `@/server/tenant/account`.

Estado do banco levantado em 2026-09-27 (`pg_constraint` no `cookies_test`): `sale.userId → user` é `RESTRICT` e bloquearia a exclusão de quem registrou vendas em workspace alheio; `purchase` e `production_batch` já são `SET NULL`. Dentro de um workspace, `production_batch`, `production_variant_line`, `recipe_item`, `sale_item` e `stock_movement` apontam para `item`/`variant` com `RESTRICT`. Por isso `deleteUserAccount` apaga essas tabelas explicitamente antes do workspace, em vez de confiar na ordem das cascatas.

- [ ] **Step 1: Migration e schema**

Confirmar o nome da constraint: `docker exec cookies_db psql -U cookies -d cookies -c '\d sale'` deve listar `sale_userId_fkey`. Se o nome for outro, usar o nome listado.

```sql
BEGIN;

ALTER TABLE "sale" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "sale" DROP CONSTRAINT "sale_userId_fkey";
ALTER TABLE "sale"
  ADD CONSTRAINT "sale_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
```

No `model Sale`, trocar as duas linhas de usuário por:

```prisma
  userId       String?
  user         User?      @relation(fields: [userId], references: [id], onDelete: SetNull)
```

Aplicar nos dois bancos, rodar `pnpm exec prisma generate` e depois `pnpm exec tsc --noEmit`. Onde o TypeScript reclamar de `sale.userId` agora ser `string | null`, tratar o nulo no ponto de leitura (exibir como "Usuário removido" se for texto de UI). Não voltar o campo a obrigatório.

- [ ] **Step 2: Write the failing test**

`src/server/tenant/account-deletion.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";

const billing = vi.hoisted(() => ({ fail: false, interpix: [] as string[], stripe: [] as string[] }));

vi.mock("./interpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./interpix")>();
  return {
    ...actual,
    cancelInterPixSubscription: async (id: string) => {
      if (billing.fail) throw new Error("gateway fora do ar");
      billing.interpix.push(id);
      return { pendingCycle: null };
    },
  };
});

vi.mock("./stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe")>();
  return {
    ...actual,
    cancelStripeSubscription: async (id: string) => {
      if (billing.fail) throw new Error("stripe fora do ar");
      billing.stripe.push(id);
    },
  };
});

const { deleteUserAccount, DELETION_BILLING_ERROR, listOwnedWorkspaceNames } = await import("./account");

async function seedFullWorkspace(workspaceId: string, userId: string) {
  const item = await testDb.item.create({
    data: { workspaceId, name: "Cookie", unit: "UN", sellable: true, productionInput: true },
  });
  const variant = await testDb.variant.create({ data: { workspaceId, itemId: item.id, name: "Chocolate" } });
  await testDb.sale.create({
    data: {
      workspaceId,
      userId,
      soldAt: new Date(),
      status: "PAID",
      totalCents: 1000,
      items: {
        create: [
          {
            workspaceId,
            itemId: item.id,
            variantId: variant.id,
            quantity: 1,
            unitPriceSnapshot: 1000,
            productNameSnapshot: "Cookie",
          },
        ],
      },
    },
  });
  await testDb.stockMovement.create({ data: { workspaceId, itemId: item.id, type: "PURCHASE", quantity: 10 } });
}

describe("deleteUserAccount", () => {
  beforeEach(async () => {
    await resetDb();
    billing.fail = false;
    billing.interpix.length = 0;
    billing.stripe.length = 0;
  });

  it("apaga a conta e os workspaces próprios com todos os dados", async () => {
    const ana = await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    const bia = await testDb.user.create({ data: { id: "bia", name: "Bia", email: "bia@example.com" } });
    const ws = await createWorkspace("Loja da Ana");
    await testDb.member.create({ data: { userId: ana.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: bia.id, workspaceId: ws.id, role: "MEMBER" } });
    await seedFullWorkspace(ws.id, bia.id);

    expect(await listOwnedWorkspaceNames(ana.id)).toEqual(["Loja da Ana"]);

    await deleteUserAccount(ana.id);

    expect(await testDb.user.findUnique({ where: { id: ana.id } })).toBeNull();
    expect(await testDb.workspace.findUnique({ where: { id: ws.id } })).toBeNull();
    expect(await testDb.sale.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await testDb.user.findUnique({ where: { id: bia.id } })).not.toBeNull();
  });

  it("vendas registradas no workspace de outra pessoa ficam, sem vínculo", async () => {
    const dona = await testDb.user.create({ data: { id: "dona", name: "Dona", email: "dona@example.com" } });
    const ex = await testDb.user.create({ data: { id: "ex", name: "Ex", email: "ex@example.com" } });
    const ws = await createWorkspace("Loja da Dona");
    await testDb.member.create({ data: { userId: dona.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: ex.id, workspaceId: ws.id, role: "MEMBER" } });
    await seedFullWorkspace(ws.id, ex.id);

    await deleteUserAccount(ex.id);

    const sales = await testDb.sale.findMany({ where: { workspaceId: ws.id } });
    expect(sales).toHaveLength(1);
    expect(sales[0].userId).toBeNull();
    expect(await testDb.workspace.findUnique({ where: { id: ws.id } })).not.toBeNull();
  });

  it("cancela a assinatura no provedor antes de apagar", async () => {
    await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    await testDb.subscription.create({
      data: { userId: "ana", plan: "corre", status: "ACTIVE", provider: "INTERPIX", interpixSubscriptionId: "ip-1" },
    });

    await deleteUserAccount("ana");

    expect(billing.interpix).toEqual(["ip-1"]);
    expect(await testDb.user.findUnique({ where: { id: "ana" } })).toBeNull();
  });

  it("se o provedor falhar, nada é apagado", async () => {
    await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    await testDb.subscription.create({
      data: { userId: "ana", plan: "cresce", status: "ACTIVE", provider: "STRIPE", stripeSubscriptionId: "sub_1" },
    });
    const ws = await createWorkspace("Loja");
    await testDb.member.create({ data: { userId: "ana", workspaceId: ws.id, role: "OWNER" } });
    billing.fail = true;

    await expect(deleteUserAccount("ana")).rejects.toThrow(DELETION_BILLING_ERROR);

    expect(await testDb.user.findUnique({ where: { id: "ana" } })).not.toBeNull();
    expect(await testDb.workspace.findUnique({ where: { id: ws.id } })).not.toBeNull();
  });

  it("assinatura já cancelada não chama o provedor", async () => {
    await testDb.user.create({ data: { id: "ana", name: "Ana", email: "ana@example.com" } });
    await testDb.subscription.create({
      data: { userId: "ana", plan: "corre", status: "CANCELED", provider: "INTERPIX", interpixSubscriptionId: "ip-2" },
    });

    await deleteUserAccount("ana");

    expect(billing.interpix).toEqual([]);
  });
});
```

Os campos de `sale`, `sale_item`, `item` e `variant` acima seguem o schema atual. Se algum `create` falhar por campo obrigatório que não esteja listado, olhar o model em `prisma/schema.prisma` e completar só o `create` do teste. O comportamento testado não muda.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/server/tenant/account-deletion.test.ts`
Expected: FAIL com `deleteUserAccount is not a function`.

- [ ] **Step 4: Implement**

Acrescentar a `src/server/tenant/account.ts`:

```ts
import { getSubscription } from "./subscription";
import { cancelInterPixSubscription } from "./interpix";
import { cancelStripeSubscription } from "./stripe";

export const DELETION_BILLING_ERROR =
  "Não conseguimos cancelar sua assinatura agora, então nada foi excluído. Tente de novo em alguns minutos.";

export class AccountDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

export async function listOwnedWorkspaceNames(userId: string): Promise<string[]> {
  const owned = await db.member.findMany({
    where: { userId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { name: true } } },
  });
  return owned.map((m) => m.workspace.name);
}

async function cancelBilling(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub || sub.status === "CANCELED") return;

  try {
    if (sub.provider === "INTERPIX" && sub.interpixSubscriptionId) {
      await cancelInterPixSubscription(sub.interpixSubscriptionId);
    }
    if (sub.provider === "STRIPE" && sub.stripeSubscriptionId) {
      await cancelStripeSubscription(sub.stripeSubscriptionId);
    }
  } catch (e) {
    console.error(
      "deleteUserAccount: falha ao cancelar assinatura",
      sub.id,
      e instanceof Error ? e.name : "erro desconhecido",
    );
    throw new AccountDeletionError(DELETION_BILLING_ERROR);
  }
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await cancelBilling(userId);

  const owned = await db.member.findMany({
    where: { userId, role: "OWNER" },
    select: { workspaceId: true },
  });
  const workspaceId = { in: owned.map((m) => m.workspaceId) };

  await db.$transaction([
    db.stockMovement.deleteMany({ where: { workspaceId } }),
    db.saleItem.deleteMany({ where: { workspaceId } }),
    db.productionVariantLine.deleteMany({ where: { workspaceId } }),
    db.productionBatch.deleteMany({ where: { workspaceId } }),
    db.recipeItem.deleteMany({ where: { workspaceId } }),
    db.workspace.deleteMany({ where: { id: workspaceId } }),
    db.user.delete({ where: { id: userId } }),
  ]);
}
```

(Juntar os imports novos aos já existentes no topo do arquivo.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/server/tenant/account-deletion.test.ts src/server/tenant/account.test.ts`
Expected: PASS. Se o primeiro teste falhar com violação de FK numa tabela fora da lista, acrescentar o `deleteMany` dela **antes** de `db.workspace.deleteMany`, na ordem filho → pai, e rodar de novo.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260927120000_sale_user_set_null src/server/tenant/account.ts src/server/tenant/account-deletion.test.ts
git commit -m "feat(lgpd): exclusão da conta em cascata com cancelamento da assinatura antes"
```

### Task 14: Tela "Minha conta" com exportação e exclusão

**Files:**
- Modify: `src/server/tenant/account.ts`
- Modify: `src/server/actions/account.ts`
- Create: `src/app/(app)/account/page.tsx`
- Create: `src/app/(app)/account/export/route.ts`
- Create: `src/components/account/delete-account-dialog.tsx`
- Modify: `src/app/(app)/more/page.tsx`
- Test: `src/server/tenant/account.test.ts`
- Test: `src/server/actions/account.test.ts`

**Interfaces:**
- Consumes: `deleteUserAccount`, `listOwnedWorkspaceNames`, `AccountDeletionError` (Task 13).
- Produces: `type PersonalDataExport`, `buildPersonalDataExport(userId: string, now?: Date): Promise<PersonalDataExport>`; action `deleteAccount(confirmEmail: string): Promise<ActionResult>`.

- [ ] **Step 1: Write the failing tests**

Acrescentar a `src/server/tenant/account.test.ts` (importar `buildPersonalDataExport` e `createWorkspace`):

```ts
describe("exportação de dados pessoais", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reúne perfil, formas de login, workspaces e assinatura", async () => {
    await testDb.user.create({
      data: { id: "u1", name: "Ana", email: "ana@example.com", cpf: "12345678909", termsVersion: TERMS_VERSION },
    });
    await testDb.account.create({
      data: { id: "a1", accountId: "g-1", providerId: "google", userId: "u1" },
    });
    const ws = await createWorkspace("Loja");
    await testDb.member.create({ data: { userId: "u1", workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({ data: { userId: "u1", plan: "cresce", status: "ACTIVE" } });

    const data = await buildPersonalDataExport("u1", new Date("2026-09-27T12:00:00Z"));

    expect(data.exportedAt).toBe("2026-09-27T12:00:00.000Z");
    expect(data.user).toMatchObject({ name: "Ana", email: "ana@example.com", cpf: "12345678909" });
    expect(data.loginMethods).toEqual(["google"]);
    expect(data.workspaces).toEqual([expect.objectContaining({ name: "Loja", role: "OWNER" })]);
    expect(data.subscription).toMatchObject({ plan: "cresce", status: "ACTIVE" });
    expect(JSON.stringify(data)).not.toContain("password");
  });
});
```

`src/server/actions/account.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => sessionResult } } }));

const { deleteAccount } = await import("./account");

describe("deleteAccount", () => {
  beforeEach(async () => {
    await resetDb();
    await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    sessionResult = { user: { id: "u1" }, session: { id: "s1" } };
  });

  it("recusa quando o e-mail digitado não confere", async () => {
    const res = await deleteAccount("outra@example.com");
    expect(res).toEqual({ ok: false, error: "Digite o e-mail da sua conta para confirmar." });
    expect(await testDb.user.findUnique({ where: { id: "u1" } })).not.toBeNull();
  });

  it("aceita o e-mail com espaços e maiúsculas e exclui", async () => {
    const res = await deleteAccount("  ANA@example.com ");
    expect(res.ok).toBe(true);
    expect(await testDb.user.findUnique({ where: { id: "u1" } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/server/tenant/account.test.ts src/server/actions/account.test.ts`
Expected: FAIL (`buildPersonalDataExport` e `deleteAccount` inexistentes).

- [ ] **Step 3: Implement server side**

Acrescentar a `src/server/tenant/account.ts`:

```ts
export type PersonalDataExport = {
  exportedAt: string;
  user: {
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    cpf: string | null;
    createdAt: string;
    termsVersion: string | null;
    termsAcceptedAt: string | null;
  };
  loginMethods: string[];
  workspaces: { name: string; role: string; joinedAt: string }[];
  subscription: {
    plan: string;
    status: string;
    cycle: string;
    provider: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
  } | null;
};

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export async function buildPersonalDataExport(
  userId: string,
  now: Date = new Date(),
): Promise<PersonalDataExport> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      accounts: { select: { providerId: true } },
      members: { include: { workspace: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      subscription: true,
    },
  });
  const sub = user.subscription;

  return {
    exportedAt: now.toISOString(),
    user: {
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      cpf: user.cpf,
      createdAt: user.createdAt.toISOString(),
      termsVersion: user.termsVersion,
      termsAcceptedAt: iso(user.termsAcceptedAt),
    },
    loginMethods: user.accounts.map((a) => a.providerId),
    workspaces: user.members.map((m) => ({
      name: m.workspace.name,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    })),
    subscription: sub
      ? {
          plan: sub.plan,
          status: sub.status,
          cycle: sub.cycle,
          provider: sub.provider,
          trialEndsAt: iso(sub.trialEndsAt),
          currentPeriodEnd: iso(sub.currentPeriodEnd),
          cardBrand: sub.cardBrand,
          cardLast4: sub.cardLast4,
        }
      : null,
  };
}
```

Acrescentar a `src/server/actions/account.ts`:

```ts
import { db } from "@/lib/db";
import { deleteUserAccount } from "@/server/tenant/account";

const CONFIRM_EMAIL_ERROR = "Digite o e-mail da sua conta para confirmar.";

export async function deleteAccount(confirmEmail: string): Promise<ActionResult> {
  try {
    const userId = await requireUserId();
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      return { ok: false, error: CONFIRM_EMAIL_ERROR };
    }
    await deleteUserAccount(userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
```

Como `src/server/actions/account.ts` agora importa `@/lib/db`, acrescentar `"src/server/actions/account.ts"` ao array `ignores` de `eslint.config.mjs`, no mesmo padrão de `src/server/actions/allowlist.ts`. Os dados lidos aqui são da conta, não de workspace, e não há client com escopo que sirva.

`src/app/(app)/account/export/route.ts`:

```ts
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { buildPersonalDataExport } from "@/server/tenant/account";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const data = await buildPersonalDataExport(session.user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meus-dados-coolkies.json"',
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/server/tenant/account.test.ts src/server/actions/account.test.ts && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Implement UI**

`src/components/account/delete-account-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAccount } from "@/server/actions/account";

export function DeleteAccountDialog({ email, ownedWorkspaces }: { email: string; ownedWorkspaces: string[] }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await deleteAccount(typed);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível excluir a conta.");
        return;
      }
      window.location.href = "/sign-in";
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Excluir minha conta</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir sua conta?</DialogTitle>
          <DialogDescription>
            Isso cancela sua assinatura e apaga sua conta de forma definitiva. Não dá para desfazer.
          </DialogDescription>
        </DialogHeader>

        {ownedWorkspaces.length > 0 && (
          <div className="space-y-1 rounded-lg border border-destructive/40 p-3 text-sm">
            <p className="font-medium">Estes workspaces também serão apagados, com os dados de todos os membros:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {ownedWorkspaces.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="confirm-email">Para confirmar, digite {email}</Label>
          <Input id="confirm-email" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="destructive" disabled={pending || typed.trim() === ""} onClick={onConfirm}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Excluir definitivamente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/app/(app)/account/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";
import { listOwnedWorkspaceNames } from "@/server/tenant/account";

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const ownedWorkspaces = await listOwnedWorkspaceNames(session.user.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Minha conta" description="Seus dados pessoais e o que fazer com eles." />

      <section className="space-y-1 rounded-lg border bg-card px-4 py-3">
        <p className="font-medium">{session.user.name}</p>
        <p className="text-sm text-muted-foreground">{session.user.email}</p>
      </section>

      <section className="space-y-2 rounded-lg border bg-card px-4 py-3">
        <h2 className="font-medium">Baixar meus dados</h2>
        <p className="text-sm text-muted-foreground">
          Um arquivo com seu perfil, formas de login, workspaces e assinatura. Os dados de vendas de cada workspace
          saem pela exportação em CSV.
        </p>
        <Button asChild variant="outline">
          <a href="/account/export">Baixar arquivo</a>
        </Button>
      </section>

      <section className="space-y-2 rounded-lg border border-destructive/40 bg-card px-4 py-3">
        <h2 className="font-medium">Excluir conta</h2>
        <p className="text-sm text-muted-foreground">
          Cancela a assinatura e apaga sua conta e os workspaces em que você é dono.
        </p>
        <DeleteAccountDialog email={session.user.email} ownedWorkspaces={ownedWorkspaces} />
      </section>
    </div>
  );
}
```

Em `src/app/(app)/more/page.tsx`, importar `UserRound` de `lucide-react` e acrescentar ao array `links`, antes do bloco de admin:

```tsx
    {
      href: "/account",
      label: "Minha conta",
      description: "Seus dados, exportação e exclusão da conta",
      icon: UserRound,
    },
```

Se `src/components/ui/dialog.tsx` não exportar algum dos nomes usados, olhar o arquivo e usar os que ele exporta (o projeto já tem `@radix-ui/react-dialog`). Não gerar um componente novo.

- [ ] **Step 6: Typecheck, testes e navegador**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: sem erros.

No navegador, com uma conta descartável que é dona de um workspace de teste: abrir `/more` → "Minha conta"; baixar o arquivo e conferir o JSON; excluir digitando o e-mail errado (erro), depois o certo (volta ao `/sign-in`, e o login com essa conta não funciona mais). Screenshot do diálogo com a lista de workspaces.

- [ ] **Step 7: Commit**

```bash
git add src/server/tenant/account.ts src/server/tenant/account.test.ts src/server/actions/account.ts src/server/actions/account.test.ts "src/app/(app)/account" src/components/account "src/app/(app)/more/page.tsx" eslint.config.mjs
git commit -m "feat(lgpd): tela Minha conta com exportação dos dados e exclusão da conta"
```

---

# Fase 4 — Limite de requisições

Estado ao fim: `/api/auth/*` tem limite por IP guardado no Postgres (sobrevive a várias instâncias serverless); `/api/v1/*` tem limite por usuário e responde 429 com `Retry-After`; o middleware para de redirecionar chamadas de API sem cookie para a tela de login.

Webhooks (`/api/webhooks/*`) ficam de fora de propósito: rejeitam na validação de HMAC/assinatura antes de tocar no banco, e um limite ali poderia descartar reentregas legítimas do gateway.

### Task 15: Middleware deixa `/api/v1` e `/api/cron` passarem

**Files:**
- Modify: `src/middleware.ts`
- Test: `src/middleware.test.ts`

Achado da análise: `config.matcher` não exclui `/api/v1`, e `PUBLIC_PATHS` também não. Uma chamada MCP com `Authorization: Bearer` e sem cookie de sessão recebe hoje um 307 para `/sign-in` em vez de chegar à rota. O Step 1 confirma isso antes de corrigir.

- [ ] **Step 1: Write the failing test**

Adicionar ao `describe("middleware")`:

```ts
  it.each(["/api/v1/items", "/api/cron/reconcile"])("não redireciona %s (a rota autentica sozinha)", (path) => {
    const res = middleware(req(path));
    expect(res.status).not.toBe(307);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/middleware.test.ts`
Expected: FAIL com 307. Se passar, o bug não existe e só o `/api/cron` precisa da mudança; seguir mesmo assim, porque `/api/cron` é novo.

- [ ] **Step 3: Implement**

Acrescentar `"/api/v1/", "/api/cron/"` a `PUBLIC_PATHS` e `api/v1|api/cron|` logo depois de `api/webhooks|` no `config.matcher`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "fix(middleware): não redireciona chamadas de API com token para o login"
```

### Task 16: Rate limit do better-auth em banco

**Files:**
- Create: `prisma/migrations/20260927130000_auth_rate_limit/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/auth.ts`
- Modify: `src/test/db.ts`
- Test: `src/lib/auth-rate-limit.test.ts`

O armazenamento padrão do better-auth é em memória, o que na Vercel significa um contador por instância: inútil. `storage: "database"` usa a tabela `rateLimit` (campos `key` único, `count`, `lastRequest` bigint, conforme `@better-auth/core/dist/db/get-tables.mjs` da 1.6.15).

- [ ] **Step 1: Migration e schema**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS "rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_key_key" ON "rate_limit"("key");

COMMIT;
```

No fim de `prisma/schema.prisma`:

```prisma
model RateLimit {
  id          String @id
  key         String @unique
  count       Int
  lastRequest BigInt

  @@map("rate_limit")
}
```

Aplicar nos dois bancos e rodar `pnpm exec prisma generate`. Em `src/test/db.ts`, acrescentar `"rate_limit",` ao array `TABLES`.

- [ ] **Step 2: Write the failing test**

`src/lib/auth-rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/db";

process.env.AUTH_RATE_LIMIT = "on";
const { auth } = await import("./auth");

function signIn(ip: string) {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email: "ninguem@example.com", password: "errada-123" }),
    }),
  );
}

describe("rate limit de login", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a sexta tentativa no mesmo minuto recebe 429", async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await signIn("203.0.113.7");
      expect(res.status).not.toBe(429);
    }
    const blocked = await signIn("203.0.113.7");
    expect(blocked.status).toBe(429);
  });

  it("outro IP não é afetado", async () => {
    for (let i = 0; i < 6; i += 1) await signIn("203.0.113.8");
    const other = await signIn("198.51.100.1");
    expect(other.status).not.toBe(429);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/auth-rate-limit.test.ts`
Expected: FAIL (sem limite, a sexta tentativa recebe 401).

- [ ] **Step 4: Implement**

Em `src/lib/auth.ts`, dentro de `betterAuth({ ... })`, depois de `session`:

```ts
  rateLimit: {
    enabled: process.env.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT === "on",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/send-verification-email": { window: 60 * 60, max: 5 },
      "/reset-password": { window: 60 * 60, max: 10 },
      "/mcp/register": { window: 60 * 60, max: 10 },
      "/get-session": false,
    },
  },
```

`/get-session` fica sem limite porque todo render de página o chama; limitar ali derrubaria a navegação de quem abre várias abas.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/lib/auth-rate-limit.test.ts src/lib/auth.test.ts src/lib/auth-email.test.ts`
Expected: PASS. Os outros testes de auth não ligam `AUTH_RATE_LIMIT` e continuam sem limite.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260927130000_auth_rate_limit src/lib/auth.ts src/lib/auth-rate-limit.test.ts src/test/db.ts
git commit -m "feat(segurança): limite de tentativas nas rotas de autenticação, guardado no banco"
```

### Task 17: Limite por usuário na API `/api/v1`

**Files:**
- Create: `prisma/migrations/20260927140000_api_rate_limit/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `src/server/tenant/rate-limit.ts`
- Modify: `src/server/tenant/mcp-context.ts`
- Modify: `src/test/db.ts`
- Test: `src/server/tenant/rate-limit.test.ts`
- Test: `src/server/tenant/mcp-context.test.ts`

**Interfaces:**
- Produces: `type RateLimitRule = { limit: number; windowSeconds: number }`, `type RateLimitResult = { allowed: boolean; retryAfterSeconds: number }`, `API_RATE_LIMIT: RateLimitRule` (120 por 60 s), `consumeRateLimit(key: string, rule: RateLimitRule, now?: Date): Promise<RateLimitResult>`, `pruneRateLimits(olderThan: Date): Promise<number>` em `@/server/tenant/rate-limit`. `pruneRateLimits` é usado na Task 19.
- Produces: `class McpRateLimitError { retryAfterSeconds: number }` em `@/server/tenant/mcp-context`.

O limite fica dentro de `requireMcpUserId`, que toda rota `/api/v1/*` já chama via `getMcpWorkspaceContext`. Um ponto só, sem precisar tocar nas 7 rotas.

- [ ] **Step 1: Migration e schema**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS "api_rate_limit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "api_rate_limit_pkey" PRIMARY KEY ("key", "windowStart")
);

CREATE INDEX IF NOT EXISTS "api_rate_limit_windowStart_idx" ON "api_rate_limit"("windowStart");

COMMIT;
```

```prisma
model ApiRateLimit {
  key         String
  windowStart DateTime
  count       Int      @default(0)

  @@id([key, windowStart])
  @@index([windowStart])
  @@map("api_rate_limit")
}
```

Aplicar nos dois bancos, `pnpm exec prisma generate`, e acrescentar `"api_rate_limit",` a `TABLES` em `src/test/db.ts`.

- [ ] **Step 2: Write the failing tests**

`src/server/tenant/rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { consumeRateLimit, pruneRateLimits } from "./rate-limit";

const rule = { limit: 3, windowSeconds: 60 };
const t0 = new Date("2026-09-27T12:00:10Z");

describe("consumeRateLimit", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("libera até o limite e bloqueia o seguinte", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await consumeRateLimit("api:u1", rule, t0)).allowed).toBe(true);
    }
    const blocked = await consumeRateLimit("api:u1", rule, t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
  });

  it("a janela seguinte começa do zero", async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit("api:u1", rule, t0);
    const next = await consumeRateLimit("api:u1", rule, new Date("2026-09-27T12:01:00Z"));
    expect(next.allowed).toBe(true);
  });

  it("chaves diferentes não se afetam", async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit("api:u1", rule, t0);
    expect((await consumeRateLimit("api:u2", rule, t0)).allowed).toBe(true);
  });

  it("chamadas simultâneas não perdem contagem", async () => {
    await Promise.all(Array.from({ length: 5 }, () => consumeRateLimit("api:u3", rule, t0)));
    const row = await testDb.apiRateLimit.findFirstOrThrow({ where: { key: "api:u3" } });
    expect(row.count).toBe(5);
  });

  it("pruneRateLimits apaga só as janelas antigas", async () => {
    await consumeRateLimit("api:u1", rule, new Date("2026-09-25T00:00:00Z"));
    await consumeRateLimit("api:u1", rule, t0);
    const removed = await pruneRateLimits(new Date("2026-09-26T00:00:00Z"));
    expect(removed).toBe(1);
    expect(await testDb.apiRateLimit.count()).toBe(1);
  });
});
```

Em `src/server/tenant/mcp-context.test.ts`, acrescentar `McpRateLimitError` ao import dinâmico de `./mcp-context` e adicionar:

```ts
describe("limite da API", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("recusa com McpRateLimitError quando o usuário estourou a janela", async () => {
    const user = await testDb.user.create({ data: { id: "u-rl", name: "Ana", email: "rl@example.com" } });
    const ws = await createWorkspace("Loja RL");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "OWNER" } });
    mcpSessionResult = { userId: user.id };
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
    await testDb.apiRateLimit.create({ data: { key: `api:${user.id}`, windowStart, count: 120 } });

    await expect(getMcpWorkspaceContext(fakeRequest())).rejects.toThrow(McpRateLimitError);
  });

  it("mcpErrorResponse devolve 429 com Retry-After", async () => {
    const res = mcpErrorResponse(new McpRateLimitError(42));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test src/server/tenant/rate-limit.test.ts src/server/tenant/mcp-context.test.ts`
Expected: FAIL (módulo e classe inexistentes).

- [ ] **Step 4: Implement `rate-limit.ts`**

```ts
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type RateLimitRule = { limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export const API_RATE_LIMIT: RateLimitRule = { limit: 120, windowSeconds: 60 };

async function increment(key: string, windowStart: Date): Promise<number> {
  const row = await db.apiRateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return row.count;
}

export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  let count: number;
  try {
    count = await increment(key, windowStart);
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    count = await increment(key, windowStart);
  }

  const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
  return { allowed: count <= rule.limit, retryAfterSeconds };
}

export async function pruneRateLimits(olderThan: Date): Promise<number> {
  const { count } = await db.apiRateLimit.deleteMany({ where: { windowStart: { lt: olderThan } } });
  return count;
}
```

- [ ] **Step 5: Wire into `mcp-context.ts`**

Importar `API_RATE_LIMIT` e `consumeRateLimit` de `./rate-limit`. Adicionar a classe junto às outras:

```ts
export class McpRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Muitas requisições. Espere um pouco e tente de novo.");
    this.name = "McpRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
```

Em `requireMcpUserId`, trocar o `return userId;` por:

```ts
  const limit = await consumeRateLimit(`api:${userId}`, API_RATE_LIMIT);
  if (!limit.allowed) throw new McpRateLimitError(limit.retryAfterSeconds);
  return userId;
```

Em `mcpErrorResponse`, logo depois da linha do `McpAuthError`:

```ts
  if (e instanceof McpRateLimitError) {
    return Response.json(
      { error: e.message },
      { status: 429, headers: { "Retry-After": String(e.retryAfterSeconds) } },
    );
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/server/tenant/rate-limit.test.ts src/server/tenant/mcp-context.test.ts && pnpm test`
Expected: PASS. Os testes de rotas `/api/v1` existentes fazem poucas chamadas por usuário e não chegam a 120.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260927140000_api_rate_limit src/server/tenant/rate-limit.ts src/server/tenant/rate-limit.test.ts src/server/tenant/mcp-context.ts src/server/tenant/mcp-context.test.ts src/test/db.ts
git commit -m "feat(segurança): limite de 120 requisições por minuto por usuário na API v1"
```

---

# Fase 5 — Reconciliação de assinaturas agendada

Estado ao fim: a Vercel chama `/api/cron/reconcile` todo dia às 06:00 (horário de Brasília). A rota reconcilia as assinaturas InterPix, limpa janelas velhas de rate limit e responde 500 se alguma assinatura falhar, para aparecer como falha no painel de Cron. O script `pnpm reconcile` continua funcionando para rodar à mão.

Depende da Fase 4 (`pruneRateLimits`).

### Task 18: Tirar a reconciliação do script e levar para `src/server`

**Files:**
- Move: `scripts/reconcile-status.ts` → `src/server/tenant/reconcile-status.ts`
- Move: `scripts/reconcile-status.test.ts` → `src/server/tenant/reconcile-status.test.ts`
- Create: `src/server/tenant/reconcile.ts`
- Modify: `scripts/reconcile-subscriptions.ts`
- Test: `src/server/tenant/reconcile.test.ts`

**Interfaces:**
- Produces: `type ReconcileSummary = { checked: number; corrected: number; diverged: number; failed: number }`, `reconcileInterPixSubscriptions(client?: PrismaClient, log?: (line: string) => void): Promise<ReconcileSummary>` em `@/server/tenant/reconcile`.

- [ ] **Step 1: Move the pure module**

```bash
git mv scripts/reconcile-status.ts src/server/tenant/reconcile-status.ts
git mv scripts/reconcile-status.test.ts src/server/tenant/reconcile-status.test.ts
```

Em `src/server/tenant/reconcile-status.ts`, trocar o import `../src/lib/date-validation` por `@/lib/date-validation`. O teste movido continua importando `./reconcile-status` e não muda.

Run: `pnpm test src/server/tenant/reconcile-status.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing test**

`src/server/tenant/reconcile.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

const remote = vi.hoisted(() => ({ byId: {} as Record<string, string | Error> }));

vi.mock("./interpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./interpix")>();
  return {
    ...actual,
    getInterPixSubscription: async (id: string) => {
      const value = remote.byId[id];
      if (value instanceof Error) throw value;
      return {
        id,
        status: value,
        externalUserId: "x",
        planCode: "corre-monthly",
        amount: "34.50",
        nextDueDate: "2026-10-05",
      };
    },
  };
});

const { reconcileInterPixSubscriptions } = await import("./reconcile");

async function seed(userId: string, interpixId: string, status: "ACTIVE" | "PENDING_AUTH") {
  await testDb.user.create({ data: { id: userId, name: userId, email: `${userId}@example.com` } });
  await testDb.subscription.create({
    data: { userId, plan: "corre", status, provider: "INTERPIX", interpixSubscriptionId: interpixId },
  });
}

describe("reconcileInterPixSubscriptions", () => {
  beforeEach(async () => {
    await resetDb();
    remote.byId = {};
  });

  it("aplica o cancelamento remoto e conta a correção", async () => {
    await seed("u1", "ip-1", "ACTIVE");
    remote.byId["ip-1"] = "CANCELED";

    const summary = await reconcileInterPixSubscriptions(undefined, () => {});

    expect(summary).toMatchObject({ checked: 1, corrected: 1, failed: 0 });
    const sub = await testDb.subscription.findUniqueOrThrow({ where: { userId: "u1" } });
    expect(sub.status).toBe("CANCELED");
  });

  it("uma falha no gateway não impede as outras", async () => {
    await seed("u1", "ip-1", "ACTIVE");
    await seed("u2", "ip-2", "ACTIVE");
    remote.byId["ip-1"] = new Error("timeout");
    remote.byId["ip-2"] = "CANCELED";

    const summary = await reconcileInterPixSubscriptions(undefined, () => {});

    expect(summary).toMatchObject({ checked: 2, failed: 1, corrected: 1 });
  });

  it("ignora assinaturas manuais", async () => {
    await testDb.user.create({ data: { id: "u3", name: "u3", email: "u3@example.com" } });
    await testDb.subscription.create({ data: { userId: "u3", plan: "escala", status: "ACTIVE", provider: "MANUAL" } });

    const summary = await reconcileInterPixSubscriptions(undefined, () => {});

    expect(summary.checked).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/server/tenant/reconcile.test.ts`
Expected: FAIL com `Failed to resolve import "./reconcile"`.

- [ ] **Step 4: Implement `reconcile.ts`**

```ts
import type { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { decidePeriodEndCorrection, decideReconcile } from "./reconcile-status";
import { getInterPixSubscription } from "./interpix";

export type ReconcileSummary = { checked: number; corrected: number; diverged: number; failed: number };

export async function reconcileInterPixSubscriptions(
  client: PrismaClient = db,
  log: (line: string) => void = console.log,
): Promise<ReconcileSummary> {
  const subs = await client.subscription.findMany({
    where: {
      provider: "INTERPIX",
      interpixSubscriptionId: { not: null },
      status: { in: ["PENDING_AUTH", "ACTIVE", "PAST_DUE", "SUSPENDED"] },
    },
  });

  const summary: ReconcileSummary = { checked: 0, corrected: 0, diverged: 0, failed: 0 };

  for (const sub of subs) {
    summary.checked += 1;

    let remote: Awaited<ReturnType<typeof getInterPixSubscription>>;
    try {
      remote = await getInterPixSubscription(sub.interpixSubscriptionId as string);
    } catch (e) {
      summary.failed += 1;
      log(`falha ao consultar ${sub.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    try {
      const statusDecision = decideReconcile({ local: sub.status, remote: remote.status });
      const effectiveStatus = statusDecision.action === "apply" ? statusDecision.status : sub.status;
      const periodDecision = decidePeriodEndCorrection({
        localPeriodEnd: sub.currentPeriodEnd,
        remoteNextDueDate: remote.nextDueDate,
        priorLocalStatus: sub.status,
        effectiveStatus,
      });

      const data: {
        status?: SubscriptionStatus;
        currentPeriodEnd?: Date;
        lastPaidAt?: Date;
        paidThroughAt?: Date;
      } = {};

      if (statusDecision.action === "apply") {
        data.status = statusDecision.status;
        if (statusDecision.lastPaidAt) data.lastPaidAt = statusDecision.lastPaidAt;
      }

      if (periodDecision.action === "apply") {
        data.currentPeriodEnd = periodDecision.currentPeriodEnd;
        if (periodDecision.recordPaidThroughAt) data.paidThroughAt = periodDecision.currentPeriodEnd;
      }

      if (Object.keys(data).length > 0) {
        await client.subscription.update({ where: { id: sub.id }, data });
        summary.corrected += 1;
        log(
          `corrigida ${sub.id}: ${
            statusDecision.action === "apply" ? statusDecision.reason : "sem mudança de status"
          }${periodDecision.action === "apply" ? `; ${periodDecision.reason}` : ""}`,
        );
      }

      if (statusDecision.action === "report") {
        summary.diverged += 1;
        log(`divergência em ${sub.id}: ${statusDecision.reason}`);
      }
    } catch (e) {
      summary.failed += 1;
      log(`falha ao gravar ${sub.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}
```

Este corpo é o laço de `scripts/reconcile-subscriptions.ts` copiado sem mudar a lógica. Antes de apagar o original no Step 5, comparar os dois lado a lado. Se o script tiver ganhado algum ramo depois deste plano, levar o ramo junto.

- [ ] **Step 5: Reduce the script to a wrapper**

Substituir `scripts/reconcile-subscriptions.ts` inteiro por:

```ts
import { PrismaClient } from "@prisma/client";
import { DIRECT_DATABASE_URL } from "./direct-database-url";
import { reconcileInterPixSubscriptions } from "../src/server/tenant/reconcile";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

async function main() {
  const summary = await reconcileInterPixSubscriptions(db);

  console.log(
    `verificadas: ${summary.checked}, corrigidas: ${summary.corrected}, divergentes: ${summary.diverged}, falhas: ${summary.failed}`,
  );
  console.log(
    "limitação conhecida: esta rotina parte das linhas do nosso banco, então uma assinatura " +
      "criada na InterPix que nunca foi gravada aqui — cobrando alguém sem nenhum registro " +
      "nosso — é invisível para ela. Só um endpoint de listagem no gateway resolveria isso, e " +
      "o cliente HTTP atual (src/server/tenant/interpix.ts) não expõe um.",
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

- [ ] **Step 6: Run tests and the script**

Run: `pnpm test src/server/tenant/reconcile.test.ts src/server/tenant/reconcile-status.test.ts && pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm reconcile`
Expected: termina com a linha `verificadas: N, ...`. Com `INTERPIX_API_URL` vazio no `.env` local, as consultas falham e contam como `falhas`. O que importa aqui é o script carregar e rodar sem erro de import.

- [ ] **Step 7: Commit**

```bash
git add scripts src/server/tenant/reconcile.ts src/server/tenant/reconcile.test.ts src/server/tenant/reconcile-status.ts src/server/tenant/reconcile-status.test.ts
git commit -m "refactor(billing): leva a reconciliação InterPix para src/server e deixa o script como casca"
```

### Task 19: Rota de cron protegida e agendamento na Vercel

**Files:**
- Create: `src/lib/cron-auth.ts`
- Create: `src/app/api/cron/reconcile/route.ts`
- Create: `vercel.json`
- Modify: `.env.example`
- Test: `src/lib/cron-auth.test.ts`
- Test: `src/app/api/cron/reconcile/route.test.ts`

**Interfaces:**
- Consumes: `reconcileInterPixSubscriptions` (Task 18), `pruneRateLimits` (Task 17).
- Produces: `isAuthorizedCronRequest(header: string | null, secret: string | undefined): boolean`.

Quando `CRON_SECRET` está definida no projeto, a Vercel manda `Authorization: Bearer <CRON_SECRET>` em toda chamada de cron. Sem a variável, a rota recusa tudo: esquecer a configuração deixa o cron falhando (visível no painel), nunca aberto.

`vercel.json` em vez de `vercel.ts`: um cron é a única configuração do projeto, e `vercel.ts` exigiria adicionar `@vercel/config` como dependência só para isso.

- [ ] **Step 1: Write the failing tests**

`src/lib/cron-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron-auth";

describe("isAuthorizedCronRequest", () => {
  it("aceita o Bearer com o segredo certo", () => {
    expect(isAuthorizedCronRequest("Bearer s3gredo", "s3gredo")).toBe(true);
  });

  it("recusa segredo errado, sem cabeçalho ou com tamanho diferente", () => {
    expect(isAuthorizedCronRequest("Bearer outro", "s3gredo")).toBe(false);
    expect(isAuthorizedCronRequest(null, "s3gredo")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer s3gredo-e-mais", "s3gredo")).toBe(false);
  });

  it("sem CRON_SECRET no ambiente, recusa tudo", () => {
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
  });
});
```

`src/app/api/cron/reconcile/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ reconcile: 0, prune: 0, failed: 0 }));

vi.mock("@/server/tenant/reconcile", () => ({
  reconcileInterPixSubscriptions: async () => {
    calls.reconcile += 1;
    return { checked: 2, corrected: 1, diverged: 0, failed: calls.failed };
  },
}));

vi.mock("@/server/tenant/rate-limit", () => ({
  pruneRateLimits: async () => {
    calls.prune += 1;
    return 7;
  },
}));

const { GET } = await import("./route");

function request(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost:3000/api/cron/reconcile", { headers }) as unknown as NextRequest;
}

describe("GET /api/cron/reconcile", () => {
  beforeEach(() => {
    calls.reconcile = 0;
    calls.prune = 0;
    calls.failed = 0;
    process.env.CRON_SECRET = "s3gredo";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("sem o segredo responde 401 e não roda nada", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(calls.reconcile).toBe(0);
  });

  it("com CRON_SECRET ausente no ambiente responde 401", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request("Bearer "));
    expect(res.status).toBe(401);
    expect(calls.reconcile).toBe(0);
  });

  it("com o segredo reconcilia, limpa o rate limit e devolve o resumo", async () => {
    const res = await GET(request("Bearer s3gredo"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 2, corrected: 1, diverged: 0, failed: 0, prunedRateLimits: 7 });
    expect(calls.prune).toBe(1);
  });

  it("responde 500 quando alguma assinatura falhou", async () => {
    calls.failed = 1;
    const res = await GET(request("Bearer s3gredo"));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/cron-auth.test.ts src/app/api/cron/reconcile/route.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implement**

`src/lib/cron-auth.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
```

`src/app/api/cron/reconcile/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { reconcileInterPixSubscriptions } from "@/server/tenant/reconcile";
import { pruneRateLimits } from "@/server/tenant/rate-limit";

export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const summary = await reconcileInterPixSubscriptions();
  const prunedRateLimits = await pruneRateLimits(new Date(Date.now() - DAY_MS));

  console.log("cron/reconcile", JSON.stringify({ ...summary, prunedRateLimits }));

  return Response.json(
    { ...summary, prunedRateLimits },
    { status: summary.failed > 0 ? 500 : 200 },
  );
}
```

`vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/reconcile", "schedule": "0 9 * * *" }]
}
```

`0 9 * * *` é 09:00 UTC = 06:00 em Brasília, antes do horário comercial. O plano Hobby da Vercel aceita cron diário.

Em `.env.example`, adicionar ao final:

```
# ── Cron (reconciliação diária de assinaturas) ──────────────────────────
# A Vercel envia "Authorization: Bearer <CRON_SECRET>" para /api/cron/*.
# Sem esta variável, a rota recusa tudo. Gere com: openssl rand -base64 32
CRON_SECRET=""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/cron-auth.test.ts src/app/api/cron/reconcile/route.test.ts src/middleware.test.ts && pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: PASS em tudo.

- [ ] **Step 5: Verificar localmente**

Com `CRON_SECRET=teste-local` no `.env` e o dev server rodando (`preview_start { name: "cookies-dev" }`), no navegador:

```js
await fetch("/api/cron/reconcile").then((r) => r.status)
```
Expected: `401`.

```js
await fetch("/api/cron/reconcile", { headers: { authorization: "Bearer teste-local" } }).then(async (r) => [r.status, await r.json()])
```
Expected: `[200, {...}]`, ou `[500, {...}]` com `failed > 0` se o InterPix local não estiver configurado. As duas respostas mostram a rota funcionando.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cron-auth.ts src/lib/cron-auth.test.ts src/app/api/cron vercel.json .env.example
git commit -m "feat(billing): reconciliação diária de assinaturas via Vercel Cron"
```

- [ ] **Step 7: Configuração em produção (dono)**

Antes do deploy desta fase: cadastrar `CRON_SECRET` em Production no painel da Vercel (Project → Settings → Environment Variables). Depois do deploy, conferir em Project → Settings → Cron Jobs que `/api/cron/reconcile` aparece, e usar "Run" uma vez para ver o resumo nos logs.

---

## Checklist de produção por fase

| Fase | Antes do deploy | Depois do deploy |
|---|---|---|
| 1 | nada | com uma conta no Corre, conferir o aviso de upgrade nas 3 telas |
| 2 | `RESEND_API_KEY` e `RESEND_FROM` com domínio verificado na Vercel; rodar a migration da Task 6 **imediatamente antes** | criar uma conta de teste e confirmar a chegada dos e-mails |
| 3 | `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_DOCUMENT`, `LEGAL_CONTACT_EMAIL` na Vercel; migrations das Tasks 12 e 13; revisão jurídica dos textos | entrar com uma conta antiga e ver a tela de aceite |
| 4 | migrations das Tasks 16 e 17 | chamar uma rota `/api/v1` com token pelo MCP e confirmar que não cai no login |
| 5 | `CRON_SECRET` na Vercel | rodar o cron uma vez pelo painel |
