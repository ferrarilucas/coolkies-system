# Checkout transparente com a InterPix API

**Data:** 2026-09-02
**Status:** aprovado para planejamento
**Substitui:** `2026-09-02-checkout-transparente-pix-automatico-design.md` (Asaas) e a
seção 10 de `2026-08-29-multi-tenant-workspaces-design.md` na parte de contratação
**Contrato de referência:** handoff da InterPix API, recebido em 2026-09-02

## 1. O que muda

O Coolkies deixa de falar com o Asaas. Passa a falar com a **InterPix API** — gateway Pix
self-hosted do próprio dono, que integra com o Banco Inter e é dono de assinaturas, ciclos,
máquina de estados e dunning.

A divisão de responsabilidade fica assim, e é o ponto mais importante deste documento:

| Responsabilidade | Dono |
|---|---|
| Assinatura, ciclo, dunning, retentativa, comunicação com o Inter | InterPix API |
| Quem tem acesso a quê, identidade, interface, e-mail | Coolkies |

**O Coolkies nunca fala com o Banco Inter.** E não recalcula dunning: quando a InterPix diz
que alguém está em `PAST_DUE`, isso significa "em cobrança, ainda com acesso" — não é a nossa
carência local decidindo.

## 2. A mudança de produto que ninguém pode ignorar

O fluxo anterior (Asaas, Jornada 3) cobrava e autorizava no mesmo QR: pagou, ativou, segundos.

A InterPix usa **Jornada 2**: autorização e pagamento são eventos separados **por dias**. O
cliente autoriza o mandato no app do banco; a primeira cobrança só é debitada no vencimento.
Entre uma coisa e outra passam-se dias.

O contrato é explícito nas duas pontas:

- **Regra 1:** liberar o plano só em `cycle.paid`, nunca em `subscription.authorized`.
  *"Autorização não é pagamento… Liberar na autorização dá acesso a quem nunca pagou."*
- **Seção 9:** *"A UI precisa de um estado intermediário honesto ('aguardando a primeira
  cobrança'), não um spinner."*

### Decisão sobre o vão de acesso

Sem tratamento, alguém que assina no fim do trial perde acesso ao expirar e só recupera dias
depois, tendo feito tudo certo.

**Decisão do dono: estender a carência na autorização.** Ao receber
`subscription.authorized`, o Coolkies mantém o acesso até `vencimento + carência`, gravado em
`graceUntil`.

Isso **não viola a Regra 1**, e a distinção importa: não estamos liberando plano para quem
nunca pagou — estamos deixando de cortar quem já tinha acesso e acabou de autorizar um
mandato bancário. Quem nunca teve acesso (sem trial vigente) continua sem acesso até
`cycle.paid`.

Se o débito falhar, `subscription.suspended` corta. O risco aceito, nomeado: quem autoriza e
nunca paga ganha alguns dias de acesso.

## 3. Ambiguidade no contrato, a resolver contra o serviço

A seção 6.1 diz que `subscription.authorized` não deve liberar nada. A seção 8 diz que a
transição `PENDING_AUTH → ACTIVE` existe e que `ACTIVE` tem acesso — sem dizer qual evento a
dispara.

Se `authorized` já move para `ACTIVE` na InterPix, espelhar o status dela contradiz a Regra 1.

**Como o desenho evita depender disso:** o entitlement do Coolkies é decidido pelos *eventos*
que recebemos, não por espelhar o status remoto. Ainda assim, a implementação **deve
verificar** o que `GET /subscriptions/:id` reporta logo após um `authorized`, e registrar a
resposta na task. É a diferença entre um cliente pagante e um caroneiro.

## 3.1 Preços

Os preços em `src/lib/plans.ts` estão desatualizados em valor, em id e em forma. A fonte de
verdade é a página pública, conferida em 2026-09-06:

| Plano | | Pix | Cartão |
|---|---|---|---|
| **corre** (1 workspace) | Mensal | R$ 34,50 | R$ 39,50 |
| | Anual | R$ 24,50 → R$ 294,00/ano | R$ 29,50 → R$ 354,00/ano |
| **cresce** (até 4 workspaces) | Mensal | R$ 94,90 | R$ 99,90 |
| | Anual | R$ 84,90 → R$ 1.018,80/ano | R$ 89,90 → R$ 1.078,80/ano |
| **escala** (ilimitado) | — | sob medida | sob medida |

Em vez de tabelar oito números, o código codifica a regra que a própria página enuncia
("R$ 120 por assinar o ano inteiro e mais R$ 60 por deixar a cobrança no Pix"):

- base mensal no cartão: `corre` 3950, `cresce` 9990 (centavos)
- ciclo anual: −1000 centavos/mês
- pagamento por Pix: −500 centavos/mês
- cobrança anual = mensal resultante × 12

As oito células da tabela caem exatamente dessa regra. Um teste deve provar isso célula a
célula, porque é o tipo de conta que ninguém confere depois.

**A forma de pagamento entra só no cálculo do valor, no momento do checkout.** Depois que a
assinatura é criada com um `amount`, quem administra a cobrança é a InterPix. Não é dimensão
do modelo de dados; é argumento de uma função pura.

Os ids mudam de `solo|team|unlimited` para `corre|cresce|escala`. Como não há assinante real,
não há migração de dados de plano a fazer — mas o backfill pré-billing gravou `plan: 'solo'`
nas linhas MANUAL, e a migração precisa reescrever esse valor.

## 4. Modelo de dados

### `Subscription`

```prisma
enum SubscriptionStatus {
  TRIALING
  PENDING_AUTH
  ACTIVE
  PAST_DUE
  SUSPENDED
  CANCELED
  AUTH_DENIED
}

enum SubscriptionProvider {
  INTERPIX
  MANUAL
}
```

Adotamos o vocabulário da InterPix mais o nosso `TRIALING`, que é anterior a qualquer
assinatura. Traduzir entre dois vocabulários seria uma camada a mais para errar.

Campos:

- `provider: SubscriptionProvider` — substitui `source`. `MANUAL` continua sendo o que a
  reconciliação nunca toca e o que o checkout recusa sobrescrever.
- `interpixSubscriptionId String? @unique` — **obrigatório para o produto funcionar.**
  O contrato avisa: `cycle.paid` e `cycle.failed` **não carregam `externalUserId`**, só
  `subscriptionId`. Como `cycle.paid` é justamente o evento que libera o plano, sem esse
  mapeamento gravado na criação não há como saber de quem é o pagamento.
- `lastAppliedEventId BigInt?` — guarda de ordenação (seção 6).
- `interpixPixCopyPaste String?` — o copia-e-cola devolvido na criação. Guardado porque
  **`GET /subscriptions/:id` não o devolve** — só a criação devolve. Sem isso, quem fechar a
  aba antes de autorizar não tem como recuperar o código, e `resumeCheckout` fica sem fonte.
  Não é credencial: é um código de pagamento, equivalente a um número de boleto.
- `graceUntil` — reaproveitado para a carência da seção 2.
- Saem: `asaasCustomerId`, `asaasSubscriptionId`, `SubscriptionSource`.

### Migração

Aditiva, no padrão do backfill de agosto:

1. Cria os enums novos e adiciona os valores novos a `SubscriptionStatus`.
2. Adiciona `provider` (default `INTERPIX`), `interpixSubscriptionId`, `lastAppliedEventId`.
3. `source = 'MANUAL'` → `provider = 'MANUAL'`.
4. Trata as linhas `source = 'ASAAS'` conforme o levantamento em produção (abaixo).
5. Remove `source`, `SubscriptionSource` e as colunas `asaas*`.

**Pré-requisito, a rodar contra produção antes de escrever a migração:**

```sql
SELECT source, status, count(*) FROM subscription GROUP BY 1,2;
```

Não há assinantes reais — confirmado pelo dono — então qualquer linha `ASAAS` é resíduo de
teste. Elas viram `MANUAL` com `notes` explicando a origem, o que preserva o acesso de quem
estiver usando e não deixa órfão apontando para um gateway que não existe mais.

As linhas `MANUAL` do backfill pré-billing **precisam continuar MANUAL**. É o que mantém a
dona do Douce Vie escrevendo, e o teste que executa o SQL real da migração precisa continuar
provando isso.

### Pontos do código que leem `source`

Migram na mesma task, senão o build quebra pela metade:
`src/server/actions/subscription.ts`, `src/components/workspaces/plan-panel.tsx`,
`src/app/(app)/workspaces/plan/page.tsx`, `scripts/reconcile-subscriptions.ts`,
`src/server/tenant/subscription.ts`, mais os testes em `subscription.test.ts` (tenant e
actions), `subscription-backfill.test.ts`, `workspaces.test.ts`, `asaas-events.test.ts` e
`route.test.ts`.

## 5. Cliente da InterPix API

Novo módulo `src/server/tenant/interpix.ts`, no lugar de `asaas.ts`.

- Autenticação: `Authorization: Bearer <INTERPIX_API_TOKEN>`. Segredo de servidor —
  **nunca** `NEXT_PUBLIC_*`.
- Toda resposta traz `X-Request-Id`. **Registrar no nosso log em toda chamada**, com ou sem
  erro: é a única chave para correlacionar com o log da API quando algo der errado.
- Erros vêm como `{ code, message, details }`. `code` é o que o código deve inspecionar,
  nunca a mensagem.

### Formatos que rejeitam o óbvio

| Campo | Regra | Armadilha |
|---|---|---|
| `amount` | string `"NN.NN"`, exatamente duas casas | `"29.9"` e o número `29.90` são **rejeitados**. Guardamos centavos inteiros; a conversão é `(cents / 100).toFixed(2)` e precisa de teste |
| `debtor.taxId` | 11 ou 14 dígitos, só números | a máscara da interface (`000.000.000-00`) precisa ser removida antes de enviar |
| `intervalMonths` | inteiro 1–12 | `MONTHLY` → `1`, `YEARLY` → `12` |
| `firstDueDate` | `YYYY-MM-DD`, ≥ `CHARGE_LEAD_DAYS` à frente (padrão 3) | data no passado ou muito próxima é recusada |

### `firstDueDate`

`max(hoje + CHARGE_LEAD_DAYS, trialEndsAt)`.

Respeita o trial restante de quem assina no meio dele, e cobra o quanto antes for permitido
para quem já expirou. Como `CHARGE_LEAD_DAYS` é configuração da InterPix e pode mudar,
tratamos 3 como padrão e deixamos o valor configurável do nosso lado.

### Cancelamento não é idempotente

`POST /subscriptions/:id/cancel` chamado duas vezes devolve `409 INVALID_TRANSITION`. O
contrato manda **tratar 409 nesse endpoint como sucesso** — o cenário real é timeout de rede
em que a primeira chamada funcionou no servidor. Precisa de teste.

`pendingCycle` preenchido na resposta significa que uma cobrança já foi enviada ao Inter e vai
acontecer mesmo com a assinatura cancelada (regra do Bacen: só dá para cancelar até a véspera).
**A interface tem que dizer isso ao usuário**, com a data. Cobrar alguém que acabou de cancelar
sem avisar é a pior surpresa possível.

## 6. Webhook de entrada

Rota nova `POST /api/webhooks/interpix`. O `middleware.ts` já isenta `api/webhooks` inteiro,
então a rota nasce alcançável — mas isso precisa ser verificado com a regex real, como foi
feito quando o webhook do Asaas foi para produção protegido por engano.

### Assinatura

HMAC-SHA256 sobre `` `${X-Timestamp}.${corpo bruto}` ``, comparado em tempo constante,
rejeitando timestamp com mais de 5 minutos.

**Obrigatoriamente sobre os bytes originais.** `await req.text()` antes de qualquer parse.
`JSON.stringify(await req.json())` não é byte-a-byte igual ao que foi assinado e a assinatura
não bate — é o modo de falha clássico dessa integração.

### Resposta rápida

Timeout de 10 segundos; qualquer 2xx conta como entregue. Validar assinatura, aplicar o efeito
(que no nosso caso é uma escrita só) e responder. Nada de trabalho pesado antes do 2xx.

### Retentativa e desistência

`1, 5, 15, 60, 360, 1440` minutos, 6 tentativas, e depois **a entrega é abandonada em
definitivo — não há reenvio manual**. Se o Coolkies ficar fora do ar por ~24h, eventos somem
para sempre. É isso que torna a reconciliação da seção 8 obrigatória, não opcional.

### Os sete eventos

| Evento | Efeito no Coolkies |
|---|---|
| `cycle.paid` | **Libera / renova o plano.** `ACTIVE`, `graceUntil` limpo |
| `cycle.failed` | Registra o motivo. **Mantém o acesso** — está em dunning |
| `subscription.authorized` | Não libera. Estende `graceUntil` (seção 2) e atualiza a interface |
| `subscription.auth_denied` | `AUTH_DENIED`. Nenhuma cobrança virá |
| `subscription.past_due` | `PAST_DUE`, **com acesso**. Avisar o usuário |
| `subscription.suspended` | `SUSPENDED`. **Corta o acesso** |
| `subscription.canceled` | `CANCELED`. Encerra ao fim do período pago; se vier `pendingCycleSeq`, avisar |

`subscription.created` e `cycle.sent` existem na API mas **não** são entregues — não escrever
handler para eles.

Motivos possíveis de `cycle.failed.reason`: texto livre do Inter ou `null` (falha real de
débito), `"JANELA_DE_ENVIO_EXPIRADA"`, `"SEM_CONFIRMACAO_DO_PROVEDOR"`. Os dois últimos são
falha de infraestrutura, não inadimplência do cliente, e a mensagem ao usuário deve refletir
isso.

## 7. Ordenação de eventos — estado novo

Nossa idempotência atual (`ProcessedWebhookEvent`) dedupa por id de evento. **Isso não resolve
ordem.** O contrato descreve o cenário: um `cycle.paid` atrasado chegando depois de um
`subscription.canceled` mais recente reativaria o acesso de quem já cancelou — e passaria
direto pela dedupe, porque é um evento novo.

Guarda: `lastAppliedEventId` por assinatura, descartando `<=`.

```ts
if (BigInt(event.eventId) <= BigInt(sub.lastAppliedEventId ?? 0)) return;
```

**`BigInt`, e comparação numérica.** O contrato avisa do bug exato: em ordem lexicográfica
`"1000" < "999"`, e isso só aparece quando a base cruza uma potência de dez — depois do
go-live, com sintoma de eventos silenciosamente ignorados. Precisa de teste que compare
`"1000"` contra `"999"` e prove que o maior vence.

As duas proteções coexistem: dedupe por id (entrega repetida) **e** ordenação (entrega
atrasada).

## 8. Reconciliação

`GET /subscriptions/:id` é a fonte de verdade. O script atual passa a consultá-lo para toda
assinatura em estado não terminal (`PENDING_AUTH`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`) e
conciliar com o estado local.

Continua valendo o que já foi aprendido: **nunca rebaixar automaticamente** por status
inesperado, ignorar `MANUAL`, e registrar divergência no log em vez de agir por conta própria.

Isso deixa de ser rede de segurança opcional e passa a ser obrigatório, pela desistência
definitiva de entrega descrita na seção 6.

## 9. Interface

O diálogo de contratação passa a ter três estados:

**1. Coleta.** Plano, ciclo e CPF/CNPJ — como hoje.

**2. Autorização.** QR Code renderizado a partir de `authorization.pixCopyPaste` (é texto
puro; qualquer biblioteca de QR serve) mais o mesmo texto em botão de copiar. A tela precisa
dizer o que a pessoa está fazendo: **autorizando um débito recorrente**, não pagando agora.

**3. Aguardando a primeira cobrança.** Estado honesto, com a data de `nextDueDate`, dizendo
que o plano ativa quando a primeira cobrança for debitada. Isto **não é um spinner** — pode
durar dias, e a pessoa vai fechar a aba e voltar depois. Precisa sobreviver a isso.

O `resumeCheckout` continua existindo com propósito novo: devolver o copia-e-cola da
autorização pendente para quem fechou a aba antes de autorizar.

**Não coletar dados bancários do assinante.** Agência, conta e banco não fazem parte deste
fluxo, de propósito.

## 10. Configuração

| Variável | Uso |
|---|---|
| `INTERPIX_API_URL` | base da API, alcançável server-side |
| `INTERPIX_API_TOKEN` | Bearer. Segredo de servidor |
| `INTERPIX_WEBHOOK_SECRET` | verificação HMAC dos eventos de entrada |

E do outro lado: `SAAS_WEBHOOK_URL` da InterPix apontando para
`https://<dominio>/api/webhooks/interpix`.

Todas obrigatórias e validadas na partida, como `ASAAS_ENV` passou a ser — queda silenciosa
para um padrão é o modo de falha que já custou uma tarde nesta base.

## 11. Testes

Não há sandbox nem modo simulado na InterPix. A seção 10 do contrato ensina a gerar entregas
assinadas; é assim que se testa o lado do SaaS.

Cobertura mínima, cada item por um motivo concreto:

- **Assinatura HMAC inválida → 401.** Sem isso, quem descobrir a URL libera plano de graça.
- **Timestamp velho → 401.** Proteção contra replay.
- **`eventId` repetido → ignorado.** Entrega at-least-once.
- **`eventId` menor que o último → ignorado**, com o caso `"1000"` vs `"999"` explícito.
- **`cycle.paid` de assinatura desconhecida** não quebra e não cria nada.
- **`cycle.paid` libera; `subscription.authorized` não libera.** É a Regra 1, e é o teste que
  separa cliente de caroneiro.
- **`cycle.failed` mantém o acesso.** Dunning não é corte.
- **`amount`:** `2990` → `"29.90"`, e o anual do solo (`1990 * 12`) → `"238.80"`.
- **409 no cancelamento é tratado como sucesso.**
- **Migração:** o dono pré-billing continua `MANUAL` e continua escrevendo.

## 12. Bloqueadores e riscos, com origem

Os três primeiros vêm da seção 11 do próprio contrato, e não são ressalva de estilo.

| Risco | Situação |
|---|---|
| **Registro do webhook junto ao Inter não implementado** | *Bloqueador funcional declarado.* Sem isso o Inter nunca chama e **nenhuma assinatura sai de `PENDING_AUTH`**. O lado do SaaS pode ser construído e testado com entregas assinadas por nós, mas não há teste ponta a ponta até fechar |
| Nenhuma chamada ao Inter aceita em ambiente real | O corpo de `PUT /pix/v2/cobr/{txid}` foi montado a partir de documentação pública, com divergência conhecida entre a doc do Inter e o manual do Bacen |
| `endToEndId`, `horario`, `motivoRejeicao` são inferências | Se errados, cobrança paga mapeia para `UNKNOWN`, e **a assinatura nunca ativa**. É o primeiro modo de falha a observar |
| Origem do `POST /webhooks/inter` não é validada | Mitigado por confirmação contra o Inter antes de mudar estado; não impede tráfego indesejado |
| Ambiguidade `authorized` → `ACTIVE` | Seção 3. A verificar contra o serviço rodando |

## 13. Fora de escopo

- **Cartão de crédito via Stripe — confirmado como Fase 2**, depois desta. O motivo de ser
  Stripe e não Asaas (tokenização no navegador, SAQ-A em vez de SAQ-D) está na spec
  substituída. Por isso a função de preço já recebe a forma de pagamento como argumento
  nesta fase: quando o cartão entrar, o cálculo não muda.
- **Renomeação de Coolkies para Bigas** (19 ocorrências no código, incluindo o e-mail de
  convite e `contato@coolkies.com.br` nas mensagens de erro) — outro agente.
- **Limite de usuários por workspace** ("até 2 usuários" no corre, ilimitado no cresce), que
  hoje não existe no modelo — outro agente.

> **Aviso de colisão:** este trabalho toca `src/lib/plans.ts`, `src/server/tenant/`,
> `src/server/actions/subscription.ts`, `src/components/workspaces/plan-panel.tsx` e
> `prisma/schema.prisma`. Os agentes da renomeação e do limite de usuários vão querer os
> mesmos arquivos. Já houve nesta base um caso de commits indo parar no branch errado por
> troca concorrente de branch no mesmo checkout — vale isolar em worktree.
- Cancelamento pelo próprio cliente dentro do app — a API suporta; a interface fica para depois.
- Troca de plano: hoje trocar deixa a assinatura anterior ativa no gateway, com aviso
  explícito. Com a InterPix existe `cancel`, então dá para fechar de verdade — mas isso é
  trabalho próprio, não um brinde desta fase.
