# Confirmação de assinatura em tempo real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela de checkout e a de plano reagem em ~1 s à autorização Pix ou à ativação no cartão, mostram uma animação de confirmação e voltam sozinhas ao painel.

**Architecture:** O `pix-inter-api` entrega o evento ao app logo depois de processar o webhook do Inter (sem esperar o job do minuto). No app, quem grava mudança de assinatura publica num emissor em memória (`globalThis`); uma rota SSE inscrita nesse emissor manda o estado atual da assinatura para a tela; um hook no cliente deriva `waiting | confirmed | failed` e a tela mostra a animação e redireciona.

**Tech Stack:** Next.js 15 (App Router, `next start`), Prisma, Vitest (ambiente node, banco de teste real), Stripe.js; `pix-inter-api` em Express + pg + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-confirmacao-em-tempo-real-design.md`

## Global Constraints

- Nunca adicionar comentários no código (regra do usuário).
- Usar `pnpm` no app (`coolkies-system`); no `InterPix-API` usar `npx`/`npm` do próprio projeto.
- Testes do app: `pnpm exec dotenv -e .env.test -- vitest run <arquivo>`; o contêiner `cookies_db` precisa estar de pé.
- Testes do `InterPix-API`: `npx vitest run <arquivo>`; o contêiner `interpix-test-pg` precisa estar de pé (`docker start interpix-test-pg`).
- Commits do app em português com acentos, no padrão `tipo(escopo): descrição`; commits do `InterPix-API` em português sem acentos, `tipo: descrição`. Todos terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sem dependências novas.
- Evento SSE: nome `state`, `data` = JSON `{ status, provider, authorized, plan, cycle, nextDueDate }` ou `null`.
- Keep-alive a cada 25 s; a conexão SSE fecha sozinha em 10 minutos.
- Redirecionamento para `/dashboard` 3 s depois da animação; cartão sem confirmação mostra texto de demora aos 20 s.

## Review Focus

- **Webhook do Inter chegando com o lock de entregas ocupado pelo job**: a entrega não pode duplicar nem se perder — fica para o job. Coberto no Task 1.
- **Testes do `InterPix-API` disparando entrega real**: com a entrega imediata, todo POST de webhook em teste chama `axios.post` para a URL do `.env.test`; os arquivos de teste que fazem POST em `/webhooks` precisam de `axios.post` mockado. Coberto no Task 1.
- **`userId` igual a um nome especial do `EventEmitter` (`error`)**: emitir `error` sem ouvinte derruba o processo; o emissor usa nome prefixado. Coberto no Task 2.
- **Mudança publicada para outro usuário**: a tela de um não pode reagir à assinatura de outro. Coberto no Task 2.
- **Tela aberta quando a confirmação já tinha acontecido** (reconexão depois de reinício): o primeiro `state` já vem autorizado e a tela confirma. Coberto no Task 4 (função pura) e no Task 5 (estado inicial).

---

### Task 1: `pix-inter-api` entrega ao app na hora

**Repo:** `/Users/ferrari/code/InterPix-API`

**Files:**
- Modify: `src/jobs/lock.ts`
- Modify: `src/jobs/scheduler.ts`
- Modify: `src/domain/webhookDispatcher.ts`
- Modify: `src/http/routes/interWebhook.ts`
- Test: `src/http/routes/interWebhook.test.ts`
- Test: `src/http/middlewares/accessLog.test.ts`

**Interfaces:**
- Produces: `LOCK_KEYS` exportado de `src/jobs/lock.ts`; `deliverNow(): Promise<void>` exportado de `src/domain/webhookDispatcher.ts` (nunca rejeita).

- [ ] **Step 1: Mockar `axios.post` nos testes que fazem POST em `/webhooks`**

Em `src/http/routes/interWebhook.test.ts`, adicionar `import axios from 'axios';` e, logo depois do `afterEach` existente no topo:

```ts
beforeEach(() => {
  vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { outcome: 'applied' } } as never);
});
```

(incluir `beforeEach` no import de `vitest`). Fazer o mesmo em `src/http/middlewares/accessLog.test.ts`.

- [ ] **Step 2: Escrever os testes que falham**

Ao fim de `src/http/routes/interWebhook.test.ts`:

```ts
describe('entrega imediata ao saas', () => {
  beforeEach(async () => {
    await query('DELETE FROM webhook_deliveries');
  });

  it('entrega subscription.authorized ao saas logo depois do webhook, sem esperar o job', async () => {
    const subscription = await createFixture();
    const recId = `RR${randomUUID().replace(/-/g, '')}`;
    await updateSubscriptionStatus(subscription.id, 'PENDING_AUTH', { interRecId: recId });
    vi.spyOn(inter, 'getRecurrence').mockResolvedValue({ recId, status: 'APPROVED', rawStatus: 'APROVADA' });
    const post = vi.mocked(axios.post);

    await request(app).post('/webhooks/inter').send({ recs: [{ idRec: recId, status: 'APROVADA' }] });

    await vi.waitFor(() => {
      const bodies = post.mock.calls.map((call) => String(call[1]));
      expect(bodies.some((body) => body.includes('subscription.authorized'))).toBe(true);
    }, WAIT_FOR_OPTS);
  });

  it('com o lock de entregas ocupado, deixa a entrega para o job sem duplicar', async () => {
    const subscription = await createFixture();
    const recId = `RR${randomUUID().replace(/-/g, '')}`;
    await updateSubscriptionStatus(subscription.id, 'PENDING_AUTH', { interRecId: recId });
    vi.spyOn(inter, 'getRecurrence').mockResolvedValue({ recId, status: 'APPROVED', rawStatus: 'APROVADA' });
    const post = vi.mocked(axios.post);
    const holder = await pool.connect();
    await holder.query('SELECT pg_advisory_lock($1)', [LOCK_KEYS.deliveries]);

    try {
      await request(app).post('/webhooks/inter').send({ recs: [{ idRec: recId, status: 'APROVADA' }] });
      await vi.waitFor(async () => {
        expect((await findSubscriptionById(subscription.id))?.status).toBe('ACTIVE');
      }, WAIT_FOR_OPTS);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(post).not.toHaveBeenCalled();
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [LOCK_KEYS.deliveries]);
      holder.release();
    }

    await deliverPending();
    const authorizedCalls = post.mock.calls.filter((call) => String(call[1]).includes('subscription.authorized'));
    expect(authorizedCalls).toHaveLength(1);
  });
});
```

Imports a adicionar no topo do arquivo: `import { pool, query } from '../../shared/db';` (junto do `closePool` já importado), `import { LOCK_KEYS } from '../../jobs/lock';`, `import { deliverPending } from '../../domain/webhookDispatcher';`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/http/routes/interWebhook.test.ts`
Expected: FAIL — `LOCK_KEYS` não exportado de `../../jobs/lock`.

- [ ] **Step 4: Exportar `LOCK_KEYS` de `src/jobs/lock.ts`**

Adicionar no topo de `src/jobs/lock.ts`:

```ts
export const LOCK_KEYS = {
  daily: 1001,
  reconcile: 1002,
  deliveries: 1003,
  webhooks: 1004,
} as const;
```

Em `src/jobs/scheduler.ts`, remover o `const LOCK_KEYS = {...}` local e trocar `import { withAdvisoryLock } from './lock';` por `import { LOCK_KEYS, withAdvisoryLock } from './lock';`.

- [ ] **Step 5: Criar `deliverNow` em `src/domain/webhookDispatcher.ts`**

Adicionar o import `import { LOCK_KEYS, withAdvisoryLock } from '../jobs/lock';` e, ao fim do arquivo:

```ts
export async function deliverNow(): Promise<void> {
  try {
    await withAdvisoryLock(LOCK_KEYS.deliveries, () => deliverPending());
  } catch (error) {
    logger.error('falha na entrega imediata de webhooks', {
      message: (error as Error).message,
    });
  }
}
```

- [ ] **Step 6: Disparar `deliverNow` depois de cada notificação processada**

Em `src/http/routes/interWebhook.ts`, importar `deliverNow` de `'../../domain/webhookDispatcher'` e trocar o laço:

```ts
    for (const notification of notifications) {
      processInterEvent(notification, req.log)
        .then(() => deliverNow())
        .catch((error) => {
          req.log.error('falha ao processar webhook do inter', {
            idRec: notification.idRec ?? null,
            txid: notification.txid ?? null,
            message: (error as Error).message,
          });
        });
    }
```

- [ ] **Step 7: Disparar `deliverNow` ao fim da reconciliação horária**

Em `src/jobs/scheduler.ts`, importar `deliverNow` de `'../domain/webhookDispatcher'` (junto de `deliverPending`) e trocar o cron das `0 * * * *`:

```ts
  cron.schedule('0 * * * *', () => {
    withAdvisoryLock(LOCK_KEYS.reconcile, reconcile)
      .then(() => deliverNow())
      .catch((error) =>
        logger.error('falha na reconciliacao', { message: (error as Error).message }),
      );
  });
```

- [ ] **Step 8: Rodar a suíte e o typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: todos os testes passam (243+), `tsc` sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/jobs/lock.ts src/jobs/scheduler.ts src/domain/webhookDispatcher.ts src/http/routes/interWebhook.ts src/http/routes/interWebhook.test.ts src/http/middlewares/accessLog.test.ts
git commit -m "feat: entrega o evento ao saas logo depois do webhook do inter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Emissor de mudanças de assinatura no app

**Repo:** `/Users/ferrari/code/coolkies-system`

**Files:**
- Create: `src/server/realtime/subscription-events.ts`
- Test: `src/server/realtime/subscription-events.test.ts`

**Interfaces:**
- Produces: `publishSubscriptionChange(userId: string): void` e `subscribeToSubscriptionChanges(userId: string, listener: () => void): () => void` (devolve a função que cancela a inscrição).

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  publishSubscriptionChange,
  subscribeToSubscriptionChanges,
} from "./subscription-events";

describe("emissor de mudanças de assinatura", () => {
  it("avisa quem se inscreveu no próprio usuário", () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-a", listener);

    publishSubscriptionChange("u-a");

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("não avisa quem se inscreveu em outro usuário", () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-b", listener);

    publishSubscriptionChange("u-c");

    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it("para de avisar depois de cancelar a inscrição", () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-d", listener);
    stop();

    publishSubscriptionChange("u-d");

    expect(listener).not.toHaveBeenCalled();
  });

  it("publicar para o usuário 'error' sem ouvinte não lança", () => {
    expect(() => publishSubscriptionChange("error")).not.toThrow();
  });

  it("a mesma instância atende módulos carregados de novo", async () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-e", listener);
    vi.resetModules();
    const reloaded = await import("./subscription-events");

    reloaded.publishSubscriptionChange("u-e");

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/server/realtime/subscription-events.test.ts`
Expected: FAIL — módulo `./subscription-events` não existe.

- [ ] **Step 3: Implementar**

```ts
import { EventEmitter } from "node:events";

const globalForEvents = globalThis as typeof globalThis & {
  subscriptionEvents?: EventEmitter;
};

function emitter(): EventEmitter {
  if (!globalForEvents.subscriptionEvents) {
    const created = new EventEmitter();
    created.setMaxListeners(0);
    globalForEvents.subscriptionEvents = created;
  }
  return globalForEvents.subscriptionEvents;
}

function channel(userId: string): string {
  return `subscription:${userId}`;
}

export function publishSubscriptionChange(userId: string): void {
  emitter().emit(channel(userId));
}

export function subscribeToSubscriptionChanges(
  userId: string,
  listener: () => void,
): () => void {
  emitter().on(channel(userId), listener);
  return () => {
    emitter().off(channel(userId), listener);
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/server/realtime/subscription-events.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/server/realtime/subscription-events.ts src/server/realtime/subscription-events.test.ts
git commit -m "feat(assinatura): emissor em memória de mudanças de assinatura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Publicar quando a assinatura muda

**Files:**
- Modify: `src/server/tenant/interpix-events.ts` (função `applyInterPixEvent`, bloco `try { return await db.$transaction(...)`)
- Modify: `src/server/tenant/stripe-events.ts` (fim de `applyStripeEvent`)
- Modify: `src/server/tenant/reconcile.ts` (depois de `summary.corrected += 1;`)
- Test: `src/server/tenant/interpix-events.test.ts`, `src/server/tenant/stripe-events.test.ts`, `src/server/tenant/reconcile.test.ts`

**Interfaces:**
- Consumes: `publishSubscriptionChange`, `subscribeToSubscriptionChanges` (Task 2).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/server/tenant/interpix-events.test.ts`, importar `subscribeToSubscriptionChanges` de `@/server/realtime/subscription-events` e adicionar dentro do `describe("eventos da InterPix")`:

```ts
  it("publica a mudança quando aplica o evento, e não publica de novo no duplicado", async () => {
    const user = await subscriber("u-publish");
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges(user.id, listener);
    const event = {
      type: "subscription.authorized" as const,
      eventId: "700",
      data: { subscriptionId: "ipx-u-publish", externalUserId: user.id },
    };

    await applyInterPixEvent(event);
    await applyInterPixEvent(event);

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
```

(incluir `vi` no import de `vitest`).

Em `src/server/tenant/stripe-events.test.ts`, importar `subscribeToSubscriptionChanges` e adicionar um `describe`:

```ts
describe("publicação de mudanças", () => {
  beforeEach(async () => {
    await resetDb();
    retrieveMock.mockReset();
  });

  it("publica quando aplica o evento da Stripe", async () => {
    const user = await subscriber("u-stripe-publish");
    retrieveMock.mockResolvedValue(fakeStripeSub());
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges(user.id, listener);

    const outcome = await applyStripeEvent(subEvent("customer.subscription.updated", "evt_publish_1"));

    expect(outcome).toBe("applied");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
```

Em `src/server/tenant/reconcile.test.ts`, importar `subscribeToSubscriptionChanges` (com `await import` depois do `vi.mock`, como o `reconcileInterPixSubscriptions`) e adicionar:

```ts
  it("publica a mudança de cada assinatura corrigida", async () => {
    await seed("u-rec-pub", "ip-rec-pub", "ACTIVE");
    remote.byId["ip-rec-pub"] = "CANCELED";
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-rec-pub", listener);

    await reconcileInterPixSubscriptions(undefined, () => {});

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/server/tenant/interpix-events.test.ts src/server/tenant/stripe-events.test.ts src/server/tenant/reconcile.test.ts`
Expected: FAIL nos três testes novos (`listener` chamado 0 vezes).

- [ ] **Step 3: Publicar em `applyInterPixEvent`**

Importar `publishSubscriptionChange` de `@/server/realtime/subscription-events` e trocar `return await db.$transaction(async (tx) => {` por `const outcome = await db.$transaction(async (tx) => {`, fechando o bloco assim (o corpo da transação não muda):

```ts
    });
    if (outcome === "applied") publishSubscriptionChange(sub.userId);
    return outcome;
  } catch (error) {
```

- [ ] **Step 4: Publicar em `applyStripeEvent`**

Importar `publishSubscriptionChange` e trocar o fim da função:

```ts
  await recordProcessed(event.id, event.type);
  publishSubscriptionChange(local.userId);
  return "applied";
```

- [ ] **Step 5: Publicar na reconciliação**

Importar `publishSubscriptionChange` em `src/server/tenant/reconcile.ts` e, logo depois de `summary.corrected += 1;`:

```ts
        publishSubscriptionChange(sub.userId);
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/server/tenant`
Expected: PASS em todos.

- [ ] **Step 7: Commit**

```bash
git add src/server/tenant/interpix-events.ts src/server/tenant/stripe-events.ts src/server/tenant/reconcile.ts src/server/tenant/interpix-events.test.ts src/server/tenant/stripe-events.test.ts src/server/tenant/reconcile.test.ts
git commit -m "feat(assinatura): publica a mudança ao aplicar eventos do Pix, da Stripe e da reconciliação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Estado da assinatura e resultado da confirmação

**Files:**
- Create: `src/lib/subscription-confirmation.ts`
- Create: `src/server/realtime/subscription-state.ts`
- Test: `src/lib/subscription-confirmation.test.ts`
- Test: `src/server/realtime/subscription-state.test.ts`

**Interfaces:**
- Produces:
  - `type SubscriptionState = { status: string; provider: string; authorized: boolean; plan: string; cycle: string; nextDueDate: string | null }`
  - `type ConfirmationOutcome = "waiting" | "confirmed" | "failed"`
  - `confirmationOutcome(state: SubscriptionState | null): ConfirmationOutcome`
  - `getSubscriptionState(userId: string): Promise<SubscriptionState | null>`

- [ ] **Step 1: Escrever os testes que falham**

`src/lib/subscription-confirmation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { confirmationOutcome, type SubscriptionState } from "./subscription-confirmation";

function state(over: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: "PENDING_AUTH",
    provider: "INTERPIX",
    authorized: false,
    plan: "corre",
    cycle: "MONTHLY",
    nextDueDate: "2026-10-20",
    ...over,
  };
}

describe("confirmationOutcome", () => {
  it("sem assinatura aguarda", () => {
    expect(confirmationOutcome(null)).toBe("waiting");
  });

  it("Pix sem autorização aguarda", () => {
    expect(confirmationOutcome(state())).toBe("waiting");
  });

  it("Pix autorizado confirma, mesmo ainda em PENDING_AUTH", () => {
    expect(confirmationOutcome(state({ authorized: true }))).toBe("confirmed");
  });

  it("Pix já autorizado quando a tela conecta também confirma", () => {
    expect(confirmationOutcome(state({ status: "ACTIVE", authorized: true }))).toBe("confirmed");
  });

  it("cartão aguarda até o webhook ativar", () => {
    expect(confirmationOutcome(state({ provider: "STRIPE" }))).toBe("waiting");
  });

  it("cartão ativo confirma", () => {
    expect(confirmationOutcome(state({ provider: "STRIPE", status: "ACTIVE" }))).toBe("confirmed");
  });

  it("autorização negada falha", () => {
    expect(confirmationOutcome(state({ status: "AUTH_DENIED" }))).toBe("failed");
  });
});
```

`src/server/realtime/subscription-state.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { getSubscriptionState } from "./subscription-state";

describe("getSubscriptionState", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("devolve null para quem não tem assinatura", async () => {
    expect(await getSubscriptionState("ninguem")).toBeNull();
  });

  it("resume status, método, autorização, plano, ciclo e vencimento", async () => {
    const user = await testDb.user.create({
      data: { id: "u-state", name: "Dono", email: "state@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "cresce",
        cycle: "YEARLY",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        authorizedAt: new Date("2026-10-11T12:00:00Z"),
        currentPeriodEnd: new Date("2026-10-20T00:00:00Z"),
      },
    });

    expect(await getSubscriptionState(user.id)).toEqual({
      status: "PENDING_AUTH",
      provider: "INTERPIX",
      authorized: true,
      plan: "cresce",
      cycle: "YEARLY",
      nextDueDate: "2026-10-20",
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/lib/subscription-confirmation.test.ts src/server/realtime/subscription-state.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar `src/lib/subscription-confirmation.ts`**

```ts
export type SubscriptionState = {
  status: string;
  provider: string;
  authorized: boolean;
  plan: string;
  cycle: string;
  nextDueDate: string | null;
};

export type ConfirmationOutcome = "waiting" | "confirmed" | "failed";

export function confirmationOutcome(state: SubscriptionState | null): ConfirmationOutcome {
  if (!state) return "waiting";
  if (state.status === "AUTH_DENIED") return "failed";
  if (state.provider === "INTERPIX" && state.authorized) return "confirmed";
  if (state.provider === "STRIPE" && state.status === "ACTIVE") return "confirmed";
  return "waiting";
}
```

- [ ] **Step 4: Implementar `src/server/realtime/subscription-state.ts`**

```ts
import { db } from "@/lib/db";
import type { SubscriptionState } from "@/lib/subscription-confirmation";

export async function getSubscriptionState(userId: string): Promise<SubscriptionState | null> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  if (!sub) return null;
  return {
    status: sub.status,
    provider: sub.provider,
    authorized: sub.authorizedAt !== null,
    plan: sub.plan,
    cycle: sub.cycle,
    nextDueDate: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString().slice(0, 10) : null,
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/lib/subscription-confirmation.test.ts src/server/realtime/subscription-state.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/subscription-confirmation.ts src/lib/subscription-confirmation.test.ts src/server/realtime/subscription-state.ts src/server/realtime/subscription-state.test.ts
git commit -m "feat(assinatura): estado resumido da assinatura e regra de confirmação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rota SSE `GET /api/subscription/events`

**Files:**
- Create: `src/app/api/subscription/events/route.ts`
- Test: `src/app/api/subscription/events/route.test.ts`

**Interfaces:**
- Consumes: `subscribeToSubscriptionChanges`, `publishSubscriptionChange` (Task 2), `getSubscriptionState` (Task 4).
- Produces: endpoint SSE com eventos `state`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { GET } = await import("./route");
const { publishSubscriptionChange } = await import("@/server/realtime/subscription-events");

async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

describe("GET /api/subscription/events", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sem sessão devolve 401", async () => {
    sessionResult = null;

    const response = await GET(new Request("http://localhost/api/subscription/events"));

    expect(response.status).toBe(401);
  });

  it("manda o estado atual ao conectar e um novo estado a cada mudança publicada", async () => {
    const user = await testDb.user.create({
      data: { id: "u-sse", name: "Dono", email: "sse@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "corre", provider: "INTERPIX", status: "PENDING_AUTH" },
    });
    sessionResult = { user: { id: user.id }, session: { id: "s-sse" } };
    const controller = new AbortController();

    const response = await GET(
      new Request("http://localhost/api/subscription/events", { signal: controller.signal }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = await nextChunk(reader);
    expect(first).toContain("event: state");
    expect(first).toContain('"authorized":false');

    await testDb.subscription.update({
      where: { userId: user.id },
      data: { authorizedAt: new Date() },
    });
    publishSubscriptionChange(user.id);

    const second = await nextChunk(reader);
    expect(second).toContain('"authorized":true');
    controller.abort();
    await reader.cancel();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/app/api/subscription/events/route.test.ts`
Expected: FAIL — `./route` não existe.

- [ ] **Step 3: Implementar a rota**

```ts
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { subscribeToSubscriptionChanges } from "@/server/realtime/subscription-events";
import { getSubscriptionState } from "@/server/realtime/subscription-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEP_ALIVE_MS = 25_000;
const MAX_LIFETIME_MS = 10 * 60_000;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const userId = session.user.id;
  const encoder = new TextEncoder();
  let stop: (closeStream: boolean) => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      function send(chunk: string) {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      }

      async function sendState() {
        const state = await getSubscriptionState(userId);
        send(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      }

      const unsubscribe = subscribeToSubscriptionChanges(userId, () => {
        sendState().catch(() => close(true));
      });
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), KEEP_ALIVE_MS);
      const lifetime = setTimeout(() => close(true), MAX_LIFETIME_MS);

      function close(closeStream: boolean) {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(keepAlive);
        clearTimeout(lifetime);
        if (closeStream) controller.close();
      }

      stop = close;
      request.signal.addEventListener("abort", () => close(false));
      await sendState();
    },
    cancel() {
      stop(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec dotenv -e .env.test -- vitest run src/app/api/subscription/events/route.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Conferir que o middleware deixa a rota passar com sessão**

Run: `grep -n "matcher" -A3 src/middleware.ts`
Expected: `/api/subscription/events` não está na lista de exclusões, então passa pelo middleware de sessão como as páginas — correto, a rota exige login. Nada a mudar.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/subscription/events/route.ts src/app/api/subscription/events/route.test.ts
git commit -m "feat(assinatura): rota SSE com o estado da assinatura em tempo real

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hook do cliente e animação de confirmação

**Files:**
- Create: `src/components/checkout/use-subscription-confirmation.ts`
- Create: `src/components/checkout/subscription-confirmed.tsx`

**Interfaces:**
- Consumes: `confirmationOutcome`, `SubscriptionState`, `ConfirmationOutcome` (Task 4); endpoint da Task 5.
- Produces:
  - `useSubscriptionConfirmation(enabled: boolean): { outcome: ConfirmationOutcome; state: SubscriptionState | null }`
  - `<SubscriptionConfirmed detail={string} />` — camada de tela cheia que redireciona para `/dashboard` em 3 s.

Sem testes unitários: o projeto testa em ambiente node, sem DOM. A regra de decisão já está testada na Task 4; aqui a verificação é typecheck e o teste manual da Task 7.

- [ ] **Step 1: Criar o hook**

```ts
"use client";

import { useEffect, useState } from "react";
import {
  confirmationOutcome,
  type ConfirmationOutcome,
  type SubscriptionState,
} from "@/lib/subscription-confirmation";

export function useSubscriptionConfirmation(enabled: boolean): {
  outcome: ConfirmationOutcome;
  state: SubscriptionState | null;
} {
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [outcome, setOutcome] = useState<ConfirmationOutcome>("waiting");

  useEffect(() => {
    if (!enabled || outcome !== "waiting") return;

    const source = new EventSource("/api/subscription/events");
    source.addEventListener("state", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as SubscriptionState | null;
      setState(next);
      const result = confirmationOutcome(next);
      if (result !== "waiting") {
        setOutcome(result);
        source.close();
      }
    });

    return () => source.close();
  }, [enabled, outcome]);

  return { outcome, state };
}
```

- [ ] **Step 2: Criar a camada de confirmação**

```tsx
"use client";

import { useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const REDIRECT_MS = 3000;

function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

export function SubscriptionConfirmed({ detail }: { detail: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.replace("/dashboard"), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-6 backdrop-blur-sm"
    >
      <div className="pwa-scene flex w-full max-w-sm flex-col items-center text-center">
        <svg viewBox="0 0 96 96" className="size-24" aria-hidden>
          <circle cx="48" cy="48" r="44" className="pwa-pop fill-primary" style={cssVars({ "--delay": "0s" })} />
          <path
            d="M30 49 L43 62 L67 36"
            pathLength={1}
            className="pwa-draw fill-none stroke-primary-foreground"
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={cssVars({ "--delay": "0.35s", "--dur": "0.5s" })}
          />
        </svg>
        <h2 className="mt-6 text-2xl font-semibold tracking-tight">Assinatura confirmada!</h2>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <div className="mt-8 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="pwa-progress h-full bg-primary" style={cssVars({ "--dur": "3s" })} />
        </div>
        <Button className="mt-6" onClick={() => router.replace("/dashboard")}>
          Ir para o painel
        </Button>
      </div>
    </div>
  );
}
```

O `prefers-reduced-motion` já é tratado em `globals.css` para `pwa-draw`, `pwa-pop`, `pwa-progress` e `pwa-scene` (estado final sem animação); o redirecionamento continua pelo `setTimeout`.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/checkout/use-subscription-confirmation.ts src/components/checkout/subscription-confirmed.tsx
git commit -m "feat(assinatura): hook de confirmação em tempo real e animação de assinatura confirmada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Ligar a confirmação no Pix e no cartão

**Files:**
- Modify: `src/components/checkout/pix-checkout-content.tsx` (componente `PixCheckoutContent`, usado no checkout depois de gerar o QR e na tela de plano no estado `authorize`)
- Modify: `src/components/checkout/card-checkout-content.tsx` (componente `CardForm`, função `completeSubscription` e o JSX do formulário)

**Interfaces:**
- Consumes: `useSubscriptionConfirmation`, `SubscriptionConfirmed` (Task 6); `formatDueDate` (já exportado de `pix-checkout-content.tsx`).

- [ ] **Step 1: Pix — ouvir enquanto o QR está na tela**

Em `PixCheckoutContent`, importar `useSubscriptionConfirmation` de `./use-subscription-confirmation` e `SubscriptionConfirmed` de `./subscription-confirmed`. No começo do corpo do componente:

```tsx
  const { outcome, state } = useSubscriptionConfirmation(true);
  const confirmedDueDate = state?.nextDueDate ?? nextDueDate;
```

No início do JSX retornado (dentro do elemento raiz, antes do conteúdo atual):

```tsx
      {outcome === "confirmed" && (
        <SubscriptionConfirmed
          detail={
            confirmedDueDate
              ? `Débito automático autorizado. A primeira cobrança entra em ${formatDueDate(confirmedDueDate)}.`
              : "Débito automático autorizado."
          }
        />
      )}
      {outcome === "failed" && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          O banco recusou a autorização do débito automático. Volte ao plano para gerar um novo QR.
        </p>
      )}
```

- [ ] **Step 2: Cartão — esperar o webhook em vez de declarar ativo**

Em `CardForm`, importar o hook e a camada, e adicionar os estados:

```tsx
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [slowConfirmation, setSlowConfirmation] = useState(false);
  const { outcome } = useSubscriptionConfirmation(awaitingConfirmation);

  useEffect(() => {
    if (!awaitingConfirmation) return;
    const timer = setTimeout(() => setSlowConfirmation(true), 20_000);
    return () => clearTimeout(timer);
  }, [awaitingConfirmation]);

  useEffect(() => {
    if (outcome === "failed") {
      toast.error("O pagamento não foi aprovado. Tente outro cartão.");
      setAwaitingConfirmation(false);
    }
  }, [outcome]);
```

Em `completeSubscription`, trocar o final:

```tsx
    toast.success("Cartão confirmado. Sua assinatura está ativa.");
    router.push("/workspaces/plan");
    router.refresh();
```

por:

```tsx
    setAwaitingConfirmation(true);
```

(remover `router`/`useRouter` de `CardForm` se ficarem sem uso.)

No JSX do `<form>`, logo depois de `{pendingCharge && <PendingChargeNotice charge={pendingCharge} />}`:

```tsx
      {outcome === "confirmed" && <SubscriptionConfirmed detail="Pagamento aprovado no cartão." />}
      {awaitingConfirmation && outcome === "waiting" && (
        <p role="status" className="rounded-lg border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
          {slowConfirmation
            ? "Ainda confirmando com a operadora. Você pode sair desta tela; avisaremos no painel quando terminar."
            : "Confirmando com a operadora…"}
        </p>
      )}
```

e trocar `disabled={!stripe || submitting}` do botão por `disabled={!stripe || submitting || awaitingConfirmation}`.

- [ ] **Step 3: Typecheck e suíte**

Run: `pnpm exec tsc --noEmit -p . && pnpm exec dotenv -e .env.test -- vitest run`
Expected: `tsc` sem erros; todos os testes passam.

- [ ] **Step 4: Verificação no navegador (dev)**

Subir o app com o preview (`cookies-dev`), entrar com uma conta de teste local, abrir `/workspaces/plan` com uma assinatura Pix em `PENDING_AUTH` sem `authorizedAt` e `interpixPixCopyPaste` preenchido (via SQL no banco `cookies` local). Em `read_network_requests`, conferir a requisição `GET /api/subscription/events` aberta. Gravar `authorizedAt = now()` no banco local e chamar `publishSubscriptionChange` não é possível de fora do processo; em vez disso, recarregar a página: com `authorizedAt` preenchido a tela não mostra mais o QR (estado `waiting`), o que confirma a leitura do estado. A confirmação ponta a ponta fica para a Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/pix-checkout-content.tsx src/components/checkout/card-checkout-content.tsx
git commit -m "feat(assinatura): confirmação em tempo real no checkout e na tela de plano

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Subir e validar em produção

- [ ] **Step 1: Subir os dois repositórios**

```bash
git -C /Users/ferrari/code/InterPix-API push origin main
git -C /Users/ferrari/code/coolkies-system push origin main
```

- [ ] **Step 2: Validar com o usuário**

Pedir ao usuário, depois do deploy dos dois no Coolify: gerar um QR Pix novo no checkout e autorizar no banco. Esperado:
- log do `pix-inter-api`: `webhook do inter recebido` → `autorizacao aplicada pelo webhook` → `webhook entregue ao saas` no mesmo segundo (sem esperar o minuto);
- na tela, sem recarregar: animação "Assinatura confirmada!" e ida para `/dashboard` 3 s depois.

Se a tela não reagir mas o log mostrar a entrega, conferir no navegador (aba Network) se `GET /api/subscription/events` ficou aberta com `content-type: text/event-stream`; se o Cloudflare estiver segurando a resposta, a conexão aparece sem eventos — nesse caso, desligar o buffering para `/api/subscription/*` no Cloudflare.
