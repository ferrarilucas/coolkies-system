# Checkout com cartão de crédito via Stripe

Data: 2026-09-10
Status: aprovado para implementação

## Objetivo

Habilitar pagamento por cartão de crédito no checkout, embutido na própria
aplicação (sem redirect), coexistindo com o Pix recorrente InterPix já
existente. A recorrência do cartão é responsabilidade da Stripe (Stripe
Subscriptions); a nossa `Subscription` passa a ser um espelho do estado da
Stripe para esse provedor.

## Decisões

1. **Dono do ciclo:** Stripe Subscriptions. A Stripe renova, faz retry e
   emite `invoice.paid` / `invoice.payment_failed`. Nosso `currentPeriodEnd`
   para assinaturas STRIPE vem do payload da Stripe, não de `advancePeriod()`.
2. **Coleta do cartão:** Payment Element montado dentro do nosso card, no
   lugar do placeholder "Em breve" da aba Cartão. Tema herda nossas CSS vars
   via `appearance`. Dados do cartão não tocam nosso servidor (PCI SAQ-A).
3. **Troca de método:** liberada a qualquer momento. O fluxo cancela o
   mandato InterPix (reaproveitando o que `subscribe` já faz, inclusive o
   aviso de cobrança pendente) e abre a assinatura Stripe começando no
   `currentPeriodEnd` atual via `trial_end`. Sem cobrança dupla, sem
   pró-rata.
4. **Catálogo:** 4 Price IDs criados na Stripe (corre/cresce × mensal/anual,
   valores CARD de `plans.ts`), mapeados por env var. Um teste em
   `plans.test.ts` falha se um plano cobrável não tiver Price mapeado.
5. **Modelagem:** campos `stripe*` na própria `Subscription`, ao lado dos
   `interpix*`. Sem tabela separada. `userId @unique` continua sendo a
   garantia de "uma assinatura por usuário".
6. **Webhook:** projeta o estado inteiro a partir de um
   `subscriptions.retrieve` feito na hora, em vez de aplicar deltas como o
   `interpix-events.ts`. Evento fora de ordem vira no-op (guarda por
   `stripeSyncedAt`), não regressão de estado. Exactly-once continua no
   `ProcessedWebhookEvent`, com id prefixado `stripe:evt_...`.

## Modelagem de dados

`SubscriptionProvider` ganha o valor `STRIPE`.

Campos novos em `Subscription` (todos nullable, `ADD COLUMN IF NOT EXISTS`):

| Campo                   | Tipo       | Papel                                        |
|-------------------------|------------|----------------------------------------------|
| `stripeCustomerId`      | String? @unique | reaproveitar o Customer entre tentativas |
| `stripeSubscriptionId`  | String? @unique | achar a assinatura no webhook           |
| `stripeSyncedAt`        | DateTime?  | guarda de ordem para eventos fora de ordem   |
| `cardBrand`             | String?    | exibir "Visa •••• 4242" no painel            |
| `cardLast4`             | String?    | idem                                         |

### Mapa de status Stripe -> SubscriptionStatus

| Stripe                | Nosso         | Observação                                   |
|-----------------------|---------------|----------------------------------------------|
| `incomplete`          | `PENDING_AUTH`| aguardando confirmação do primeiro pagamento |
| `trialing`            | `ACTIVE`      | `currentPeriodEnd = trial_end`, `paidThroughAt` intocado |
| `active`              | `ACTIVE`      |                                              |
| `past_due`            | `PAST_DUE`    |                                              |
| `unpaid` / `paused`   | `SUSPENDED`   |                                              |
| `canceled`            | `CANCELED`    |                                              |
| `incomplete_expired`  | `AUTH_DENIED` |                                              |

`trialing -> ACTIVE` dá acesso completo assim que o cartão é validado, antes
da primeira cobrança. É mais generoso que o Pix (que fica em `PENDING_AUTH`
+ `graceUntil`), justificado porque cartão validado é sinal mais forte que
mandato Pix. Mudança de política aceita.

`invoice.paid` avança `paidThroughAt` para o `period_end` da linha da
invoice, preservando o significado de que `hasPaidAccess()` depende.

## Fluxo do checkout

A server action `subscribeWithCard(formData)` devolve
`{ clientSecret, mode: "payment" | "setup" }`. Antes de tocar a Stripe:
valida plano/ciclo, bloqueia `provider === "MANUAL"`, cancela o mandato
InterPix existente e propaga `recordPendingChargeWarning`. Chamada à Stripe
com `idempotencyKey` derivada de `userId+plan+cycle`.

- **`mode: "payment"`** — usuário sem período pago sobrando (conta nova sem
  trial, trial vencido, `CANCELED`, `AUTH_DENIED`). Cria a Subscription com
  `payment_behavior: 'default_incomplete'` +
  `expand: ['latest_invoice.confirmation_secret']`. Cliente chama
  `stripe.confirmPayment`. Cobra na hora.
- **`mode: "setup"`** — usuário com período pago (trial de 14 dias em curso
  ou Pix pago até data futura). Cria com
  `trial_end = currentPeriodEnd ?? trialEndsAt`,
  `payment_behavior: 'default_incomplete'`,
  `trial_settings.end_behavior.missing_payment_method: 'cancel'` +
  `expand: ['pending_setup_intent']`. Cliente chama `stripe.confirmSetup`.
  Não cobra agora; valida e guarda o cartão.

Componente é o mesmo Payment Element; muda só qual `confirm*` chamar.

## Webhook

`src/app/api/webhooks/stripe/route.ts` espelha a rota do InterPix: lê
`request.text()` cru, valida com `stripe.webhooks.constructEvent`, delega
para `applyStripeEvent` em `src/server/tenant/stripe-events.ts`, que devolve
o mesmo union `EventOutcome`.

Eventos assinados: `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.paid`, `invoice.payment_failed`, `setup_intent.succeeded`.

Handler: dedupe por `stripe:${event.id}` -> resolve `stripeSubscriptionId`
do payload -> `subscriptions.retrieve` -> projeta estado inteiro -> grava
só se `stripeSyncedAt` for anterior ao instante da leitura.

Risco a verificar na primeira tarefa (não assumir): em versões recentes da
API a Stripe moveu `current_period_end` da raiz da Subscription para
`items.data[]`, e `invoice.subscription` para
`invoice.parent.subscription_details.subscription`. Fixar `apiVersion` e
confirmar os dois caminhos com evento real de `stripe listen` antes de
seguir.

## Cliente Stripe e configuração

`src/server/tenant/stripe.ts`: singleton com `apiVersion` fixa,
`StripeApiError` com `code` + `requestId`, `priceIdFor(plan, cycle)`.

Env novas (em `.env.example`):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`STRIPE_PRICE_CORRE_MONTHLY`, `STRIPE_PRICE_CORRE_YEARLY`,
`STRIPE_PRICE_CRESCE_MONTHLY`, `STRIPE_PRICE_CRESCE_YEARLY`.

Deps via pnpm: `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`.

## UI

- `src/components/checkout/card-checkout-content.tsx` — `<Elements>` em modo
  `subscription` com valor/moeda locais; a Subscription na Stripe só é
  criada no submit (criação diferida, para clique-e-desiste não deixar
  assinatura `incomplete` órfã). `appearance` mapeia `--primary`,
  `--background`, `--border`, `--radius`. Botão de submit é o nosso.
- `checkout-client.tsx` — aba `card` perde placeholder e badge "Em breve";
  `<Elements>` só monta quando a aba está ativa.
- `plan-panel.tsx` — "Visa •••• 4242" + "Trocar cartão" quando
  `provider === "STRIPE"`.
- `checkout-state.ts` — ganha parâmetro de provedor; retorna `none` para
  `STRIPE` (senão um STRIPE em `PENDING_AUTH` cairia no ramo `failed` e
  mostraria texto de Pix).

## Testes

- `stripe-events.test.ts` — mapa de status; evento fora de ordem convergindo
  em vez de regredir; dedupe; `unknown`; `trialing` preservando
  `paidThroughAt` do Pix.
- `subscription.test.ts` (casos de cartão) — escolha `payment` vs `setup`;
  cancelamento do mandato InterPix antes de criar na Stripe; bloqueio de
  `MANUAL`; idempotency key.
- `plans.test.ts` — falha se plano cobrável não tiver `STRIPE_PRICE_*`.
- `checkout-state.test.ts` — provedor STRIPE não dispara card de Pix.

## Rollout

1. Migration SQL à mão, aplicada via `docker exec -i cookies_db psql -U
   cookies -d cookies` e `-d cookies_test` (`ADD COLUMN IF NOT EXISTS`).
   `pnpm exec prisma generate`.
2. 4 Prices em modo teste + `stripe listen --forward-to
   localhost:3000/api/webhooks/stripe`.
3. Feature flag de graça: sem `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, a aba
   continua "Em breve".
4. Copiar Prices para live, criar endpoint de webhook em produção, env na
   Vercel.

## Fora de escopo (YAGNI)

Portal de faturas da Stripe, upgrade/downgrade com pró-rata no cartão,
boleto, parcelamento, plano `escala`.
