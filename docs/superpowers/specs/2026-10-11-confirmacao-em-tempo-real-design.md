# Confirmação de assinatura em tempo real

Data: 2026-10-11
Status: aprovado, aguardando plano de implementação

## Objetivo

Quando a pessoa autoriza o Pix recorrente no banco ou paga no cartão, a tela
em que ela está (checkout ou plano) reage em até ~1 segundo, mostra uma
animação de confirmação e volta sozinha para o painel.

Hoje a autorização Pix chega ao `pix-inter-api` 0,4 s depois de aprovada,
mas só é entregue ao app pelo job que roda a cada minuto, e a tela só muda
se for recarregada. No cartão, a tela declara "assinatura ativa" assim que a
Stripe confirma o cartão, sem esperar o webhook que de fato ativa o plano.

Critério de sucesso: gerar um QR Pix, autorizar no banco e ver, sem
recarregar, a animação de confirmação em até ~2 s e o redirecionamento para
`/dashboard` ~3 s depois. No cartão, a animação só aparece depois que o
webhook da Stripe ativou a assinatura no app.

## Decisões

1. **No Pix, "confirmação" é a autorização no banco**, não o débito da 1ª
   cobrança (que acontece dias depois, com ninguém olhando a tela). No
   cartão, é a assinatura ficar `ACTIVE` no app pelo webhook da Stripe.
2. **Entrega imediata no `pix-inter-api`**: ao enfileirar uma entrega para o
   app vinda de um webhook do Inter, o serviço dispara a entrega na hora, sem
   esperar o job do minuto. O job continua como garantia.
3. **Server-Sent Events, não WebSocket**: `next start` não aceita WebSocket
   em rotas sem servidor customizado, e o fluxo é só servidor → tela.
4. **Emissor de eventos em memória** como fonte do SSE (escolhido em vez de
   consultar o banco a cada segundo ou `LISTEN/NOTIFY` do Postgres). Os
   pontos fracos são cobertos assim:
   - o emissor vive em `globalThis`, para que a rota do webhook e a rota do
     SSE (empacotadas separadamente pelo Next) usem a mesma instância;
   - ao conectar ou reconectar, o SSE manda primeiro o estado atual da
     assinatura, então uma confirmação perdida num reinício é recuperada na
     reconexão.
5. **Conexão só quando há algo aguardando**: QR Pix gerado e não autorizado,
   ou cartão enviado à Stripe sem webhook de ativação ainda. Fora disso,
   nenhuma conexão fica aberta.
6. **Retorno automático ao painel** ~3 s depois da animação, com botão
   "Ir para o painel" para quem não quer esperar.

## `pix-inter-api`

- `enqueueDelivery` continua gravando a entrega em `webhook_deliveries`.
- Depois de processar um webhook do Inter que enfileirou entregas, o
  processador chama `deliverPending` sob o mesmo advisory lock do job de
  entregas (`LOCK_KEYS.deliveries`). Se o lock estiver ocupado, o job em
  andamento ou o do próximo minuto entrega.
- A reconciliação horária também dispara a entrega imediata ao final, quando
  tiver enfileirado algo.

## App: canal de eventos

### Emissor (`src/server/realtime/subscription-events.ts`)

- `publishSubscriptionChange(userId)`: avisa que a assinatura daquele dono
  mudou.
- `subscribeToSubscriptionChanges(userId, listener)`: devolve a função de
  cancelamento da inscrição.
- Instância única guardada em `globalThis`.

Quem publica, sempre depois de gravar a mudança no banco:

- `applyInterPixEvent` quando o resultado é `applied`;
- `applyStripeEvent` quando o resultado é `applied`;
- `reconcileInterPixSubscriptions` para cada assinatura corrigida.

### Rota SSE (`GET /api/subscription/events`)

- Exige sessão; usa o dono do workspace ativo (o mesmo `userId` das ações de
  assinatura).
- Runtime Node, resposta `text/event-stream`, sem cache.
- Ao abrir: envia `state` com o estado atual.
- A cada mudança publicada para esse `userId`: relê a assinatura e envia
  `state`.
- Envia comentário de keep-alive a cada 25 s.
- Fecha sozinha depois de 10 minutos; o `EventSource` do navegador reconecta
  se a tela continuar aberta.

### Formato do evento `state`

```json
{ "status": "PENDING_AUTH", "authorized": false, "provider": "INTERPIX", "plan": "corre", "cycle": "MONTHLY", "nextDueDate": "2026-10-12" }
```

O cliente deriva o resultado:

- **confirmado (Pix)**: `provider = INTERPIX` e `authorized = true`;
- **confirmado (cartão)**: `provider = STRIPE` e `status = ACTIVE`;
- **falhou**: `status = AUTH_DENIED`.

## App: telas

### Hook `useSubscriptionConfirmation(enabled)`

- Abre o `EventSource` só quando `enabled` é verdadeiro.
- Devolve `"waiting" | "confirmed" | "failed"` e os dados do último `state`.
- Fecha a conexão ao desmontar, ou ao chegar em `confirmed`/`failed`.

### Onde liga

- **Checkout, Pix**: depois que o QR é gerado (`result` presente).
- **Checkout, cartão**: depois que `confirmPayment`/`confirmSetup` voltam sem
  erro. A tela deixa de mostrar o toast "assinatura ativa" e de ir para
  `/workspaces/plan`; fica em "Confirmando com a operadora…" até o
  `confirmed`.
- **Plano**: quando o estado é "QR Pix aguardando autorização".

### Animação de confirmação (`SubscriptionConfirmed`)

- Camada sobre o conteúdo: círculo na cor primária com o check desenhado
  (`pwa-draw`) e um "pop" (`pwa-pop`), reaproveitando os keyframes de
  `globals.css`.
- Título "Assinatura confirmada!" e uma linha por método:
  - Pix: "Débito automático autorizado. A primeira cobrança entra em DD/MM.";
  - cartão: "Pagamento aprovado no cartão.".
- Barra de progresso de 3 s (`pwa-progress`) e `router.replace("/dashboard")`
  ao fim; botão "Ir para o painel" faz o mesmo na hora.
- `prefers-reduced-motion`: estado final sem animação, mesmo redirecionamento.

### Falha

`failed` não mostra animação: mensagem de erro ("O banco recusou a
autorização.") e a tela mantém a opção de gerar outro QR.

### Cartão sem confirmação

Se o `confirmed` não chegar em 20 s, a tela troca o texto para "Ainda
confirmando com a operadora. Você pode sair desta tela; avisaremos no painel
quando terminar." e continua ouvindo.

## Fora de escopo

- Notificar em tempo real telas que não estão aguardando confirmação.
- Mais de uma instância do app (o emissor em memória não atravessa
  processos; se o app escalar, trocar a fonte do SSE por `LISTEN/NOTIFY`).
- Push notification fora do app.

## Testes

- `pix-inter-api`: webhook do Inter que aplica autorização dispara a entrega
  ao SaaS na hora (sem esperar o job); com o lock ocupado, a entrega fica
  para o job e não duplica.
- Emissor: inscrição recebe o aviso do próprio `userId` e não o de outro;
  cancelamento da inscrição para de receber; a instância é a mesma entre
  importações.
- Publicação: `applyInterPixEvent`, `applyStripeEvent` e a reconciliação
  publicam só quando aplicam mudança.
- Rota SSE: sem sessão devolve 401; com sessão manda o estado inicial e um
  novo `state` depois de `publishSubscriptionChange`.
- Derivação do resultado (`confirmed`/`failed`/`waiting`) a partir do
  `state`, como função pura.
