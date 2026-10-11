# Troca de plano (upgrade e downgrade)

Data: 2026-10-11
Status: aprovado, aguardando plano de implementação
Depende de: `2026-10-11-confirmacao-em-tempo-real-design.md`

## Objetivo

Quem já tem assinatura ativa troca de plano ou de ciclo pela tela de plano,
no cartão ou no Pix, sem falar com a equipe e sem cancelar antes. Hoje a
tentativa devolve "fale com a nossa equipe" (Pix) ou "cancele a atual antes
de assinar de novo" (cartão).

Critério de sucesso:

- cartão, Corre mensal → Cresce mensal: o diálogo mostra o valor
  proporcional calculado pela Stripe, a pessoa confirma, paga a diferença e
  o plano Cresce vale na hora;
- cartão, Cresce → Corre: o plano continua Cresce até o fim do período pago,
  a tela mostra "Seu plano muda para Corre em DD/MM" com "Desfazer", e a
  próxima fatura sai no valor do Corre;
- Pix, Corre → Cresce: a pessoa autoriza o QR da recorrência nova, vê a
  animação de confirmação, o Cresce vale na hora sem cobrança extra e a
  próxima cobrança sai no valor cheio do Cresce.

## Decisões

1. **Classificação da troca** (`classifyPlanChange` em `src/lib/plans.ts`,
   função pura):
   - **imediata** quando o plano sobe e o ciclo não cai de anual para
     mensal, ou quando o plano se mantém e o ciclo vai de mensal para anual;
   - **no fim do período pago** em todo o resto (plano descendo, ou ciclo de
     anual para mensal, inclusive o caso misto de plano subindo com ciclo
     caindo);
   - mesmo plano e mesmo ciclo não é troca.
   A ordem dos planos é a de `PLANS` (Corre < Cresce < Escala). Escala
   continua contratado por atendimento e não aparece como destino de troca.
2. **Cartão, imediata**: a assinatura da Stripe troca de preço com cobrança
   proporcional na hora. Se o pagamento falhar ou pedir verificação, a troca
   não acontece.
3. **Cartão, no fim do período**: agendada na própria Stripe (Subscription
   Schedule), com opção de desfazer enquanto não vale.
4. **Pix, qualquer troca**: cria uma recorrência nova com o valor do plano
   novo, que a pessoa autoriza num QR. Nunca há cobrança da diferença no Pix.
   - **imediata**: o plano novo vale assim que a recorrência nova é
     autorizada;
   - **no fim do período**: o plano muda no vencimento; a recorrência nova é
     autorizada antes, para garantir a cobrança.
   Se a pessoa nunca autorizar, nada muda.
5. **O plano do app passa a vir do preço da Stripe** nos webhooks do cartão
   (hoje só é gravado na hora de assinar).
6. **Downgrade abaixo do número de workspaces**: o diálogo avisa quantos
   workspaces ficarão somente leitura. A regra de excedente já existe
   (`activeWorkspaceIds`), não muda.

## Modelo de dados

Novos campos em `Subscription`:

| Campo | Tipo | Uso |
|---|---|---|
| `scheduledPlan` | `String?` | plano que passa a valer no fim do período |
| `scheduledCycle` | `SubscriptionCycle?` | ciclo que passa a valer junto |
| `scheduledAt` | `DateTime?` | quando a troca agendada vale |
| `stripeScheduleId` | `String?` | Subscription Schedule da troca agendada no cartão |
| `pendingInterpixSubscriptionId` | `String?` (único) | recorrência Pix nova aguardando autorização |
| `pendingPlan` | `String?` | plano da recorrência Pix pendente |
| `pendingCycle` | `SubscriptionCycle?` | ciclo da recorrência Pix pendente |
| `pendingChangeKind` | `PlanChangeKind?` (`IMMEDIATE`, `AT_PERIOD_END`) | o que fazer quando a recorrência pendente for autorizada |

### Migration (SQL à mão)

Aplicada via `docker exec … psql` em `cookies` e `cookies_test`, sem
`prisma migrate dev`: `CREATE TYPE "PlanChangeKind"`, `ALTER TABLE
"subscription" ADD COLUMN …` para cada campo e índice único em
`pendingInterpixSubscriptionId`.

## Cartão (Stripe)

### Prévia

`previewCardPlanChange(plan, cycle)` (server action):

- imediata: `invoices.createPreview` com o item trocando de preço e
  `proration_behavior: "always_invoice"`; devolve o valor cobrado agora e o
  valor a partir da próxima fatura;
- no fim do período: devolve a data (`current_period_end`) e o valor novo,
  sem chamar a Stripe para cobrança.

### Aplicar

`changeCardPlan(plan, cycle)`:

- **imediata**: `subscriptions.update` trocando o preço do item, com
  `proration_behavior: "always_invoice"` e `payment_behavior:
  "pending_if_incomplete"`. Se a fatura pedir ação (3DS), devolve o
  `client_secret` para a tela concluir com `stripe.confirmPayment`; enquanto
  isso, a Stripe mantém a troca pendente e o plano não muda. O app só muda o
  plano pelo webhook `customer.subscription.updated` com o preço novo.
- **no fim do período**: cria (ou reaproveita) uma Subscription Schedule a
  partir da assinatura, com a fase atual até `current_period_end` e a fase
  seguinte no preço novo; grava `scheduledPlan`, `scheduledCycle`,
  `scheduledAt` e `stripeScheduleId`.

`undoScheduledCardPlanChange()`: libera a Schedule
(`subscriptionSchedules.release`) e limpa os campos agendados.

### Webhook

`projectStripeState` passa a gravar `plan` e `cycle` a partir do preço do
item (mapa inverso de `priceIdFor`). Quando o preço da assinatura passa a
ser o do plano agendado, os campos `scheduled*` e `stripeScheduleId` são
limpos.

## Pix (InterPix)

### Pedir a troca

`requestPixPlanChange(plan, cycle)`:

1. classifica a troca;
2. calcula o 1º vencimento da recorrência nova: o próximo vencimento da
   atual cuja cobrança ainda não foi enviada ao banco (o ciclo atual, se
   faltarem mais de `CHARGE_LEAD_DAYS` dias; senão o seguinte);
3. cria a recorrência no `pix-inter-api` com o valor cheio do plano novo e
   esse 1º vencimento;
4. grava `pendingInterpixSubscriptionId`, `pendingPlan`, `pendingCycle` e
   `pendingChangeKind`, sem mexer no plano atual;
5. devolve o QR e, se a cobrança do ciclo atual já foi enviada, o aviso de
   que ela será debitada no valor antigo.

Pedir de novo substitui a pendente: a recorrência pendente anterior é
cancelada no `pix-inter-api` antes de criar a nova.

### Autorização da recorrência nova

`applyInterPixEvent` com `subscription.authorized` cujo `subscriptionId` é o
`pendingInterpixSubscriptionId` de alguém:

1. cancela a recorrência atual no `pix-inter-api` (a cobrança já enviada,
   se houver, é debitada mesmo assim — regra do Banco Central);
2. passa `interpixSubscriptionId` para a recorrência nova e limpa os campos
   `pending*`;
3. **imediata**: troca `plan` e `cycle` na hora;
   **no fim do período**: grava `scheduledPlan`, `scheduledCycle` e
   `scheduledAt` com o fim do período pago;
4. publica a mudança no canal de tempo real (a tela mostra a animação).

`subscription.auth_denied` da recorrência pendente só limpa os campos
`pending*`; a assinatura atual não é tocada.

### Troca agendada no Pix

`cycle.paid` da recorrência nova (a 1ª cobrança no plano novo) aplica
`scheduledPlan`/`scheduledCycle` e limpa os campos agendados. A
reconciliação aplica o mesmo quando `scheduledAt` já passou e o ciclo foi
pago.

## Tela de plano

- Cada card de plano mostra, conforme a assinatura atual: "Atual", "Fazer
  upgrade" (imediata) ou "Mudar no próximo ciclo" (no fim do período). O
  seletor Mensal/Anual entra na mesma classificação.
- Diálogo de confirmação:
  - cartão imediata: "Cobramos agora R$ X (proporcional aos dias que
    faltam). A partir de DD/MM, R$ Y por mês.";
  - cartão no fim do período: "Você continua no plano atual até DD/MM. A
    partir daí, R$ Y por mês.";
  - Pix imediata: "Sem custo agora. O plano novo vale assim que você
    autorizar o novo débito automático. A partir de DD/MM, R$ Y.";
  - Pix no fim do período: "Você continua no plano atual até DD/MM. Autorize
    o novo débito automático para a mudança valer.";
  - aviso de workspaces que ficarão somente leitura, quando houver.
- Pix: depois de confirmar, mostra o QR e liga a confirmação em tempo real.
  Como a assinatura atual já está autorizada, a regra de confirmação da
  especificação de tempo real não serve aqui: o evento `state` ganha
  `pendingPlanChange` (verdadeiro enquanto houver
  `pendingInterpixSubscriptionId`), e a tela da troca considera
  **confirmado** quando `pendingPlanChange` passa de verdadeiro para falso
  com o plano (ou o agendamento) já trocado, e **falhou** quando passa para
  falso sem troca (negativa no banco).
- Troca agendada: faixa "Seu plano muda para X em DD/MM" com "Desfazer"
  (cartão) ou "Cancelar mudança" (Pix, que cancela a recorrência nova e
  limpa os campos agendados enquanto ela não cobrou).

## Fora de escopo

- Trocar de método de pagamento (Pix ↔ cartão) com assinatura ativa: segue
  o fluxo atual de assinar no outro método.
- Crédito ou reembolso em downgrade.
- Escala por autoatendimento.

## Testes

- `classifyPlanChange`: tabela com todas as combinações de plano e ciclo,
  incluindo os casos mistos.
- Cartão: prévia e aplicação imediata chamam a Stripe com
  `always_invoice`; falha de pagamento não muda o plano; agendamento cria a
  Schedule e grava os campos; desfazer libera e limpa; webhook grava plano e
  ciclo a partir do preço e limpa o agendamento quando ele vale.
- Pix: 1º vencimento antes e depois da janela de envio; pedido grava os
  campos `pending*` sem mudar o plano; autorização imediata troca o plano e
  cancela a recorrência antiga; autorização agendada grava `scheduled*`;
  negativa só limpa o pendente; `cycle.paid` da recorrência nova aplica o
  agendado; novo pedido cancela o pendente anterior.
- Tela: rótulo de cada card conforme plano e ciclo atuais.
