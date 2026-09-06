# Checkout transparente via InterPix — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** Trocar o gateway de cobrança do Asaas para a InterPix API self-hosted, com o Pix autorizado dentro da própria tela do produto, sem redirecionar o cliente para fora.

**Architecture:** A InterPix API é dona de assinatura, ciclo, dunning e da comunicação com o Banco Inter. O SaaS só decide entitlement: cria a assinatura, guarda o mapeamento `subscriptionId → userId`, reage a sete eventos de webhook assinados por HMAC e concilia por consulta quando desconfia de entrega perdida. O checkout usa Jornada 2 — autorização e pagamento são separados por dias.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6 + PostgreSQL, Vitest, `qrcode` (novo).

**Spec:** `docs/superpowers/specs/2026-09-02-checkout-interpix-design.md`
**Contrato da API:** handoff da InterPix recebido em 2026-09-02

## Global Constraints

- **Sem comentários no código.** Regra do projeto, sem exceção.
- Sem `any`. `tsc --noEmit`, `next lint` e `next build` limpos ao fim de cada task.
- Dinheiro em centavos inteiros; conversão só na fronteira que exige string.
- Código e identificadores em inglês; texto visível ao usuário em português.
- Nenhum acesso a banco fora de `src/server/**` (regra de lint existente).
- `INTERPIX_API_TOKEN` e `INTERPIX_WEBHOOK_SECRET` são segredos de servidor — **nunca** `NEXT_PUBLIC_*`.
- Toda resposta da InterPix traz `X-Request-Id`: registrar no log em toda chamada, com ou sem erro.
- Testes rodam com `npm test`; banco de teste via `npm run test:db:setup`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/plans.ts` | catálogo de planos e regra de preço (modificado) |
| `src/server/tenant/interpix.ts` | cliente HTTP da InterPix API (novo) |
| `src/server/tenant/interpix-signature.ts` | verificação HMAC, função pura (novo) |
| `src/server/tenant/interpix-events.ts` | aplicação dos sete eventos, ordem e dedupe (novo) |
| `src/app/api/webhooks/interpix/route.ts` | rota de entrada do webhook (novo) |
| `src/server/tenant/subscription.ts` | entitlement e persistência (modificado) |
| `src/server/actions/subscription.ts` | contratação e retomada (modificado) |
| `src/components/workspaces/plan-panel.tsx` | três estados do checkout (modificado) |
| `scripts/reconcile-subscriptions.ts` | conciliação por consulta (modificado) |

Arquivos que morrem na Task 11: `asaas.ts`, `asaas-events.ts`, `asaas.test.ts`, `asaas-events.test.ts`, `src/app/api/webhooks/asaas/`.

---

### Task 1: Preços e catálogo de planos

**Files:**
- Modify: `src/lib/plans.ts`
- Test: `src/lib/plans.test.ts`

**Interfaces:**
- Produces: `PaymentMethod = "PIX" | "CARD"`, `monthlyPriceCents(plan: string, cycle: PlanCycle, method: PaymentMethod): number | null`, `chargeAmountCents(plan: string, cycle: PlanCycle, method: PaymentMethod): number | null`, `planLabel(plan)`, `planWorkspacesLabel(plan)`, `isKnownPlan`, `isKnownCycle`, `planLimit`, `effectiveLimit`.
- Consumes: nada.

- [ ] **Step 1: Escrever os testes das oito células**

Substituir o conteúdo de `src/lib/plans.test.ts` por:

```ts
import { describe, expect, it } from "vitest";
import {
  chargeAmountCents,
  effectiveLimit,
  isKnownPlan,
  monthlyPriceCents,
  planLabel,
  planLimit,
} from "./plans";

describe("preço mensal equivalente", () => {
  it("corre: as quatro combinações batem com a página pública", () => {
    expect(monthlyPriceCents("corre", "MONTHLY", "CARD")).toBe(3950);
    expect(monthlyPriceCents("corre", "MONTHLY", "PIX")).toBe(3450);
    expect(monthlyPriceCents("corre", "YEARLY", "CARD")).toBe(2950);
    expect(monthlyPriceCents("corre", "YEARLY", "PIX")).toBe(2450);
  });

  it("cresce: as quatro combinações batem com a página pública", () => {
    expect(monthlyPriceCents("cresce", "MONTHLY", "CARD")).toBe(9990);
    expect(monthlyPriceCents("cresce", "MONTHLY", "PIX")).toBe(9490);
    expect(monthlyPriceCents("cresce", "YEARLY", "CARD")).toBe(8990);
    expect(monthlyPriceCents("cresce", "YEARLY", "PIX")).toBe(8490);
  });

  it("escala não tem preço de tabela", () => {
    expect(monthlyPriceCents("escala", "MONTHLY", "PIX")).toBeNull();
  });
});

describe("valor da cobrança", () => {
  it("mensal cobra o valor do mês", () => {
    expect(chargeAmountCents("corre", "MONTHLY", "PIX")).toBe(3450);
  });

  it("anual cobra doze meses numa vez só", () => {
    expect(chargeAmountCents("corre", "YEARLY", "PIX")).toBe(29400);
    expect(chargeAmountCents("corre", "YEARLY", "CARD")).toBe(35400);
    expect(chargeAmountCents("cresce", "YEARLY", "PIX")).toBe(101880);
    expect(chargeAmountCents("cresce", "YEARLY", "CARD")).toBe(107880);
  });

  it("a economia anunciada de R$180 no anual com Pix se confirma", () => {
    const mensalNoAno = chargeAmountCents("corre", "MONTHLY", "CARD")! * 12;
    const anualPix = chargeAmountCents("corre", "YEARLY", "PIX")!;
    expect(mensalNoAno - anualPix).toBe(18000);
  });
});

describe("catálogo", () => {
  it("conhece os ids novos e não os antigos", () => {
    expect(isKnownPlan("corre")).toBe(true);
    expect(isKnownPlan("cresce")).toBe(true);
    expect(isKnownPlan("escala")).toBe(true);
    expect(isKnownPlan("solo")).toBe(false);
    expect(isKnownPlan("team")).toBe(false);
  });

  it("limita workspaces por plano", () => {
    expect(planLimit("corre")).toBe(1);
    expect(planLimit("cresce")).toBe(4);
    expect(planLimit("escala")).toBe(Number.POSITIVE_INFINITY);
  });

  it("trial vale por um workspace, qualquer que seja o plano gravado", () => {
    expect(effectiveLimit("cresce", "TRIALING")).toBe(1);
    expect(effectiveLimit("cresce", "ACTIVE")).toBe(4);
  });

  it("rotula o plano pelo nome comercial", () => {
    expect(planLabel("corre")).toBe("Corre");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/plans.test.ts`
Expected: FAIL — `monthlyPriceCents` não existe.

- [ ] **Step 3: Reescrever `src/lib/plans.ts`**

```ts
export type PlanCycle = "MONTHLY" | "YEARLY";
export type PaymentMethod = "PIX" | "CARD";

type PlanDefinition = {
  id: string;
  label: string;
  workspacesLabel: string;
  maxWorkspaces: number;
  baseMonthlyCents: number | null;
};

const YEARLY_DISCOUNT_CENTS = 1000;
const PIX_DISCOUNT_CENTS = 500;
const MONTHS_IN_YEAR = 12;

export const PLANS: PlanDefinition[] = [
  {
    id: "corre",
    label: "Corre",
    workspacesLabel: "1 workspace",
    maxWorkspaces: 1,
    baseMonthlyCents: 3950,
  },
  {
    id: "cresce",
    label: "Cresce",
    workspacesLabel: "Até 4 workspaces",
    maxWorkspaces: 4,
    baseMonthlyCents: 9990,
  },
  {
    id: "escala",
    label: "Escala",
    workspacesLabel: "Workspaces ilimitados",
    maxWorkspaces: Number.POSITIVE_INFINITY,
    baseMonthlyCents: null,
  },
];

function findPlan(plan: string): PlanDefinition {
  return PLANS.find((p) => p.id === plan) ?? PLANS[0];
}

export function isKnownPlan(plan: string): boolean {
  return PLANS.some((p) => p.id === plan);
}

export function isKnownCycle(cycle: string): cycle is PlanCycle {
  return cycle === "MONTHLY" || cycle === "YEARLY";
}

export function isKnownPaymentMethod(method: string): method is PaymentMethod {
  return method === "PIX" || method === "CARD";
}

export function monthlyPriceCents(
  plan: string,
  cycle: PlanCycle,
  method: PaymentMethod,
): number | null {
  const base = findPlan(plan).baseMonthlyCents;
  if (base === null) return null;

  const yearly = cycle === "YEARLY" ? YEARLY_DISCOUNT_CENTS : 0;
  const pix = method === "PIX" ? PIX_DISCOUNT_CENTS : 0;
  return base - yearly - pix;
}

export function chargeAmountCents(
  plan: string,
  cycle: PlanCycle,
  method: PaymentMethod,
): number | null {
  const monthly = monthlyPriceCents(plan, cycle, method);
  if (monthly === null) return null;
  return cycle === "YEARLY" ? monthly * MONTHS_IN_YEAR : monthly;
}

export function planLimit(plan: string): number {
  return findPlan(plan).maxWorkspaces;
}

export function effectiveLimit(plan: string, status: string): number {
  return status === "TRIALING" ? 1 : planLimit(plan);
}

export function planLabel(plan: string): string {
  return findPlan(plan).label;
}

export function planWorkspacesLabel(plan: string): string {
  return findPlan(plan).workspacesLabel;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/plans.test.ts`
Expected: PASS, todos.

- [ ] **Step 5: Consertar quem consumia a API antiga**

`planPriceCents` não existe mais. Os chamadores estão em `src/server/actions/subscription.ts` e `src/components/workspaces/plan-panel.tsx`, e serão reescritos nas Tasks 8 e 9. Para manter a árvore compilando **agora**, ajuste as chamadas para `monthlyPriceCents(plan, cycle, "PIX")` nesses dois arquivos, sem mudar mais nada.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Suíte inteira, lint, build**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```
Expected: tudo verde. Testes que usavam `"solo"`/`"team"` vão falhar — corrija-os para `"corre"`/`"cresce"` nesta task.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat: precos e planos conforme a pagina publica"
```

---

### Task 2: Schema aditivo e migração

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_interpix_provider/migration.sql`
- Test: `src/server/tenant/interpix-migration.test.ts`

**Interfaces:**
- Produces: `SubscriptionProvider { INTERPIX, MANUAL }`; `SubscriptionStatus` com `PENDING_AUTH`, `SUSPENDED`, `AUTH_DENIED`; campos `provider`, `interpixSubscriptionId`, `interpixPixCopyPaste`, `lastAppliedEventId`.
- Consumes: nada.

- [ ] **Step 1: Levantar o estado da produção antes de escrever a migração**

Peça ao dono para rodar e cole o resultado no relatório:

```bash
psql "$DATABASE_URL" -c "SELECT source, plan, status, count(*) FROM subscription GROUP BY 1,2,3;"
```

Não há assinante real, então qualquer linha `source = 'ASAAS'` é resíduo de teste. Elas viram `MANUAL`. Se o resultado contrariar isso, **pare e reporte** em vez de seguir.

- [ ] **Step 2: Editar o schema**

Em `prisma/schema.prisma`, no enum `SubscriptionStatus`, acrescentar `PENDING_AUTH`, `SUSPENDED`, `AUTH_DENIED`. Criar:

```prisma
enum SubscriptionProvider {
  INTERPIX
  MANUAL
}
```

No model `Subscription`, acrescentar (mantendo `source` e os campos `asaas*` por enquanto — saem na Task 11):

```prisma
  provider               SubscriptionProvider @default(INTERPIX)
  interpixSubscriptionId String?              @unique
  interpixPixCopyPaste   String?
  lastAppliedEventId     BigInt?
```

- [ ] **Step 3: Gerar a migração**

```bash
npx prisma migrate dev --name interpix_provider --create-only 2>/dev/null
```

O `2>/dev/null` é obrigatório: sem ele o banner de aviso do Prisma acaba dentro do `.sql` e a aplicação falha com P3018. Confirme que o arquivo começa com `--`.

- [ ] **Step 4: Acrescentar o backfill ao SQL gerado**

No fim do `migration.sql`, acrescentar:

```sql
UPDATE "subscription" SET "provider" = 'MANUAL' WHERE "source" = 'MANUAL';
UPDATE "subscription" SET "provider" = 'INTERPIX' WHERE "source" = 'ASAAS';
UPDATE "subscription" SET "plan" = 'corre' WHERE "plan" = 'solo';
UPDATE "subscription" SET "plan" = 'cresce' WHERE "plan" = 'team';
UPDATE "subscription" SET "plan" = 'escala' WHERE "plan" = 'unlimited';
```

- [ ] **Step 5: Escrever o teste que executa o SQL de verdade**

Criar `src/server/tenant/interpix-migration.test.ts`:

```ts
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { canWriteInWorkspace } from "./subscription";

function migrationSql(): string {
  const dir = join(process.cwd(), "prisma", "migrations");
  const name = readdirSync(dir).find((d) => d.endsWith("_interpix_provider"));
  if (!name) throw new Error("migration interpix_provider não encontrada");
  return readFileSync(join(dir, name, "migration.sql"), "utf8");
}

describe("migração para InterPix", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("o arquivo começa com comentário SQL", () => {
    expect(migrationSql().trimStart().startsWith("--")).toBe(true);
  });

  it("o dono pré-billing continua MANUAL e continua escrevendo", async () => {
    const user = await testDb.user.create({
      data: { id: "u-mig", name: "Dona", email: "mig@example.com" },
    });
    const ws = await testDb.workspace.create({
      data: { name: "Douce Vie", slug: "douce-vie-mig" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "MANUAL",
        status: "ACTIVE",
      },
    });

    expect(await canWriteInWorkspace(ws.id)).toBe(true);

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.provider).toBe("MANUAL");
  });
});
```

- [ ] **Step 6: Aplicar e rodar**

```bash
npx prisma migrate dev 2>/dev/null && npx prisma generate && npm run test:db:setup
npx vitest run src/server/tenant/interpix-migration.test.ts
```
Expected: PASS.

- [ ] **Step 7: Suíte, tipos, lint, build; commit**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
git add prisma/ src/server/tenant/interpix-migration.test.ts
git commit -m "feat: schema e migracao para o provedor InterPix"
```

---

### Task 3: Cliente da InterPix API

**Files:**
- Create: `src/server/tenant/interpix.ts`
- Test: `src/server/tenant/interpix.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `InterPixApiError`, `amountFromCents(cents: number): string`, `createInterPixSubscription(input): Promise<InterPixSubscription>`, `getInterPixSubscription(id: string): Promise<InterPixSubscription>`, `cancelInterPixSubscription(id: string): Promise<void>`.
- Consumes: nada.

- [ ] **Step 1: Escrever os testes**

Criar `src/server/tenant/interpix.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amountFromCents,
  cancelInterPixSubscription,
  createInterPixSubscription,
  InterPixApiError,
} from "./interpix";

beforeEach(() => {
  vi.stubEnv("INTERPIX_API_URL", "https://interpix.test");
  vi.stubEnv("INTERPIX_API_TOKEN", "token-de-teste-com-24-chars");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("amountFromCents", () => {
  it("sempre usa duas casas, que é o que a API aceita", () => {
    expect(amountFromCents(2990)).toBe("29.90");
    expect(amountFromCents(3450)).toBe("34.50");
    expect(amountFromCents(29400)).toBe("294.00");
    expect(amountFromCents(101880)).toBe("1018.80");
    expect(amountFromCents(100)).toBe("1.00");
  });

  it("nunca produz uma casa só", () => {
    expect(amountFromCents(2990)).not.toBe("29.9");
  });
});

describe("createInterPixSubscription", () => {
  it("manda o token no Authorization e devolve o copia-e-cola", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: "sub-1",
            status: "PENDING_AUTH",
            externalUserId: "usr_1",
            planCode: "corre",
            amount: "34.50",
            nextDueDate: "2026-09-20",
            authorization: { pixCopyPaste: "00020126...", url: "https://qr.test/1" },
          }),
          { status: 201, headers: { "X-Request-Id": "req-1" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createInterPixSubscription({
      externalUserId: "usr_1",
      planCode: "corre",
      amountCents: 3450,
      intervalMonths: 1,
      firstDueDate: "2026-09-20",
      debtor: { taxId: "12345678901", name: "Fulano de Tal" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://interpix.test/subscriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-de-teste-com-24-chars",
    );
    expect(JSON.parse(init.body as string).amount).toBe("34.50");
    expect(result.authorization?.pixCopyPaste).toBe("00020126...");
  });

  it("expõe o code do erro, não a mensagem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ code: "BAD_REQUEST", message: "Payload invalido.", details: [] }),
            { status: 400 },
          ),
      ),
    );

    await expect(
      createInterPixSubscription({
        externalUserId: "usr_1",
        planCode: "corre",
        amountCents: 3450,
        intervalMonths: 1,
        firstDueDate: "2026-09-20",
        debtor: { taxId: "123", name: "X" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lança quando a configuração está ausente, sem cair em padrão silencioso", async () => {
    vi.stubEnv("INTERPIX_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createInterPixSubscription({
        externalUserId: "usr_1",
        planCode: "corre",
        amountCents: 3450,
        intervalMonths: 1,
        firstDueDate: "2026-09-20",
        debtor: { taxId: "12345678901", name: "X" },
      }),
    ).rejects.toThrow("INTERPIX_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cancelInterPixSubscription", () => {
  it("trata 409 INVALID_TRANSITION como sucesso, porque cancelar não é idempotente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ code: "INVALID_TRANSITION", message: "..." }), {
            status: 409,
          }),
      ),
    );

    await expect(cancelInterPixSubscription("sub-1")).resolves.toBeUndefined();
  });

  it("outros erros continuam sendo erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
      ),
    );

    await expect(cancelInterPixSubscription("sub-1")).rejects.toBeInstanceOf(InterPixApiError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/tenant/interpix.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/server/tenant/interpix.ts`**

```ts
export class InterPixApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;

  constructor(code: string, message: string, requestId: string | null) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}

export type InterPixSubscriptionStatus =
  | "PENDING_AUTH"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELED"
  | "AUTH_DENIED";

export type InterPixSubscription = {
  id: string;
  status: InterPixSubscriptionStatus;
  externalUserId: string;
  planCode: string;
  amount: string;
  nextDueDate: string;
  authorization?: { pixCopyPaste: string; url: string };
};

export type CreateSubscriptionInput = {
  externalUserId: string;
  planCode: string;
  amountCents: number;
  intervalMonths: number;
  firstDueDate: string;
  debtor: { taxId: string; name: string };
};

export function amountFromCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function config(): { url: string; token: string } {
  const url = process.env.INTERPIX_API_URL;
  const token = process.env.INTERPIX_API_TOKEN;
  if (!url) throw new Error("INTERPIX_API_URL não configurada");
  if (!token) throw new Error("INTERPIX_API_TOKEN não configurada");
  return { url: url.replace(/\/$/, ""), token };
}

type ErrorBody = { code?: string; message?: string };

async function request<T>(
  path: string,
  init: RequestInit,
  okStatuses: number[],
): Promise<{ body: T | null; status: number; requestId: string | null }> {
  const { url, token } = config();

  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const requestId = response.headers.get("X-Request-Id");
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as T & ErrorBody) : null;

  console.info("interpix", path, response.status, requestId);

  if (!okStatuses.includes(response.status)) {
    throw new InterPixApiError(
      parsed?.code ?? "INTERNAL_ERROR",
      parsed?.message ?? `InterPix respondeu ${response.status}`,
      requestId,
    );
  }

  return { body: parsed, status: response.status, requestId };
}

export async function createInterPixSubscription(
  input: CreateSubscriptionInput,
): Promise<InterPixSubscription> {
  const { body } = await request<InterPixSubscription>(
    "/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        externalUserId: input.externalUserId,
        planCode: input.planCode,
        amount: amountFromCents(input.amountCents),
        intervalMonths: input.intervalMonths,
        firstDueDate: input.firstDueDate,
        debtor: input.debtor,
      }),
    },
    [200, 201],
  );

  if (!body) throw new InterPixApiError("INTERNAL_ERROR", "Resposta vazia da InterPix", null);
  return body;
}

export async function getInterPixSubscription(id: string): Promise<InterPixSubscription> {
  const { body } = await request<InterPixSubscription>(
    `/subscriptions/${encodeURIComponent(id)}`,
    { method: "GET" },
    [200],
  );

  if (!body) throw new InterPixApiError("INTERNAL_ERROR", "Resposta vazia da InterPix", null);
  return body;
}

export async function cancelInterPixSubscription(id: string): Promise<void> {
  await request(
    `/subscriptions/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
    [200, 409],
  );
}
```

O `409` entra na lista de status aceitos do cancelamento porque o contrato manda tratá-lo como sucesso: o cenário real é timeout de rede em que a primeira chamada funcionou.

**Nota de escopo:** `cancelInterPixSubscription` não tem chamador nesta fase — o cancelamento pelo próprio cliente ficou fora de escopo na spec. Fica implementado e testado porque a regra do 409 é fácil de esquecer depois e cara de descobrir em produção, mas quem revisar vai notar que é a única função do módulo sem uso. É consciente.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/tenant/interpix.test.ts`
Expected: PASS.

- [ ] **Step 5: Documentar as variáveis**

Em `.env.example`, substituir o bloco do Asaas por:

```
# InterPix API (gateway Pix self-hosted)
# Chamadas sao server-side; o token nunca vai para o cliente.
# INTERPIX_WEBHOOK_SECRET valida o HMAC dos eventos de entrada.
# Do outro lado, SAAS_WEBHOOK_URL da InterPix aponta para
# https://<dominio>/api/webhooks/interpix
INTERPIX_API_URL=""
INTERPIX_API_TOKEN=""
INTERPIX_WEBHOOK_SECRET=""
```

- [ ] **Step 6: Verificar e commitar**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
git add src/server/tenant/interpix.ts src/server/tenant/interpix.test.ts .env.example
git commit -m "feat: cliente da InterPix API"
```

---

### Task 4: Verificação da assinatura HMAC

**Files:**
- Create: `src/server/tenant/interpix-signature.ts`
- Test: `src/server/tenant/interpix-signature.test.ts`

**Interfaces:**
- Produces: `isValidInterPixSignature(input: { raw: string; timestamp: string; signature: string; secret: string; now?: number }): boolean`.
- Consumes: nada.

- [ ] **Step 1: Escrever os testes**

```ts
import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { isValidInterPixSignature } from "./interpix-signature";

const SECRET = "segredo-de-teste";

function sign(raw: string, timestamp: string): string {
  return createHmac("sha256", SECRET).update(`${timestamp}.${raw}`).digest("hex");
}

describe("assinatura do webhook InterPix", () => {
  const now = 1_800_000_000_000;
  const raw = '{"type":"cycle.paid","data":{},"eventId":"1"}';
  const ts = String(now - 1000);

  it("aceita assinatura correta dentro da janela", () => {
    expect(
      isValidInterPixSignature({ raw, timestamp: ts, signature: sign(raw, ts), secret: SECRET, now }),
    ).toBe(true);
  });

  it("recusa assinatura de outro segredo", () => {
    const outra = createHmac("sha256", "outro").update(`${ts}.${raw}`).digest("hex");
    expect(
      isValidInterPixSignature({ raw, timestamp: ts, signature: outra, secret: SECRET, now }),
    ).toBe(false);
  });

  it("recusa corpo alterado depois de assinado", () => {
    const assinatura = sign(raw, ts);
    const adulterado = raw.replace("cycle.paid", "cycle.failed");
    expect(
      isValidInterPixSignature({
        raw: adulterado,
        timestamp: ts,
        signature: assinatura,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("recusa timestamp com mais de cinco minutos", () => {
    const velho = String(now - 6 * 60 * 1000);
    expect(
      isValidInterPixSignature({
        raw,
        timestamp: velho,
        signature: sign(raw, velho),
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("recusa timestamp no futuro", () => {
    const futuro = String(now + 60 * 1000);
    expect(
      isValidInterPixSignature({
        raw,
        timestamp: futuro,
        signature: sign(raw, futuro),
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("recusa assinatura que não é hex, sem quebrar", () => {
    expect(
      isValidInterPixSignature({ raw, timestamp: ts, signature: "nao-e-hex", secret: SECRET, now }),
    ).toBe(false);
  });

  it("recusa timestamp que não é número", () => {
    expect(
      isValidInterPixSignature({ raw, timestamp: "ontem", signature: sign(raw, "ontem"), secret: SECRET, now }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/tenant/interpix-signature.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_MS = 5 * 60 * 1000;

export function isValidInterPixSignature(input: {
  raw: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
}): boolean {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const age = (input.now ?? Date.now()) - timestamp;
  if (age > MAX_AGE_MS || age < 0) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.raw}`)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(input.signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

`Buffer.from(x, "hex")` não lança com entrada inválida — devolve buffer curto. A comparação de tamanho antes do `timingSafeEqual` é o que segura isso.

- [ ] **Step 4: Rodar, verificar, commitar**

```bash
npx vitest run src/server/tenant/interpix-signature.test.ts
npm test && npx tsc --noEmit && npm run lint
git add src/server/tenant/interpix-signature.ts src/server/tenant/interpix-signature.test.ts
git commit -m "feat: verificacao HMAC dos eventos da InterPix"
```

---

### Task 5: Aplicação dos eventos

**Files:**
- Create: `src/server/tenant/interpix-events.ts`
- Test: `src/server/tenant/interpix-events.test.ts`

**Interfaces:**
- Produces: `InterPixEvent` (união dos sete), `applyInterPixEvent(event: InterPixEvent): Promise<EventOutcome>` com `EventOutcome = "applied" | "duplicate" | "stale" | "unknown"`.
- Consumes: `db` de `@/lib/db`.

- [ ] **Step 1: Escrever os testes**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { applyInterPixEvent } from "./interpix-events";

const GRACE_DAYS = 7;

async function assinante(id: string, overrides: Record<string, unknown> = {}) {
  const user = await testDb.user.create({
    data: { id, name: "Dono", email: `${id}@example.com` },
  });
  await testDb.subscription.create({
    data: {
      userId: user.id,
      plan: "corre",
      provider: "INTERPIX",
      status: "PENDING_AUTH",
      interpixSubscriptionId: `ipx-${id}`,
      currentPeriodEnd: new Date("2026-09-20T00:00:00Z"),
      ...overrides,
    },
  });
  return user;
}

function subOf(userId: string) {
  return testDb.subscription.findUnique({ where: { userId } });
}

describe("eventos da InterPix", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cycle.paid ativa o plano e limpa a carência", async () => {
    const user = await assinante("u-paid", { graceUntil: new Date("2026-09-27T00:00:00Z") });

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "10",
      data: { subscriptionId: "ipx-u-paid", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("applied");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.graceUntil).toBeNull();
  });

  it("subscription.authorized NÃO ativa o plano — autorização não é pagamento", async () => {
    const user = await assinante("u-auth");

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "11",
      data: { subscriptionId: "ipx-u-auth", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).not.toBe("ACTIVE");
  });

  it("subscription.authorized estende a carência até o vencimento mais sete dias", async () => {
    const user = await assinante("u-grace");

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "12",
      data: { subscriptionId: "ipx-u-grace", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    const esperado = new Date("2026-09-20T00:00:00Z");
    esperado.setDate(esperado.getDate() + GRACE_DAYS);
    expect(sub?.graceUntil?.toISOString()).toBe(esperado.toISOString());
  });

  it("cycle.failed mantém o acesso — dunning não é corte", async () => {
    const user = await assinante("u-failed", { status: "ACTIVE" });

    await applyInterPixEvent({
      type: "cycle.failed",
      eventId: "13",
      data: { subscriptionId: "ipx-u-failed", cycleSeq: 2, reason: "saldo insuficiente" },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
  });

  it("subscription.suspended corta o acesso", async () => {
    const user = await assinante("u-susp", { status: "PAST_DUE" });

    await applyInterPixEvent({
      type: "subscription.suspended",
      eventId: "14",
      data: { subscriptionId: "ipx-u-susp", externalUserId: user.id },
    });

    expect((await subOf(user.id))?.status).toBe("SUSPENDED");
  });

  it("evento repetido não reaplica", async () => {
    const user = await assinante("u-dup");
    const evento = {
      type: "cycle.paid" as const,
      eventId: "20",
      data: { subscriptionId: "ipx-u-dup", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    };

    expect(await applyInterPixEvent(evento)).toBe("applied");
    expect(await applyInterPixEvent(evento)).toBe("duplicate");
    expect((await subOf(user.id))?.lastAppliedEventId).toBe(20n);
  });

  it("evento atrasado não reativa quem já cancelou", async () => {
    const user = await assinante("u-stale");

    await applyInterPixEvent({
      type: "subscription.canceled",
      eventId: "30",
      data: { subscriptionId: "ipx-u-stale", externalUserId: user.id, pendingCycleSeq: null },
    });

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "29",
      data: { subscriptionId: "ipx-u-stale", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("stale");
    expect((await subOf(user.id))?.status).toBe("CANCELED");
  });

  it("compara eventId como número: 1000 é mais novo que 999", async () => {
    const user = await assinante("u-bigint");

    await applyInterPixEvent({
      type: "subscription.past_due",
      eventId: "999",
      data: { subscriptionId: "ipx-u-bigint", externalUserId: user.id, retryDate: "2026-09-25" },
    });

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "1000",
      data: { subscriptionId: "ipx-u-bigint", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("applied");
    expect((await subOf(user.id))?.status).toBe("ACTIVE");
  });

  it("assinatura desconhecida não quebra e não cria nada", async () => {
    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "40",
      data: { subscriptionId: "ipx-nao-existe", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("unknown");
    expect(await testDb.subscription.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/tenant/interpix-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const GRACE_DAYS = 7;

export type InterPixEvent =
  | { type: "cycle.paid"; eventId: string; data: { subscriptionId: string; cycleSeq: number; amount: string; paidAt: string } }
  | { type: "cycle.failed"; eventId: string; data: { subscriptionId: string; cycleSeq: number; reason: string | null } }
  | { type: "subscription.authorized"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.auth_denied"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.past_due"; eventId: string; data: { subscriptionId: string; externalUserId: string; retryDate: string } }
  | { type: "subscription.suspended"; eventId: string; data: { subscriptionId: string; externalUserId: string } }
  | { type: "subscription.canceled"; eventId: string; data: { subscriptionId: string; externalUserId: string; pendingCycleSeq: number | null } };

export type EventOutcome = "applied" | "duplicate" | "stale" | "unknown";

function isDuplicateEventError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function changesFor(
  event: InterPixEvent,
  current: { currentPeriodEnd: Date | null },
): Prisma.SubscriptionUpdateInput {
  switch (event.type) {
    case "cycle.paid":
      return { status: "ACTIVE", graceUntil: null };
    case "cycle.failed":
      return {};
    case "subscription.authorized":
      return {
        status: "PENDING_AUTH",
        graceUntil: current.currentPeriodEnd
          ? addDays(current.currentPeriodEnd, GRACE_DAYS)
          : null,
      };
    case "subscription.auth_denied":
      return { status: "AUTH_DENIED" };
    case "subscription.past_due":
      return { status: "PAST_DUE" };
    case "subscription.suspended":
      return { status: "SUSPENDED" };
    case "subscription.canceled":
      return { status: "CANCELED" };
  }
}

export async function applyInterPixEvent(event: InterPixEvent): Promise<EventOutcome> {
  const seen = await db.processedWebhookEvent.findUnique({ where: { id: event.eventId } });
  if (seen) return "duplicate";

  const sub = await db.subscription.findUnique({
    where: { interpixSubscriptionId: event.data.subscriptionId },
  });

  if (!sub) {
    await recordOnly(event);
    return "unknown";
  }

  const incoming = BigInt(event.eventId);
  if (sub.lastAppliedEventId !== null && incoming <= sub.lastAppliedEventId) {
    await recordOnly(event);
    return "stale";
  }

  try {
    await db.$transaction([
      db.subscription.update({
        where: { id: sub.id },
        data: { ...changesFor(event, sub), lastAppliedEventId: incoming },
      }),
      db.processedWebhookEvent.create({ data: { id: event.eventId, event: event.type } }),
    ]);
    return "applied";
  } catch (error) {
    if (isDuplicateEventError(error)) return "duplicate";
    throw error;
  }
}

async function recordOnly(event: InterPixEvent): Promise<void> {
  try {
    await db.processedWebhookEvent.create({ data: { id: event.eventId, event: event.type } });
  } catch (error) {
    if (!isDuplicateEventError(error)) throw error;
  }
}
```

- [ ] **Step 4: Rodar, verificar, commitar**

```bash
npx vitest run src/server/tenant/interpix-events.test.ts
npm test && npx tsc --noEmit && npm run lint && npm run build
git add src/server/tenant/interpix-events.ts src/server/tenant/interpix-events.test.ts
git commit -m "feat: aplicacao dos eventos da InterPix com ordem e dedupe"
```

---

### Task 6: Rota do webhook

**Files:**
- Create: `src/app/api/webhooks/interpix/route.ts`
- Test: `src/app/api/webhooks/interpix/route.test.ts`

**Interfaces:**
- Consumes: `isValidInterPixSignature` (Task 4), `applyInterPixEvent` (Task 5).

- [ ] **Step 1: Escrever os testes**

```ts
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { POST } from "./route";

const SECRET = "segredo-do-webhook";

function entrega(body: unknown, opts: { secret?: string; timestamp?: string } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(Date.now());
  const signature = createHmac("sha256", opts.secret ?? SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");

  return new NextRequest("http://localhost/api/webhooks/interpix", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
      "x-timestamp": timestamp,
    },
  });
}

describe("POST /api/webhooks/interpix", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("INTERPIX_WEBHOOK_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("assinatura válida é processada", async () => {
    const user = await testDb.user.create({
      data: { id: "u-hook", name: "Dono", email: "hook@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        interpixSubscriptionId: "ipx-hook",
      },
    });

    const response = await POST(
      entrega({
        type: "cycle.paid",
        eventId: "50",
        data: { subscriptionId: "ipx-hook", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
      }),
    );

    expect(response.status).toBe(200);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("ACTIVE");
  });

  it("assinatura de outro segredo devolve 401 e não toca no banco", async () => {
    const response = await POST(
      entrega(
        { type: "cycle.paid", eventId: "51", data: { subscriptionId: "x", cycleSeq: 1, amount: "1.00", paidAt: "" } },
        { secret: "errado" },
      ),
    );

    expect(response.status).toBe(401);
    expect(await testDb.processedWebhookEvent.count()).toBe(0);
  });

  it("timestamp velho devolve 401", async () => {
    const velho = String(Date.now() - 10 * 60 * 1000);
    const response = await POST(
      entrega(
        { type: "cycle.paid", eventId: "52", data: { subscriptionId: "x", cycleSeq: 1, amount: "1.00", paidAt: "" } },
        { timestamp: velho },
      ),
    );

    expect(response.status).toBe(401);
  });

  it("segredo ausente na configuração devolve 401, sem processar", async () => {
    vi.stubEnv("INTERPIX_WEBHOOK_SECRET", "");
    const response = await POST(
      entrega({ type: "cycle.paid", eventId: "53", data: { subscriptionId: "x", cycleSeq: 1, amount: "1.00", paidAt: "" } }),
    );

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/api/webhooks/interpix/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isValidInterPixSignature } from "@/server/tenant/interpix-signature";
import { applyInterPixEvent, type InterPixEvent } from "@/server/tenant/interpix-events";

export async function POST(request: NextRequest) {
  const secret = process.env.INTERPIX_WEBHOOK_SECRET;
  const raw = await request.text();
  const signature = request.headers.get("x-signature") ?? "";
  const timestamp = request.headers.get("x-timestamp") ?? "";

  if (!secret || !isValidInterPixSignature({ raw, timestamp, signature, secret })) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let event: InterPixEvent;
  try {
    event = JSON.parse(raw) as InterPixEvent;
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  if (!event.type || !event.eventId || !event.data?.subscriptionId) {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const outcome = await applyInterPixEvent(event);
  return NextResponse.json({ outcome });
}
```

O corpo é lido com `request.text()` **antes de qualquer parse**, porque a assinatura é sobre os bytes originais. `JSON.stringify` de um objeto já parseado não é byte-a-byte igual e a assinatura não bateria.

- [ ] **Step 4: Confirmar que o middleware deixa a rota passar**

O `src/middleware.ts` isenta `api/webhooks` inteiro, mas isso precisa ser provado, não presumido — já houve nesta base um webhook em produção protegido por engano. Rode:

```bash
node -e '
const m = require("fs").readFileSync("src/middleware.ts","utf8");
const src = m.match(/matcher:\s*\[([^\]]+)\]/s)[1].match(/"([^"]+)"/)[1];
const re = new RegExp(src.replace(/^\//,"").replace(/\/$/,""));
for (const p of ["/api/webhooks/interpix","/dashboard","/sales"]) {
  console.log(p, re.test(p) ? "INTERCEPTADA" : "livre");
}'
```
Expected: `/api/webhooks/interpix livre`, `/dashboard INTERCEPTADA`, `/sales INTERCEPTADA`.

- [ ] **Step 5: Verificar e commitar**

```bash
npx vitest run src/app/api/webhooks/interpix/route.test.ts
npm test && npx tsc --noEmit && npm run lint && npm run build
git add src/app/api/webhooks/interpix/
git commit -m "feat: rota de webhook da InterPix"
```

---

### Task 7: Entitlement

**Files:**
- Modify: `src/server/tenant/subscription.ts`
- Test: `src/server/tenant/subscription.test.ts`

**Interfaces:**
- Produces: `isSubscriptionUsable(sub, now?)` com o vocabulário novo; `recordInterPixSubscription(input)`.
- Consumes: enums da Task 2.

- [ ] **Step 1: Escrever os testes de acesso**

Acrescentar a `src/server/tenant/subscription.test.ts` um bloco novo, substituindo o `describe("assinatura utilizavel")` existente:

```ts
describe("assinatura utilizavel", () => {
  const now = new Date("2026-09-20T12:00:00Z");

  it("ACTIVE vale", () => {
    expect(isSubscriptionUsable({ status: "ACTIVE" } as never, now)).toBe(true);
  });

  it("PAST_DUE vale — está em dunning e ainda pode pagar", () => {
    expect(isSubscriptionUsable({ status: "PAST_DUE" } as never, now)).toBe(true);
  });

  it("PENDING_AUTH vale enquanto a carência da autorização durar", () => {
    const sub = { status: "PENDING_AUTH", graceUntil: new Date("2026-09-27") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PENDING_AUTH sem carência não vale — autorizar não é pagar", () => {
    const sub = { status: "PENDING_AUTH", graceUntil: null } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("PENDING_AUTH com carência vencida não vale", () => {
    const sub = { status: "PENDING_AUTH", graceUntil: new Date("2026-09-10") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("SUSPENDED, CANCELED e AUTH_DENIED não valem", () => {
    expect(isSubscriptionUsable({ status: "SUSPENDED" } as never, now)).toBe(false);
    expect(isSubscriptionUsable({ status: "CANCELED" } as never, now)).toBe(false);
    expect(isSubscriptionUsable({ status: "AUTH_DENIED" } as never, now)).toBe(false);
  });

  it("TRIALING vale dentro do prazo", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-09-30") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("TRIALING vencido não vale", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-09-01") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("sem assinatura não vale", () => {
    expect(isSubscriptionUsable(null, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/tenant/subscription.test.ts`
Expected: FAIL — `PENDING_AUTH` cai no `return false` final.

- [ ] **Step 3: Reescrever `isSubscriptionUsable`**

Substituir a função em `src/server/tenant/subscription.ts` por:

```ts
export function isSubscriptionUsable(
  sub: Subscription | null,
  now: Date = new Date(),
): boolean {
  if (!sub) return false;
  if (sub.status === "ACTIVE") return true;
  if (sub.status === "PAST_DUE") return true;
  if (sub.status === "TRIALING") {
    return sub.trialEndsAt === null || sub.trialEndsAt > now;
  }
  if (sub.status === "PENDING_AUTH") {
    return sub.graceUntil !== null && sub.graceUntil > now;
  }
  return false;
}
```

`PAST_DUE` passa a valer sem depender de `graceUntil`: quem administra o dunning é a InterPix, e quando ela esgotar as tentativas manda `subscription.suspended`. Se esse evento se perder, a conciliação da Task 10 é a rede.

- [ ] **Step 4: Trocar `recordAsaasSubscription` por `recordInterPixSubscription`**

```ts
export async function recordInterPixSubscription(input: {
  userId: string;
  plan: string;
  cycle: SubscriptionCycle;
  interpixSubscriptionId: string;
  pixCopyPaste: string | null;
  nextDueDate: Date;
}): Promise<void> {
  await db.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      plan: input.plan,
      cycle: input.cycle,
      provider: "INTERPIX",
      status: "PENDING_AUTH",
      interpixSubscriptionId: input.interpixSubscriptionId,
      interpixPixCopyPaste: input.pixCopyPaste,
      currentPeriodEnd: input.nextDueDate,
    },
    update: {
      plan: input.plan,
      cycle: input.cycle,
      provider: "INTERPIX",
      status: "PENDING_AUTH",
      interpixSubscriptionId: input.interpixSubscriptionId,
      interpixPixCopyPaste: input.pixCopyPaste,
      currentPeriodEnd: input.nextDueDate,
    },
  });
}
```

Também trocar `source: "ASAAS"` por `provider: "INTERPIX"` em `ensureTrialSubscription` e o `plan: "solo"` por `plan: "corre"`.

- [ ] **Step 5: Verificar e commitar**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
git add src/server/tenant/subscription.ts src/server/tenant/subscription.test.ts
git commit -m "feat: entitlement com o vocabulario de status da InterPix"
```

---

### Task 8: Contratação e retomada

**Files:**
- Modify: `src/server/actions/subscription.ts`
- Test: `src/server/actions/subscription.test.ts`

**Interfaces:**
- Produces: `subscribe(formData): Promise<ActionResult<CheckoutResult>>` com `CheckoutResult = { pixCopyPaste: string; nextDueDate: string }`; `resumeCheckout(): Promise<ActionResult<CheckoutResult>>`.
- Consumes: Tasks 1, 3, 7.

- [ ] **Step 1: Escrever os testes**

Substituir o conteúdo de `src/server/actions/subscription.test.ts`, mantendo os helpers `userWithWorkspace` e a estrutura de mocks já existentes, e usando:

```ts
function stubInterPixFetch() {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          id: "ipx-novo",
          status: "PENDING_AUTH",
          externalUserId: "usr",
          planCode: "corre",
          amount: "34.50",
          nextDueDate: "2026-09-20",
          authorization: { pixCopyPaste: "00020126-copia-e-cola", url: "https://qr.test/1" },
        }),
        { status: 201 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
```

Testes obrigatórios:

```ts
it("cria a assinatura, grava o mapeamento e devolve o copia-e-cola", async () => {
  const { user } = await userWithWorkspace("u-sub", "sub@example.com");
  stubInterPixFetch();

  const formData = new FormData();
  formData.set("plan", "corre");
  formData.set("cycle", "MONTHLY");
  formData.set("cpfCnpj", "123.456.789-09");

  const result = await subscribe(formData);
  expect(result.ok).toBe(true);
  expect(result.data?.pixCopyPaste).toBe("00020126-copia-e-cola");

  const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
  expect(sub?.interpixSubscriptionId).toBe("ipx-novo");
  expect(sub?.status).toBe("PENDING_AUTH");
  expect(sub?.provider).toBe("INTERPIX");
});

it("manda o valor do Pix, não o do cartão", async () => {
  await userWithWorkspace("u-valor", "valor@example.com");
  const fetchMock = stubInterPixFetch();

  const formData = new FormData();
  formData.set("plan", "corre");
  formData.set("cycle", "MONTHLY");
  formData.set("cpfCnpj", "12345678909");
  await subscribe(formData);

  expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).amount).toBe("34.50");
});

it("plano anual manda os doze meses numa cobrança só", async () => {
  await userWithWorkspace("u-anual", "anual@example.com");
  const fetchMock = stubInterPixFetch();

  const formData = new FormData();
  formData.set("plan", "corre");
  formData.set("cycle", "YEARLY");
  formData.set("cpfCnpj", "12345678909");
  await subscribe(formData);

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.amount).toBe("294.00");
  expect(body.intervalMonths).toBe(12);
});

it("manda o CPF sem máscara", async () => {
  await userWithWorkspace("u-doc", "doc@example.com");
  const fetchMock = stubInterPixFetch();

  const formData = new FormData();
  formData.set("plan", "corre");
  formData.set("cycle", "MONTHLY");
  formData.set("cpfCnpj", "123.456.789-09");
  await subscribe(formData);

  expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).debtor.taxId).toBe("12345678909");
});

it("recusa assinatura atribuída manualmente, sem chamar a InterPix", async () => {
  const { user } = await userWithWorkspace("u-manual", "manual@example.com");
  await testDb.subscription.create({
    data: { userId: user.id, plan: "escala", provider: "MANUAL", status: "ACTIVE" },
  });
  const fetchMock = stubInterPixFetch();

  const formData = new FormData();
  formData.set("plan", "corre");
  formData.set("cycle", "MONTHLY");
  formData.set("cpfCnpj", "12345678909");

  const result = await subscribe(formData);
  expect(result.ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("resumeCheckout devolve o copia-e-cola guardado, sem criar outra assinatura", async () => {
  const { user } = await userWithWorkspace("u-resume", "resume@example.com");
  await testDb.subscription.create({
    data: {
      userId: user.id,
      plan: "corre",
      provider: "INTERPIX",
      status: "PENDING_AUTH",
      interpixSubscriptionId: "ipx-existente",
      interpixPixCopyPaste: "00020126-guardado",
      currentPeriodEnd: new Date("2026-09-20"),
    },
  });
  const fetchMock = stubInterPixFetch();

  const result = await resumeCheckout();
  expect(result.ok).toBe(true);
  expect(result.data?.pixCopyPaste).toBe("00020126-guardado");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("erro de configuração não vaza para o cliente e é logado", async () => {
  await userWithWorkspace("u-infra", "infra@example.com");
  vi.stubEnv("INTERPIX_API_TOKEN", "");
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const formData = new FormData();
  formData.set("plan", "corre");
  formData.set("cycle", "MONTHLY");
  formData.set("cpfCnpj", "12345678909");

  const result = await subscribe(formData);
  expect(result.ok).toBe(false);
  expect(result.error).not.toContain("INTERPIX_API_TOKEN");
  expect(errorSpy).toHaveBeenCalled();
  errorSpy.mockRestore();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/actions/subscription.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reescrever a action**

Substituir o conteúdo de `src/server/actions/subscription.ts` por:

```ts
"use server";

import { revalidatePath } from "next/cache";
import {
  chargeAmountCents,
  isKnownCycle,
  isKnownPlan,
  planLabel,
  type PlanCycle,
} from "@/lib/plans";
import { getWorkspaceContext } from "@/server/tenant/context";
import {
  getBillingUser,
  getSubscription,
  recordInterPixSubscription,
} from "@/server/tenant/subscription";
import {
  createInterPixSubscription,
  InterPixApiError,
} from "@/server/tenant/interpix";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

export type CheckoutResult = { pixCopyPaste: string; nextDueDate: string };

const CHARGE_LEAD_DAYS = 3;

const GENERIC_ERROR =
  "Não foi possível concluir a contratação agora. Tente novamente em instantes.";

const MANUAL_ERROR =
  "Sua assinatura foi combinada manualmente com a nossa equipe e não pode ser alterada por aqui. Fale com a gente para mudar de plano.";

function firstDueDate(trialEndsAt: Date | null, now: Date = new Date()): string {
  const minimo = new Date(now);
  minimo.setDate(minimo.getDate() + CHARGE_LEAD_DAYS);
  const escolhida = trialEndsAt && trialEndsAt > minimo ? trialEndsAt : minimo;
  return escolhida.toISOString().slice(0, 10);
}

export async function subscribe(
  formData: FormData,
): Promise<ActionResult<CheckoutResult>> {
  const plan = String(formData.get("plan") ?? "");
  const rawCycle = String(formData.get("cycle") ?? "MONTHLY");
  const taxId = String(formData.get("cpfCnpj") ?? "").replace(/\D/g, "");

  if (!isKnownPlan(plan)) return { ok: false, error: "Plano inválido." };
  if (!isKnownCycle(rawCycle)) return { ok: false, error: "Ciclo de cobrança inválido." };
  const cycle: PlanCycle = rawCycle;

  const amountCents = chargeAmountCents(plan, cycle, "PIX");
  if (amountCents === null) {
    return { ok: false, error: "Este plano é contratado por atendimento." };
  }
  if (taxId.length !== 11 && taxId.length !== 14) {
    return { ok: false, error: "Informe um CPF ou CNPJ válido." };
  }

  try {
    const { userId } = await getWorkspaceContext();
    const existing = await getSubscription(userId);

    if (existing?.provider === "MANUAL") {
      return { ok: false, error: MANUAL_ERROR };
    }

    if (
      existing?.interpixSubscriptionId &&
      existing.plan === plan &&
      existing.cycle === cycle
    ) {
      return {
        ok: false,
        error: `Você já tem uma assinatura ${planLabel(plan)} em andamento.`,
      };
    }

    const user = await getBillingUser(userId);
    if (!user) return { ok: false, error: "Usuário não encontrado." };

    const remote = await createInterPixSubscription({
      externalUserId: userId,
      planCode: plan,
      amountCents,
      intervalMonths: cycle === "YEARLY" ? 12 : 1,
      firstDueDate: firstDueDate(existing?.trialEndsAt ?? null),
      debtor: { taxId, name: user.name },
    });

    const pixCopyPaste = remote.authorization?.pixCopyPaste ?? null;

    await recordInterPixSubscription({
      userId,
      plan,
      cycle,
      interpixSubscriptionId: remote.id,
      pixCopyPaste,
      nextDueDate: new Date(`${remote.nextDueDate}T00:00:00.000Z`),
    });

    revalidatePath("/", "layout");

    if (!pixCopyPaste) {
      return { ok: false, error: GENERIC_ERROR };
    }

    return { ok: true, data: { pixCopyPaste, nextDueDate: remote.nextDueDate } };
  } catch (e) {
    if (e instanceof InterPixApiError && e.code === "BAD_REQUEST") {
      return { ok: false, error: e.message };
    }
    console.error("subscribe: falha ao contratar", e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function resumeCheckout(): Promise<ActionResult<CheckoutResult>> {
  try {
    const { userId } = await getWorkspaceContext();
    const existing = await getSubscription(userId);

    if (!existing?.interpixSubscriptionId || !existing.interpixPixCopyPaste) {
      return { ok: false, error: "Nenhuma autorização pendente." };
    }

    return {
      ok: true,
      data: {
        pixCopyPaste: existing.interpixPixCopyPaste,
        nextDueDate: existing.currentPeriodEnd
          ? existing.currentPeriodEnd.toISOString().slice(0, 10)
          : "",
      },
    };
  } catch (e) {
    console.error("resumeCheckout: falha ao recuperar autorização", e);
    return { ok: false, error: GENERIC_ERROR };
  }
}
```

`firstDueDate` é `max(hoje + 3, trialEndsAt)`: respeita o trial de quem assina no meio dele e cobra o quanto antes for permitido para quem já expirou.

`resumeCheckout` lê do nosso banco e **não chama a InterPix** — o `GET /subscriptions/:id` não devolve o copia-e-cola, só a criação devolve. É por isso que ele é guardado em `interpixPixCopyPaste`.

- [ ] **Step 4: Rodar, verificar, commitar**

```bash
npx vitest run src/server/actions/subscription.test.ts
npm test && npx tsc --noEmit && npm run lint && npm run build
git add src/server/actions/subscription.ts src/server/actions/subscription.test.ts
git commit -m "feat: contratacao via InterPix com Pix copia-e-cola"
```

---

### Task 9: Interface do checkout

**Files:**
- Modify: `src/components/workspaces/plan-panel.tsx`, `src/app/(app)/workspaces/plan/page.tsx`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `subscribe`, `resumeCheckout` (Task 8), `monthlyPriceCents`, `planLabel`, `planWorkspacesLabel` (Task 1).

- [ ] **Step 1: Adicionar a biblioteca de QR**

```bash
npm install qrcode && npm install -D @types/qrcode
pnpm install --lockfile-only
```

O `pnpm install --lockfile-only` **não é opcional**: o deploy instala com `frozen-lockfile` e já quebrou duas vezes nesta base por lockfile fora de sincronia. Confirme com `pnpm install --frozen-lockfile --lockfile-only`.

- [ ] **Step 2: Três estados na tela**

O painel passa a ter, além da grade de planos:

**Estado "autorizar"** — quando `status === "PENDING_AUTH"` e existe `pixCopyPaste`. Renderiza o QR gerado com `QRCode.toDataURL(pixCopyPaste)`, o texto copiável com botão de copiar, e diz em português claro que a pessoa está **autorizando um débito recorrente**, não pagando agora.

**Estado "aguardando"** — texto honesto com a data de `nextDueDate`: o plano ativa quando a primeira cobrança for debitada, e isso leva dias. **Não é spinner.**

**Estado normal** — a grade, com preço vindo de `monthlyPriceCents(plan, cycle, "PIX")` e o rótulo de workspaces de `planWorkspacesLabel`.

O estado de autorização é derivado do `status` da assinatura vindo do servidor, **não** de estado local do diálogo — precisa sobreviver a fechar a aba e voltar dias depois.

- [ ] **Step 3: Passar os dados novos na página**

`src/app/(app)/workspaces/plan/page.tsx` passa `status`, `pixCopyPaste` (de `interpixPixCopyPaste`) e `nextDueDate` (de `currentPeriodEnd`) ao painel, e troca `source` por `provider`.

- [ ] **Step 4: Verificar no navegador**

```bash
npm run dev
```

Confirme visualmente: QR renderiza, botão de copiar funciona, e o estado "aguardando" aparece com a data. Tire um screenshot do estado de autorização.

- [ ] **Step 5: Verificar e commitar**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
git add src/components/workspaces/plan-panel.tsx "src/app/(app)/workspaces/plan/page.tsx" package.json package-lock.json pnpm-lock.yaml
git commit -m "feat: checkout com QR do Pix na propria tela"
```

---

### Task 10: Conciliação

**Files:**
- Modify: `scripts/reconcile-subscriptions.ts`
- Test: `scripts/reconcile-status.test.ts`

**Interfaces:**
- Consumes: `getInterPixSubscription` (Task 3).

- [ ] **Step 1: Escrever o teste da decisão**

O módulo puro de decisão passa a comparar status local com status remoto:

```ts
import { describe, expect, it } from "vitest";
import { decideReconcile } from "./reconcile-status";

describe("conciliação InterPix", () => {
  it("promove quando o remoto diz ACTIVE e o local não sabe", () => {
    expect(decideReconcile({ local: "PENDING_AUTH", remote: "ACTIVE" }).action).toBe("apply");
  });

  it("aplica suspensão perdida", () => {
    expect(decideReconcile({ local: "PAST_DUE", remote: "SUSPENDED" }).action).toBe("apply");
  });

  it("não rebaixa por status remoto desconhecido — só relata", () => {
    expect(decideReconcile({ local: "ACTIVE", remote: "COISA_NOVA" }).action).toBe("report");
  });

  it("estados iguais não fazem nada", () => {
    expect(decideReconcile({ local: "ACTIVE", remote: "ACTIVE" }).action).toBe("none");
  });
});
```

- [ ] **Step 2: Reescrever `scripts/reconcile-status.ts`**

```ts
export type ReconcileDecision =
  | { action: "apply"; status: string; reason: string }
  | { action: "report"; reason: string }
  | { action: "none"; reason: string };

const REMOTE_STATUSES = new Set([
  "PENDING_AUTH",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELED",
  "AUTH_DENIED",
]);

export function decideReconcile(input: {
  local: string;
  remote: string;
}): ReconcileDecision {
  if (!REMOTE_STATUSES.has(input.remote)) {
    return { action: "report", reason: `status remoto desconhecido: ${input.remote}` };
  }

  if (input.local === input.remote) {
    return { action: "none", reason: "estados iguais" };
  }

  return {
    action: "apply",
    status: input.remote,
    reason: `local ${input.local}, remoto ${input.remote}`,
  };
}
```

Status remoto desconhecido **nunca** muda estado — só relata. É a mesma regra que já foi aprendida nesta base: uma rotina que roda todo dia sem ninguém olhando não deve ter poder de travar cliente por um valor que ninguém reconheceu.

- [ ] **Step 3: Ajustar o script principal**

`scripts/reconcile-subscriptions.ts` passa a:

```ts
const subs = await db.subscription.findMany({
  where: {
    provider: "INTERPIX",
    interpixSubscriptionId: { not: null },
    status: { in: ["PENDING_AUTH", "ACTIVE", "PAST_DUE", "SUSPENDED"] },
  },
});
```

Para cada uma, consultar `getInterPixSubscription(sub.interpixSubscriptionId)`, aplicar `decideReconcile({ local: sub.status, remote: remoto.status })`, e no caso `apply` atualizar o status local. `MANUAL` fica fora pelo filtro.

O resumo final imprime `verificadas`, `corrigidas`, `divergentes` e `falhas` — sem obrigar quem lê a contar linhas de erro à mão numa saída de cron.

- [ ] **Step 3: Verificar e commitar**

```bash
npm test && npx tsc --noEmit && npm run lint
git add scripts/
git commit -m "feat: conciliacao contra a InterPix"
```

---

### Task 11: Remoção do Asaas

**Files:**
- Delete: `src/server/tenant/asaas.ts`, `asaas-events.ts`, `asaas.test.ts`, `asaas-events.test.ts`, `src/app/api/webhooks/asaas/`
- Create: `prisma/migrations/<timestamp>_drop_asaas/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Confirmar que ninguém mais importa Asaas**

```bash
grep -rn "asaas\|Asaas\|ASAAS" src/ scripts/ prisma/schema.prisma --include="*.ts" --include="*.tsx" --include="*.prisma"
```
Expected: nenhuma ocorrência fora dos arquivos a deletar. Se houver, corrija antes.

- [ ] **Step 2: Apagar os arquivos**

```bash
rm -rf src/server/tenant/asaas.ts src/server/tenant/asaas-events.ts \
       src/server/tenant/asaas.test.ts src/server/tenant/asaas-events.test.ts \
       src/app/api/webhooks/asaas
```

- [ ] **Step 3: Migração subtrativa**

Remover do schema: `source`, o enum `SubscriptionSource`, `asaasCustomerId`, `asaasSubscriptionId`. Gerar:

```bash
npx prisma migrate dev --name drop_asaas --create-only 2>/dev/null
```

Confirme que o arquivo começa com `--`, aplique e regenere.

- [ ] **Step 4: Verificar e commitar**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
git add -A
git commit -m "chore: remove a integracao com o Asaas"
```

---

## Verificação final

Depois da Task 11:

- [ ] `npm test` — toda a suíte verde
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` — limpos
- [ ] Entrega assinada de ponta a ponta, no padrão da seção 10 do contrato, contra o servidor local, cobrindo: assinatura inválida (401), timestamp velho (401), `eventId` repetido (ignorado), `eventId` menor (ignorado) e `cycle.paid` de assinatura desconhecida
- [ ] Verificar contra a InterPix real o que `GET /subscriptions/:id` reporta logo após um `subscription.authorized` — é a ambiguidade da seção 3 da spec, e a resposta decide se algum dia dá para espelhar o status remoto
