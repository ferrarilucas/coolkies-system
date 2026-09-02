# Checkout transparente com Pix Automático — Fase 1

**Data:** 2026-09-02
**Status:** aprovado para planejamento
**Substitui:** seção 10 de `2026-08-29-multi-tenant-workspaces-design.md` na parte de contratação

## 1. Problema

O checkout atual leva o cliente para fora do Coolkies. Ele escolhe o plano, informa
CPF/CNPJ e é redirecionado para a fatura hospedada do Asaas, onde escolhe entre Pix,
boleto ou cartão. Duas coisas estão erradas nisso:

**A experiência.** A pessoa sai do produto no momento mais delicado da relação — o
pagamento — e cai numa página com a marca de outra empresa.

**A recorrência não é recorrente.** A assinatura criada hoje usa `billingType`, e com
Pix isso significa que o Asaas gera uma cobrança nova a cada ciclo e **o cliente precisa
pagar manualmente todas as vezes**. Não há débito automático. A documentação do Asaas é
explícita: *"Uma assinatura com billingType igual a PIX não possui o mesmo comportamento
do Pix Automático."*

Para um SaaS de R$29,90/mês, cobrança que depende de ação mensal do cliente é
inadimplência garantida.

## 2. Decisão

Trocar o motor de cobrança de **Assinatura com billingType** para **Pix Automático
(Jornada 3)**, e renderizar o QR Code dentro da nossa própria tela.

O Pix Automático resolve os dois problemas de uma vez: um único QR Code cobra o primeiro
pagamento **e** autoriza os débitos futuros. Depois disso, o Asaas debita sozinho a cada
ciclo, sem ação do cliente. E como a API devolve o QR como dado bruto (não como link),
não há motivo para redirecionar ninguém.

### Por que não trocar de gateway

Considerado e descartado, com os motivos registrados:

- **Stripe:** motor de assinatura superior, mas *"Pix Automático isn't available in
  Brazil"* para contas brasileiras (documentação Stripe). Recorrência só por cartão.
- **Pagar.me / Iugu / Vindi:** suportam Pix recorrente, mas migrar significa refazer
  webhook, reconciliação e modelo de dados de um sistema que já está integrado e testado.
- **Inter direto:** API de Pix Automático completa e aderente ao padrão BACEN, mas nos
  colocaria no papel de integrador direto com o arranjo, com carga de conformidade que
  um gateway homologado já absorve.

O Asaas já suporta exatamente o que precisamos; o recurso simplesmente nunca foi
implementado.

### Elegibilidade

Norma do BACEN exige CNPJ com pelo menos 6 meses de atividade para Pix Automático.
**Confirmado pelo dono: o CNPJ atende.** A criação de autorização foi validada contra o
sandbox real e funciona.

## 3. Escopo

### Nesta fase

Contratação por **Pix Automático**, ponta a ponta, sem o cliente sair do Coolkies.

### Fora desta fase (Fase 2)

Cartão de crédito embutido via **Stripe Elements**. Decidido, mas separado por dependência
externa: a conta Stripe (`acct_1UAvIL4z3YvNqwGi`, FR SOFTWARE STUDIO LTDA) está com
`charges_enabled: false` e verificação de identidade pendente.

O motivo de o cartão ir para o Stripe e não para o Asaas está registrado aqui porque
condiciona o modelo de dados desta fase: a documentação do Asaas afirma que *"Asaas does
not offer client-side tokenization via front-end"* e recomenda certificação **SAQ-D** para
quem transmite dado de cartão pelo próprio backend. SAQ-D é desproporcional para o estágio
do produto. O Stripe Elements mantém o cartão fora do nosso servidor (SAQ-A) sem tirar o
cliente da tela.

Por isso o campo `provider` desta fase **já nasce com o valor `STRIPE`**, mesmo sem uso.

## 4. Modelo de dados

### `Subscription` — mudanças

```prisma
enum SubscriptionProvider {
  ASAAS
  STRIPE
  MANUAL
}
```

- **`source: SubscriptionSource` → `provider: SubscriptionProvider`.** Hoje `source` mistura
  duas perguntas: "de onde veio" e "quem administra". Passa a responder uma só: **quem é a
  fonte de verdade desta assinatura.** `MANUAL` continua significando atribuída à mão, e
  continua sendo o valor que a reconciliação nunca toca e que o `subscribe` recusa
  sobrescrever.
- **`asaasAuthorizationId: String?`** — novo. É o handle principal do Pix Automático: o
  ciclo de vida da autorização é o que determina se a assinatura está viva.
- `asaasCustomerId` e `asaasSubscriptionId` permanecem. O `asaasSubscriptionId` passa a ser
  preenchido pelo Asaas quando a autorização ativa (com `paymentCreationMode: SUBSCRIPTION`
  ele cria a assinatura interna); na criação vem `null`.

Colunas do Stripe entram na Fase 2. Não criar coluna que ninguém escreve.

### Migração

Aditiva e idempotente, no padrão de `20260831080640_backfill_manual_subscriptions`:

1. Cria o enum `SubscriptionProvider`.
2. Adiciona `provider` com default `ASAAS`.
3. Copia: `source = 'MANUAL'` → `provider = 'MANUAL'`; `source = 'ASAAS'` → `provider = 'ASAAS'`.
4. Adiciona `asaasAuthorizationId`.
5. Remove `source` e o enum `SubscriptionSource`.

As assinaturas MANUAL criadas pelo backfill da base pré-billing precisam continuar
MANUAL depois da migração — isso é o que mantém a dona do Douce Vie escrevendo.

Remover `source` é uma mudança que atravessa o código; todos os pontos que hoje o leem
precisam migrar na mesma task, senão o build quebra pela metade:

- `src/server/actions/subscription.ts` — o guard que recusa sobrescrever MANUAL
- `src/components/workspaces/plan-panel.tsx` — o ramo que esconde a grade para MANUAL
- `src/app/(app)/workspaces/plan/page.tsx` — a prop passada ao painel
- `scripts/reconcile-subscriptions.ts` — o filtro da varredura
- `src/server/tenant/subscription.ts` — `recordAsaasSubscription` e `ensureTrialSubscription`

E seis arquivos de teste que montam `Subscription` com `source`: `subscription.test.ts`
(tenant e actions), `subscription-backfill.test.ts`, `workspaces.test.ts`,
`asaas-events.test.ts` e `route.test.ts` do webhook. O backfill é o mais sensível: ele
executa o SQL real da migration contra o banco, então precisa continuar provando que o
dono pré-billing termina com `provider: MANUAL` e volta a escrever.

## 5. Fluxo

### Contratação (Jornada 3)

1. Cliente escolhe plano e ciclo, informa CPF/CNPJ.
2. Servidor garante o cliente no Asaas (reusa `asaasCustomerId` quando já existe).
3. Servidor cria a autorização:

```
POST /v3/pix/automatic/authorizations
{
  "customerId":   "cus_...",
  "contractId":   "<o id da nossa Subscription>",
  "description":  "Coolkies — plano <label>",
  "paymentCreationMode": "SUBSCRIPTION",
  "value":        29.90,
  "frequency":    "MONTHLY",
  "startDate":    "AAAA-MM-DD",
  "immediateQrCode": {
    "originalValue":     29.90,
    "expirationSeconds": 3600
  }
}
```

4. Resposta traz `id`, `payload` (copia-e-cola) e `encodedImage` (PNG em base64).
5. A tela renderiza o QR e o copia-e-cola. **Sem redirecionamento.**
6. Cliente paga no app do banco — e no mesmo ato autoriza a recorrência.
7. Webhook confirma; a tela sai do estado de espera sozinha.
8. Ciclos seguintes: o Asaas debita automaticamente.

### Campos verificados contra a API

Os nomes abaixo foram descobertos chamando o endpoint real no sandbox, porque a página
de referência estava indisponível. Não são suposições:

| Campo | Observação |
|---|---|
| `customerId` | **não** é `customer`, como no endpoint de assinaturas |
| `contractId` | obrigatório |
| `frequency` | obrigatório |
| `startDate` | obrigatório, data válida |
| `value` | obrigatório quando `paymentCreationMode: SUBSCRIPTION` |
| `immediateQrCode.originalValue` | **não** é `value` |
| `immediateQrCode.expirationSeconds` | **não** é `expirationDate` |

### Armadilha do ciclo anual

`frequency` aceita `MONTHLY`, `WEEKLY`, `QUARTERLY`, `SEMIANNUALLY`, `ANNUALLY`.
**Rejeita `YEARLY`.**

Nosso enum interno é `SubscriptionCycle { MONTHLY, YEARLY }` e a API de *assinaturas* do
Asaas — a que usamos hoje — aceita `YEARLY`. Ou seja: **duas APIs do mesmo gateway usam
vocabulário diferente para o mesmo conceito.** Sem tradução explícita, o plano anual
quebra e o mensal passa, que é o pior modo de falha possível.

A tradução `YEARLY → ANNUALLY` precisa de função nomeada e teste próprio.

### `startDate` e o risco de cobrança dupla

`startDate` define quando a recorrência começa, e o `immediateQrCode` já cobra o primeiro
ciclo. Se `startDate` cair dentro do período que o QR imediato pagou, o cliente é cobrado
duas vezes pelo mesmo mês.

A implementação define `startDate` como **o início do ciclo seguinte** (hoje + 1 mês para
`MONTHLY`, hoje + 1 ano para `ANNUALLY`) e **precisa confirmar empiricamente no sandbox**
que o primeiro débito automático cai no ciclo seguinte, não no já pago.

### `retryPolicy`

O padrão da API é `NOT_ALLOWED` — falhou uma vez, não tenta de novo. Para cobrança
recorrente isso descarta receita recuperável (saldo insuficiente no dia é comum e
temporário). A implementação deve configurar retentativa e tratar os eventos
correspondentes.

## 6. Webhooks

Rota existente `/api/webhooks/asaas`, que já autentica por token antes de ler o corpo e já
tem idempotência por `ProcessedWebhookEvent`. A entrega é *at-least-once* e o mesmo evento
pode chegar repetido — a idempotência atual cobre isso e permanece.

### Eventos da autorização

| Evento | Efeito |
|---|---|
| `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED` | registra; nada muda de estado |
| `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED` | assinatura vira `ACTIVE` |
| `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED` | QR expirou ou não foi autorizado — **não** marca inadimplência; a pessoa nunca chegou a assinar |
| `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED` | cliente revogou no app do banco — assinatura vira `CANCELED` |
| `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED` | atingiu `finishDate` — assinatura vira `CANCELED` |

### Eventos da instrução de pagamento

`..._PAYMENT_INSTRUCTION_CREATED`, `..._SCHEDULED`, `..._REFUSED`, `..._CANCELLED`.
`REFUSED` é o sinal de falha de débito (sem saldo, limite) e deve seguir a mesma regra de
carência que `PAYMENT_OVERDUE` usa hoje.

Os eventos de cobrança já tratados (`PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
`PAYMENT_OVERDUE`) continuam válidos e continuam sendo o que confirma dinheiro.

### Correlação

O handler atual casa evento com assinatura por `asaasSubscriptionId`. Os eventos de
autorização referenciam a **autorização**, não a assinatura. O casamento passa a
considerar `asaasAuthorizationId` também, senão todo evento de autorização cai no ramo
"assinatura desconhecida", é gravado como processado e descartado para sempre.

## 7. Consequência obrigatória: o estado `CANCELED` deixa de ser teórico

Havia um item parqueado: `isCurrent` (interface) e o guard de reassinatura (servidor) não
olham `status`, o que era inofensivo porque **nenhum caminho do código escrevia `CANCELED`**.

Esta fase cria dois caminhos que escrevem `CANCELED` (autorização cancelada e expirada).
A partir daqui, um cliente que cancelou pelo app do banco ficaria com o botão travado em
"Plano atual" e leria a mensagem *"você já tem uma assinatura ativa"* — falsa.

**Corrigir junto, nesta fase, não depois:** guard e `isCurrent` passam a considerar
`status`. Assinatura `CANCELED` permite contratar de novo.

## 8. Interface

Um passo a mais no diálogo de contratação, entre o CPF/CNPJ e a confirmação:

- **QR Code** renderizado de `encodedImage`.
- **Copia-e-cola** de `payload`, com botão de copiar (o padrão já usado no código de convite).
- **Estado de espera** enquanto o pagamento não confirma, com o que está acontecendo dito
  em português claro — a pessoa precisa saber que deve abrir o banco.
- **Transição automática** quando o webhook confirmar, por consulta periódica ao nosso
  próprio servidor enquanto o diálogo estiver aberto.
- **Expiração:** o QR vale 1 hora; a tela precisa dizer isso e permitir gerar outro.

`resumeCheckout` sobrevive com propósito novo: em vez de devolver o link da fatura, devolve
o QR da autorização pendente, para quem fechou a aba antes de pagar.

O que morre: `billingType: "UNDEFINED"`, `invoiceUrl`, `listAsaasPaymentsOfSubscription`
como caminho de checkout, e o redirecionamento por `window.location.href`.

## 9. Reconciliação

`scripts/reconcile-subscriptions.ts` hoje consulta as cobranças e só promove a `ACTIVE`
com evidência de pagamento no ciclo, nunca rebaixa, e ignora `MANUAL`. Essa regra continua
valendo e continua sendo a rede de segurança para webhook perdido.

Passa a considerar também o **estado da autorização**: uma assinatura local `ACTIVE` cuja
autorização foi cancelada no banco é divergência que precisa aparecer no log. O filtro
`provider: ASAAS` substitui o filtro `source: ASAAS`.

## 10. Testes

Além dos testes por unidade de comportamento:

- **Tradução de ciclo:** `YEARLY → ANNUALLY`, com teste que falharia se alguém mandasse
  `YEARLY` cru para a API.
- **Correlação por autorização:** evento de autorização encontra a assinatura certa e
  **não** cai no ramo de desconhecida.
- **`CANCELED` permite recontratar:** o teste que prova a correção da seção 7.
- **`REFUSED` de autorização não marca inadimplência:** quem nunca assinou não pode virar
  devedor.
- **Idempotência:** evento repetido não reaplica efeito (o padrão já existente).
- **Prova de ponta a ponta no sandbox**, com saída real registrada, de que a autorização é
  criada e o QR volta utilizável — o mesmo rigor que o backfill da migração teve.

## 11. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| `startDate` cobrar ciclo já pago pelo QR imediato | verificação empírica obrigatória no sandbox antes de fechar a task |
| Evento de autorização não correlacionado vira lixo silencioso | correlação por `asaasAuthorizationId` + teste dedicado |
| `YEARLY` enviado cru quebra só o plano anual | função de tradução com teste próprio |
| Cliente cancela no banco e o app não percebe | tratar `AUTHORIZATION_CANCELLED`; reconciliação como rede |
| Assinatura antiga (billingType) coexistindo | nenhum assinante real hoje — confirmado pelo dono; não há migração de assinantes a fazer |

## 12. Fora de escopo, registrado

- Cartão via Stripe Elements (Fase 2).
- Cancelamento da assinatura pelo próprio cliente dentro do app.
- Troca de plano com cancelamento da autorização anterior no gateway — hoje trocar de
  plano deixa a anterior ativa, com aviso explícito; a mesma limitação se aplica à
  autorização e continua parqueada.
- Portal de autoatendimento para quem tem assinatura MANUAL.
