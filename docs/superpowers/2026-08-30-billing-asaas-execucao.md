# Registro de execução — billing via Asaas

Plano: `docs/superpowers/plans/2026-08-30-billing-asaas.md`
Branch: `feat/billing-asaas` · 10 tasks · 162 testes · 15 rulings

Este é o ledger de execução preservado. Ele guarda as decisões tomadas
sem consulta durante a execução (as rulings, cada uma com o custo se
estiver errada), os defeitos encontrados nas reviews e o que ficou
conscientemente para depois. A fila de follow-up está no fim.

Spec: docs/superpowers/specs/2026-08-29-multi-tenant-workspaces-design.md (secao 10)
Worktree: /Users/ferrari/code/coolkies-system/.claude/worktrees/billing-asaas
Branch: feat/billing-asaas
Base: 88ecdae

## Setup

- `.env` e `.env.test` copiados do repo principal; `.env` aponta para o Postgres local do Docker, nao para producao
- `npm install` concluido; baseline com 70 testes passando e `tsc --noEmit` limpo

## Pre-flight scan

### Pares de tasks que compartilham arquivo ou interface

| Par | Produz / consome | Achado |
|---|---|---|
| T1 → T3 | model `Subscription`, enum `SubscriptionSource` | OK |
| T1 → T5 | `Subscription.trialEndsAt` | OK |
| **T1 → T4, T5b** | remove `planStatus` de `Workspace`; T1 manda deixar `"TRIALING"` fixo no layout ate a T4 | **Conflito de ordem — ver R1** |
| T2 → T3 | `effectiveLimit(plan, status)` | OK — assinaturas conferem apos a auto-revisao do plano |
| T2 → T5 | `effectiveLimit` no bloqueio de criacao | OK — o import foi explicitado na auto-revisao |
| T2 → T9 | `PLANS`, `planPriceCents`, `planLabel` | OK — `planLabel` acrescentado aos Produces na auto-revisao |
| T3 → T4 | `getSubscription`, `isSubscriptionUsable`, `activeWorkspaceIds` | OK |
| T3 → T5 | `getSubscription` | OK |
| T3 → T9 | `activeWorkspaceIds`, `getSubscription` | OK |
| T4 → T5b | `PlanBanner` e o shell; ambas mexem em `app-shell.tsx` e `(app)/layout.tsx` | **Sobreposicao — ver R2** |
| T6 → T8 | `getAsaasSubscription` | OK |
| T6 → T9 | `createAsaasCustomer`, `createAsaasSubscription`, `brlFromCents` | OK |
| T7 → T8 | ambas leem `Subscription.status`; T7 escreve por webhook, T8 por reconciliacao | OK — T8 filtra `source: ASAAS`, T7 so age sobre assinatura com `asaasSubscriptionId` |
| T8 → scripts/ | reusa `scripts/direct-database-url.ts`, criado no plano anterior | OK — arquivo existe no repo |

### Auto-consistencia de cada task

| Task | Achado |
|---|---|
| T1 | OK — os testes batem com o model especificado |
| T2 | OK apos a auto-revisao do plano, que removeu `isWithinLimit` (virou codigo morto quando `effectiveLimit` a substituiu) |
| T3 | OK — os testes cobrem solo/team/unlimited e a nao-contagem de MEMBER |
| T4 | OK |
| T5 | OK |
| T5b | OK |
| T6 | OK — nenhum teste bate na API real; todos usam `vi.stubGlobal("fetch")` |
| T7 | OK |
| T8 | Sem teste automatizado; o Step 3 pede prova manual de que assinaturas MANUAL sao ignoradas |
| T9 | Sem teste automatizado; e UI + integracao |

### Rulings

Ruling R1: a Task 1 deixa `planStatus="TRIALING"` fixo no layout, e a Task 4 substitui pelo estado real. Isso e degrau intencional, nao defeito: a T1 remove os campos de `Workspace` e a T4 traz a leitura correta pela assinatura do OWNER. Entre as duas, o banner de plano nunca aparece — o que e o comportamento certo, ja que nenhuma assinatura existe ainda. Custo se errado: se a execucao parar entre T1 e T4, o banner fica mudo ate a T4 rodar.

Ruling R2: as Tasks 4 e 5b tocam `app-shell.tsx` e `(app)/layout.tsx`. Executadas em ordem, nao conflitam — a T4 acrescenta `planStatus` real e `isOverLimit`, a T5b acrescenta `daysLeft` e o `TrialBanner` acima do `PlanBanner`. Mantenho a ordem do plano e passo para a T5b a nota de que a T4 ja mexeu nesses arquivos. Custo se errado: retrabalho pequeno de merge manual num dos dois arquivos.

Ruling R3: as Tasks 8 e 9 nao tem teste automatizado, e isso e aceito. A T8 e um script operacional cujo comportamento critico (ignorar `source: MANUAL`) e provado por execucao manual registrada no relatorio; a T9 e UI com integracao externa, cujo teste exigiria dublar a API do Asaas na borda de React Server Components — custo alto para retorno baixo nesta fase. As regras de negocio que importam (limite, excedente, trial, transicao de status) estao cobertas nas Tasks 2, 3, 4, 5 e 7. Custo se errado: uma regressao na tela de assinatura ou no script de reconciliacao passa despercebida ate alguem usar.

## Progresso

Task 1: implementada (commit f4cdcd8), status DONE, 72/72 testes, tsc e lint limpos. Review despachado.
Task 1: o implementador precisou acrescentar `Subscription` a `UNSCOPED_MODELS` em `nested-writes.ts` — a asercao DMMF criada no plano anterior exige que todo model sem `workspaceId` esteja na lista. E o guard-rail funcionando como projetado: um model novo nao entra em silencio.

Task 1: review 1 — spec OK, qualidade aprovada, ZERO achados em qualquer nivel. O revisor conferiu de forma independente: `@unique` em `userId` existe no banco (`CREATE UNIQUE INDEX subscription_userId_key`), os dois ids do Asaas sao nullable, nenhum `DROP TABLE` no SQL, e `grep` por `subscriptionStatus|trialEndsAt|graceUntil` em `src/` retorna zero. Validou tambem que a adicao de `Subscription` a `UNSCOPED_MODELS` era necessaria e semanticamente correta.
Task 1: complete (commits 88ecdae..f4cdcd8, review clean)

Task 2: implementada (commit 7e1b36d), 6/6 testes, tsc e lint limpos.
Task 2: review 1 — spec OK, qualidade aprovada, 0 Critical/Important. O revisor conferiu os precos digito a digito (2990/1990/9990/8990), que o anual e por mes e nao o total, e que o teste do trial cobre os tres planos — nao so `solo`, onde passaria por acidente.
Task 2: minors deferidos — (a) o fallback de plano desconhecido depende de `PLANS[0]` ser `solo` por posicao no array, e nao de busca pelo id; uma reordenacao futura quebraria a regra em silencio. (b) `planLabel` exportado sem teste proprio.
Task 2: complete (commits f4cdcd8..7e1b36d, review clean)

Task 3: implementada (commit ea963b4), 88/88 testes, tsc e lint limpos.

Ruling R5: o teste "ser member nao consome cota", como escrito no brief, nao pega a regressao que nomeia. O implementador verificou removendo o filtro `role: "OWNER"` da query e viu o teste continuar passando — na ordem de criacao do brief, o workspace proprio nasce antes do alheio, entao a ordenacao ascendente sozinha ja mantem o certo. Mandei inverter a ordem de criacao no teste (alheio primeiro, proprio depois) e provar que sem o filtro ele falha. Defeito do brief que eu escrevi, nao da implementacao. Custo se errado: nenhum — a mudanca so fortalece o teste; se a inversao nao produzir a falha esperada, o implementador reporta e eu reavalio.

Task 3: fix round 1/5 (1 addressed; commits ea963b4..9e2325d) — teste reordenado e regressao provada nos dois sentidos: sem o filtro falha com `expected false to be true`, com o filtro passa.
Task 3: review 1 — spec OK, qualidade aprovada, 0 Critical/Important. O revisor raciocinou sobre o teste corrigido em vez de aceitar a afirmacao, e confirmou que a inversao da ordem realmente o faz pegar a regressao. Validou tambem o sentido `asc` da ordenacao, os quatro ramos de `isSubscriptionUsable` e o uso de `effectiveLimit` em vez de `planLimit`.
Task 3: minor deferido — `activeWorkspaceIds` nao chama `isSubscriptionUsable`, entao usuario sem assinatura nenhuma cai no fallback `solo`/`TRIALING` (limite 1) em vez de zero. E por design da task, e a Task 4 compoe as duas em `canWriteInWorkspace`. Verificar la que a composicao fecha isso.
Task 3: complete (commits 7e1b36d..9e2325d, review clean)

Task 4: implementada (commit 08e1ae9), 90/90 testes, tsc e lint limpos. 32 funcoes de escrita em 7 arquivos receberam `assertCanWrite`.
Task 4: review 1 — spec OK, qualidade aprovada, 0 Critical. O revisor percorreu os sete arquivos em vez de aceitar a contagem: 32/32, 1:1 por arquivo, trava sempre antes da escrita, `workspaces.ts` livre (o inadimplente mantem caminho de saida), e verificou que o teste de "sem assinatura" e discriminante — sem a checagem de `isSubscriptionUsable`, `activeWorkspaceIds` devolveria o workspace e o teste falharia.
Task 4: 2 Important despachados no fix round 1 — (a) o banner exibe "somente leitura" para quem esta em carencia e na verdade pode escrever; (b) apagar `assertCanWrite` de qualquer das 32 funcoes nao quebra teste nenhum.
Task 4: minors deferidos — (a) `status: "NONE"` e rotulado como "Assinatura cancelada", impreciso para quem nunca assinou; (b) o nome do teste "workspace sem owner..." nao descreve o que ele testa, e o caso que o nome promete (workspace sem OWNER) fica sem cobertura; (c) `getSubscription` e consultado ~4 vezes por request, porque `canWriteInWorkspace` e `activeWorkspaceIds` o chamam cada uma por conta e `cache()` memoiza so `getWorkspaceContext`.
Task 4: nota de sequenciamento — os links do banner apontam para `/workspaces/plan`, que so passa a existir na Task 9. Ate la o CTA do inadimplente leva a 404. Confirmei no plano que a T9 cria exatamente esse path.

Task 4: fix round 1/5 (2 addressed, 0 open; commits 08e1ae9..f2d91c4) — re-review confirmou que banner e trava leem o MESMO `canWrite` de `getWorkspaceContext()`, sem segunda derivacao que possa divergir; que o texto de carencia deixou de alegar bloqueio; e rastreou a mecanica pela qual o teste de action e discriminante: `createSale` engole excecoes num try/catch e devolve `ok:false`, entao sem a trava o teste falharia por nao haver rejeicao alguma — nao por um erro de FK generico. O teste tambem afirma `sale.count === 0`, provando que nada foi gravado.
Task 4: minor deferido — `getWorkspaceContext` agora roda `canWriteInWorkspace` em toda rota autenticada, inclusive leituras, somando 2-3 queries por request. Levantado pelo implementador e confirmado pelo re-revisor.
Task 4: complete (commits 9e2325d..f2d91c4, review clean)

Task 5: implementada (commit c3275a7), 99/99 testes, tsc e lint limpos.
Task 5: review 1 — spec OK, qualidade aprovada, 0 Critical. O revisor confirmou que o teste de idempotencia discrimina de verdade (um `update` que reatribuisse `trialEndsAt` o faria falhar), que a ordem garante o trial antes da checagem, que a comparacao e `owned + 1`, e que a recusa e estruturalmente incapaz de deixar lixo — a checagem acontece toda antes da transacao.

Ruling R6: corrijo a corrida em `ensureTrialSubscription` em vez de apenas registra-la, contrariando a recomendacao do revisor. Ele classificou como Important mas sugeriu deixar como debito. Duas requisicoes simultaneas do mesmo usuario novo passam ambas pelo `findUnique` nulo e colidem no `create`; a perdedora recebe erro cru do Prisma. Corrijo porque o cenario e plausivel (duplo clique, duas abas, retry de rede) e acontece no onboarding — primeiro contato da pessoa com o produto, onde um erro cru e a pior impressao possivel. A correcao e de poucas linhas. Custo se errado: se a implementacao usar `upsert` com `update` nao-vazio, reabre a porta do trial renovavel — avisei explicitamente no dispatch e o teste de idempotencia pega.

Task 5: fix round 1/5 (1 addressed, 0 open; commits c3275a7..0c00a8c) — o implementador escolheu `try/catch` em vez de `upsert` justamente para nao deixar um `update: {}` que alguem preencheria depois. O re-revisor confirmou que o catch e especifico (`PrismaClientKnownRequestError` + codigo `P2002`) e relanca qualquer outro erro, entao falha real de banco nao e engolida.
Task 5: minor deferido — nao ha teste que reproduza a corrida real; a logica do catch e simples o bastante para revisao estatica dar confianca, e simular concorrencia em teste e caro e fragil.
Task 5: complete (commits f2d91c4..0c00a8c, review clean)

Task 5b: despachada com a nota do R2 — as Tasks 4 e 5b tocam `app-shell.tsx` e `(app)/layout.tsx`, e a 4 ja alterou os dois. O dispatch manda ler o estado atual antes de editar, em vez de reescrever a partir do que o brief mostra.

Task 5b: implementada (commit ef57a18), 104/104 testes, tsc e lint limpos.
Task 5b: DOIS defeitos do meu brief, ambos achados pelo implementador e confirmados pelo revisor. (a) A implementacao de `daysUntil` que escrevi falha os testes que eu mesmo escrevi: `Math.floor(18h/24h)` da 0, mas o teste espera 1. (b) O Step 6 mandava ler a assinatura do usuario logado; o certo e ler a do dono do workspace ativo, senao quem e membro do negocio de outra pessoa ve o proprio trial em vez do daquele negocio. Ambos aprovados no review.
Task 5b: review 1 — NAO aprovada. 1 Important: `daysUntil` compara dia-calendario em UTC num app UTC-3, entao todas as noites das 21h a meia-noite BRT a contagem fica um dia adiantada — inclusive exibindo "termina hoje" um dia antes. O revisor notou que o projeto ja tem convencao para isso (`business-days.ts` usa metodos locais) e ja tem `date-fns-tz` instalado, entao `trial.ts` virou a unica parte que ignora o fuso.
Task 5b: fix round 1/5 despachado — corrigir o fuso e acrescentar teste que cruze a fronteira das 21h BRT, que e o que teria pego isso antes do review.

Task 5b: fix round 1/5 (2 addressed, 0 open; commits ef57a18..950061c) — `date-fns-tz` com `America/Sao_Paulo` literal no codigo, nao vindo de `TZ` do processo; o re-revisor testou sob tres fusos diferentes e obteve o mesmo resultado. Validou o teste de fronteira calculando os instantes a mao: 21h30 BRT de 01/09 e 19h de 02/09 caem no MESMO dia UTC (02/09) e em dias diferentes em Brasilia, entao a implementacao antiga daria 0 — o teste prova a regressao de verdade. Os cinco testes originais ficaram intactos.
Task 5b: complete (commits 0c00a8c..950061c, review clean)

=== FASE 1 COMPLETA === Tasks 1, 2, 3, 4, 5, 5b. 105 testes. Assinatura por usuario, limites por plano, trava de escrita, trial de 14 dias e contagem regressiva. Nada ainda toca o Asaas.

Task 6: implementada (commit 0615f79), 109/109 testes, tsc e lint limpos. Status DONE_WITH_CONCERNS.

Ruling R7 (IMPORTANTE PARA O PRODUTO): o Pix Automatico nao esta sendo ativado pelo codigo, e removo o campo que finge ativa-lo. O implementador verificou a documentacao vigente em 2026-08-30 e achou que `paymentCreationMode` nao pertence a `POST /v3/subscriptions` — a lista de campos daquele endpoint nao o inclui. Ele pertence a `POST /v3/pix/automatic/authorizations`, um endpoint separado com fluxo proprio, em que o pagador autoriza o debito no app do banco. Meu brief veio de uma pesquisa anterior que interpretou um changelog do Asaas; a doc atual contradiz.

Mandei remover o campo em vez de mante-lo: um campo ignorado em silencio faz o codigo parecer que ativa cobranca recorrente automatica quando so cria cobranca Pix por ciclo, que a pessoa paga manualmente. Codigo honesto vale mais que a aparencia da funcionalidade.

Custo se errado: se a doc estiver incompleta e o campo funcionar de fato, perdemos o Pix Automatico ate alguem implementar o fluxo de autorizacao — mas o sistema continua cobrando por Pix, so que manual. Se eu tivesse mantido e nao funcionasse, acreditariamos ter cobranca automatica e descobririamos pela inadimplencia dos clientes.

CONSEQUENCIA DE PRODUTO: o Pix Automatico foi a razao de escolher Asaas em vez de Stripe (MDR 0,4-1,2% contra 3-4,5%). Ate o fluxo de autorizacao existir, a cobranca e Pix comum por ciclo. Isso precisa chegar ao dono do produto — nao e detalhe tecnico.

Task 6: fix round 1/5 (1 addressed; commits 0615f79..55e00be) — campo removido, pesquisa documentada com URLs no relatorio.
Task 6: review 1 — spec OK, qualidade aprovada, ZERO achados em qualquer nivel. O revisor calculou `brlFromCents` em Node para os quatro valores reais dos planos (nenhum erro de ponto flutuante), confirmou que a comparacao de ambiente e estrita contra `"production"` (qualquer typo cai no sandbox), que a chave nunca entra em mensagem de erro, e varreu `src/` atras de outras conversoes de centavos ligadas a preco de plano — nao ha duplicacao.
Task 6: complete (commits 950061c..55e00be, review clean)

Task 7: implementada (commit 436e81e), 113/113 testes, tsc e lint limpos. Migration nasceu limpa — R4 funcionou.
Task 7: review 1 — NAO aprovada. 1 Critical, 3 Important.

Task 7 C1 (Critical): `src/middleware.ts` intercepta `/api/webhooks/asaas` e redireciona para `/sign-in`. O revisor rodou a regex real do matcher e provou. O Asaas nao manda cookie de sessao, entao o handler NUNCA executa em producao e o gateway reenfileira para sempre. `api/auth` esta na lista de excecoes justamente porque alguem ja soube desse problema; ninguem lembrou da rota nova. Defeito do meu plano — nao previ o middleware.

Task 7 I3 (Important): TOCTOU na idempotencia — duas entregas simultaneas do mesmo evento passam ambas pelo `findUnique` e a segunda colide na PK, virando 500 para um evento aplicado com sucesso. E o MESMO defeito do Ruling R6 na Task 5. Mando corrigir do mesmo jeito, por consistencia do plano.

Task 7 I4 (Important): a rota nao tem teste nenhum. Os quatro testes chamam `applyPaymentEvent` direto. Um teste de rota teria pego o C1.

Ruling R8 (I2 do review): mantenho o registro do evento no ramo de assinatura desconhecida, e a rede de protecao e a reconciliacao da Task 8. O revisor apontou um buraco real: se um `PAYMENT_CONFIRMED` chegar antes de o `asaasSubscriptionId` ser gravado — corrida plausivel, a pessoa paga o Pix antes de o checkout retornar —, o evento e marcado como processado e perdido, e quem pagou nunca vira ACTIVE. A alternativa sugerida (nao gravar nesse ramo) nao resolve sozinha, porque o Asaas so reenvia em resposta nao-2xx. Custo se errado: um cliente que pague nessa janela fica sem ativacao ate a reconciliacao diaria rodar. Vou confirmar explicitamente no dispatch da Task 8 que ela cobre esse caso.

Task 7: minors deferidos — (a) eventos nao tratados retornam `"applied"` sem aplicar nada, rotulo desonesto no log; (b) `asaasSubscriptionId` sem indice, entao todo webhook faz varredura sequencial, e sem `@unique`, entao `findFirst` escolheria em silencio se houvesse duplicata; (c) `currentPeriodEnd` parseia em UTC, inconsistente com a convencao de fuso adotada na T5b, e semanticamente guarda o vencimento ja pago em vez do fim do periodo seguinte — hoje inerte, nada le esse campo; (d) o cast do corpo da requisicao nao valida nada; (e) JSON malformado vira 500.
Task 7: fix round 1/5 despachado — C1, I3 e I4.

Task 7: fix round 1/5 (3 addressed, 0 open; commits 436e81e..917332c) — o re-revisor rodou a regex do matcher nos quatro casos: `/api/webhooks/asaas` e `/api/auth/session` escapam, `/dashboard` e `/sales` seguem protegidos. A correcao nao abriu o app. O catch de P2002 cobre os quatro pontos de escrita em `processed_webhook_event`, nao so um. Os testes de rota montam `NextRequest` real e afirmam status code.
Task 7: complete (commits 55e00be..917332c, review clean)

Task 8: implementada (commit 519f929), tsc e lint limpos, 117/117 testes, prova manual do Step 3 com saida real — a assinatura MANUAL nao aparece em nenhuma linha do log e o resumo diz `verificadas: 1` com duas linhas na tabela.
Task 8: review 1 — spec OK, qualidade aprovada, 0 Critical. O revisor confirmou o filtro como primeiro criterio, o `try/catch` dentro do laco, e que `CANCELED` nunca e reescrito.
Task 8: o implementador confirmou o buraco do R8 e apontou algo que muda a Task 9 — hoje NADA grava `asaasSubscriptionId`; a escrita e da Fase 3 e precisa ser sincrona na criacao da assinatura, independente do webhook, senao o buraco fica aberto para sempre em vez de so ate a proxima reconciliacao. Carregar isso no dispatch da Task 9.

Ruling R9: a reconciliacao deixa de tratar status desconhecido como inadimplencia. O mapeamento do meu brief era `remote.status === "ACTIVE" ? ACTIVE : PAST_DUE`, sobre um campo tipado como `string` puro — entao qualquer valor imprevisto (um `EXPIRED`, um status novo numa versao futura da API, diferenca de caixa) marcaria como devedor um cliente em dia e travaria a escrita dele. Passa a ser lista explicita nos dois sentidos, e o que nao estiver em nenhuma nao altera nada, so registra. Uma rotina que roda todo dia sem ninguem olhando nao deve ter poder de travar cliente por um valor que ninguem reconheceu. Custo se errado: alguem inadimplente com status fora da lista continua escrevendo ate alguem notar — recuperavel, ao contrario de travar quem pagou.

Task 8: minor incluido no mesmo fix — o resumo nao somava falhas, obrigando o operador a contar linhas de erro a mao numa saida de cron.

Task 8: fix round 1/5 (2 addressed, 0 open; commits 519f929..23b80c1) — status desconhecido agora nao escreve nada, so registra. O re-revisor buscou a documentacao do Asaas por conta propria e confirmou de forma independente: o enum tem so ACTIVE/EXPIRED/INACTIVE, e nenhum dos dois ultimos significa inadimplencia — atraso vive no nivel da cobranca, nao da assinatura. A lista de status que marcam PAST_DUE ficou vazia, e isso e coerente com o que a API expoe, nao omissao.

Ruling R10 (assimetria da rede de seguranca): registro como limitacao conhecida. Com a lista de PAST_DUE vazia, a reconciliacao so tem poder de ATIVAR. Entao: `PAYMENT_CONFIRMED` perdido e resgatado pela rotina diaria; `PAYMENT_OVERDUE` perdido nao tem resgate nenhum — o cliente inadimplente fica ACTIVE indefinidamente. O re-revisor observou, com razao, que o heuristico antigo nunca foi um detector confiavel de inadimplencia (so dispararia em EXPIRED/INACTIVE, que nao sao atraso), entao o fix nao abriu buraco novo — removeu uma falsa sensacao de protecao. Custo se errado: um inadimplente segue usando ate alguem perceber. Mitigacao futura: reconciliar pelas COBRANCAS (payments), que e onde o atraso vive de verdade, em vez da assinatura; e monitorar entrega do webhook. Entra como follow-up, nao bloqueia.
Task 8: complete (commits 917332c..23b80c1, review clean)

Task 9: implementada (commit 61f8b52), 126/126 testes, tsc, lint e build limpos. O implementador pegou mais um defeito do meu brief — o codigo da action importava `@/lib/db` direto, violando a regra de lint — e moveu o acesso para `tenant/`.
Task 9: review 1 — NAO aprovada. 1 Critical, 2 Important. O revisor refez a conta do valor a partir do codigo e confirmou os quatro casos (solo anual chega como R$ 238,80, multiplicacao em centavos, divisao so em `brlFromCents`), confirmou a gravacao sincrona do id e que o status nunca vira ACTIVE na contratacao.

Task 9 C1 (Critical): reassinar cria uma SEGUNDA assinatura no Asaas e orfana a primeira. `subscribe` chama `createAsaasSubscription` incondicionalmente e o upsert sobrescreve o id anterior. Tres consequencias rastreadas ate o codigo: duas cobrancas Pix recorrentes ativas; os webhooks da antiga caem no ramo `!sub`, sao gravados como processados e descartados para sempre; e a orfa e invisivel para a reconciliacao, que so consulta o id armazenado. Nao ha nem funcao de cancelamento em `asaas.ts` para limpar. O implementador havia registrado isso como preocupacao de UX — o custo real e cobranca duplicada em cliente real, sem trilha de volta.

Task 9 I1: `plan` e `cycle` nao sao validados. `findPlan` faz fallback silencioso para o primeiro plano, entao input adulterado cobra o preco do solo e grava valor inexistente no banco.
Task 9 I2: erros de infraestrutura vazam para o toast do cliente — com a chave ausente, a pessoa le "ASAAS_API_KEY nao configurada".
Task 9: minors deferidos — (a) a mensagem promete validar CPF/CNPJ mas so confere comprimento; (b) a descricao da cobranca usa o id cru do plano em vez de `planLabel`; (c) o reaproveitamento de `asaasCustomerId` esta correto mas sem teste; (d) cor do aviso divergente da convencao do projeto.
Task 9: fix round 1/5 despachado — C1, I1 e I2.

Ruling R4: o comando de geracao de migration do plano precisa descartar stderr. O implementador relatou que o banner de warning do Prisma (`package.json#prisma` deprecado) foi capturado dentro do `migration.sql`, quebrando a aplicacao com P3018; ele limpou o SQL, rodou `migrate resolve --rolled-back` e reaplicou. A Task 7 tambem gera migration e cairia no mesmo buraco, entao o dispatch dela leva a instrucao de usar `2>/dev/null` e conferir que o arquivo comeca com `--`. Custo se errado: outra migration nasce com lixo no topo e falha na aplicacao — recuperavel, mas custa uma rodada.
Task 9: fix round 1/5 (3 addressed, 1 REGRESSAO NOVA; commits 61f8b52..34a0dfa) — o Critical original e os dois Importants foram fechados e bem provados: o teste do C1 afirma `expect(fetchMock).not.toHaveBeenCalled()` com `ASAAS_API_KEY` presente no ambiente, entao a unica razao de o gateway nao ser chamado e o guard, nao falta de chave. `createAsaasSubscription` tem call site unico em todo o `src/`. MAS o fix introduziu um Critical novo: `isCurrent = currentPlan === plan.id` desabilitava "Contratar" para todo usuario em trial, porque `ensureTrialSubscription` grava `plan: "solo"` com `asaasSubscriptionId: null` — nenhum usuario novo conseguia pagar, e o beco sem saida aparecia exatamente quando o trial expirava e a pessoa ia quitar. Junto: trocar so de ciclo (solo mensal -> solo anual) ficou impossivel pela tela, porque `isCurrent` e `isSwitchingPlan` ignoravam o ciclo.

Ruling R11 (a correcao de um Critical merece a mesma suspeita que o codigo original): o round 1 fechou o buraco certo e abriu outro do mesmo tamanho, no caminho mais importante do produto — o checkout. A licao registrada no processo: quando um fix adiciona uma condicao que BLOQUEIA uma acao, o re-review tem que percorrer a matriz de estados que chegam nessa condicao, nao so confirmar que o caso abusivo foi barrado. Foi so por ter perguntado explicitamente "a troca de plano legitima continua funcionando?" que a regressao apareceu antes de ir para producao. Custo se errado: receita zero com a tela parecendo saudavel — nenhum erro, nenhum log, so um botao desabilitado.

Task 9: fix round 2/5 (commit 63879d4, 134/134 testes, tsc/lint/build limpos) — `isCurrent` passa a exigir `hasAsaasSubscriptionId && plano bate && ciclo bate`; `isSwitchingPlan` ganhou a comparacao de ciclo. Teste de servidor novo cobre trial sem `asaasSubscriptionId` contratando. Re-review escopado despachado (opus): fechamento da regressao, prova de que afrouxar a UI nao reabriu o caminho de assinatura duplicada no servidor, matriz de seis estados (incluindo assinatura MANUAL sem id no gateway) e se o teste novo falharia contra o codigo do round 1.

Task 9: minors deferidos no round 2 — (e) o guard nao e transacional, entao duas submissoes concorrentes do primeiro `subscribe` ainda podem criar duas assinaturas remotas (a UI desabilita o botao enquanto pending, o que cobre o duplo-clique numa aba); (f) linhas legadas de Subscription receberam `cycle: MONTHLY` pelo default da migration, mesmo quem contratou anual — inalcancavel pela UI hoje, mas pede backfill se houver assinatura anual em producao; (g) o guard trata `asaasSubscriptionId` presente como "ativa" sem olhar `status`, entao se o cancelamento passar a ser gravado, o cliente cancelado nao conseguira voltar.

Task 9: fix round 2/5 (regressao fechada, 0 open; commits 34a0dfa..63879d4) — o re-revisor percorreu a trilha do banco ate a prop e confirmou que `hasAsaasSubscriptionId` vem de `getSubscription` sem `select`, com call site unico de `PlanPanel`. O Critical do round 1 continua fechado: `createAsaasSubscription` mantem call site unico e o guard nao foi tocado pelo round 2, entao afrouxar a UI nao reabriu o caminho de duplicata. O caso (f) que eu tinha levantado — assinatura MANUAL — ja estava coberto por um ramo anterior em `plan-panel.tsx:157`: com `source === "MANUAL"` a grade inteira nao e montada, so o aviso, entao nao existe "Contratar" para quem recebeu plano a mao. A checagem e por `source`, nao por `asaasSubscriptionId`, que e o criterio certo.

Ruling R12 (a regressao segue sem rede): o teste novo prova que o caminho do trial contrata, mas NAO falharia contra o codigo do round 1 — a action nunca teve o bug, ele era 100% de UI, e o projeto nao tem harness de teste de componente. Aceito assim mesmo em vez de montar harness agora: a alternativa e abrir uma frente de infraestrutura de teste no meio de um plano de billing. Fica como o primeiro item da fila de follow-up, com o custo nomeado — qualquer edicao futura em `isCurrent`/`isSwitchingPlan` pode reintroduzir "nenhum usuario novo consegue pagar" sem nada acusar. Custo se errado: a regressao volta em silencio numa refatoracao de UI.

Ruling R13 (orfanamento na troca de plano/ciclo fica parqueado, nao bloqueia): trocar de plano — e agora tambem so de ciclo, superficie que o round 2 ampliou — cria a assinatura nova e deixa a anterior ativa no Asaas, sem funcao de cancelamento no codigo. Verifiquei o texto do aviso antes de decidir: ele diz literalmente que a anterior "continua sendo cobrada ate ser cancelada manualmente pela nossa equipe" e exige checkbox. Isso e limitacao declarada ao usuario no momento da decisao, nao cobranca dupla silenciosa — a diferenca que importa. Custo se errado: cliente que troca de plano paga os dois ate alguem cancelar no painel do Asaas, com a defesa de ter lido e confirmado. Primeiro item tecnico da fila: `cancelAsaasSubscription` chamada apos a criacao bem-sucedida da nova.

Task 9: minor novo parqueado — `isCurrent` tambem nao olha `status`, entao uma linha CANCELED com `asaasSubscriptionId` preenchido mostraria badge "Atual", botao travado e a mensagem falsa "voce ja tem uma assinatura ativa". Latente: nenhum caminho grava CANCELED hoje. Vira real no mesmo dia em que o cancelamento existir — entao a correcao do status no guard e na UI tem que andar junto com o item do R13, nao depois.
Task 9: complete (commits 61f8b52..63879d4, review clean)

TODAS AS 10 TASKS COMPLETAS. Proximo: review final do branch inteiro (88ecdae..HEAD, 2337 insercoes em 45 arquivos) no modelo mais capaz.

=== REVIEW FINAL DO BRANCH (88ecdae..63879d4, 3699 linhas) — NAO PRONTO, 2 Criticals ===

Verificacao independente minha antes de despachar correcao: 134/134 testes, `tsc` limpo, lint limpo — numeros conferidos por mim, nao herdados do relatorio do implementador. Nenhuma dependencia nova no branch (so um script no package.json), entao o `pnpm-lock.yaml` nao precisa de atualizacao e o build do Coolify nao repete a falha de lockfile.

CF-C1 (CONFIRMADO POR MIM lendo o codigo): o deploy derruba a producao. A migration `20260830193949` faz DROP das quatro colunas de assinatura de `workspace` e cria `subscription` VAZIA. O unico produtor de linha em `subscription` e `ensureTrialSubscription`, com call site unico em `createWorkspaceForUser:118` — so roda para workspace NOVO. Na producao o workspace ja existe e ninguem cria outro: `getSubscription` devolve null, `isSubscriptionUsable(null)` e false, `canWriteInWorkspace` e false, e as 32 actions de escrita passam a lancar "somente leitura". O negocio para de registrar venda no minuto do deploy, sem erro de build e sem rollback trivial — as colunas antigas foram destruidas no mesmo passo. Este e o achado mais caro de toda a execucao do plano e nenhuma das 10 reviews por task o pegou, porque ele nao mora dentro de task nenhuma: mora entre a migration e o runtime.

CF-C2 (CONFIRMADO POR MIM): a reconciliacao desfaz a decisao do webhook. `reconcile-status.ts:3` mapeia `ACTIVE` remoto -> `ACTIVE` local e `reconcile-subscriptions.ts:32` grava sempre que difere, exceto CANCELED. Mas no Asaas a assinatura nasce ACTIVE antes de qualquer pagamento — inadimplencia vive na cobranca, nao na assinatura, conforme o proprio relatorio da T8 documentou. Entao: quem contrata e nunca paga e promovido de TRIALING para ACTIVE e usa de graca; e o inadimplente marcado PAST_DUE pelo webhook volta para ACTIVE na primeira rodada, com o proximo evento capaz de re-marcar so no ciclo seguinte (ate 12 meses no anual). O ledger tinha parqueado isso como "so ativa, nunca marca inadimplente" (R10); o conjunto mostra que e pior que o enunciado — ela nao deixa de marcar, ela DESMARCA, e e sempre a ultima a escrever.

Ruling R14 (usuarios pre-billing ganham assinatura MANUAL ativa, nao trial): na correcao do C1, todo OWNER existente recebe `source: MANUAL`, `status: ACTIVE`, plano dimensionado pela quantidade de workspaces que ja possui. Poe-los em trial de 14 dias iniciaria uma contagem regressiva para o negocio da propria dona ser travado, e em momento nenhum foi dito que os usuarios existentes passariam a pagar. Bonus: exercita o caminho MANUAL que a spec exige e que ate agora nao tinha nenhum produtor no codigo. Custo se errado: o dono concede acesso gratuito a si mesmo — revogavel com um UPDATE, que e exatamente o caminho manual que a spec desenhou.

O que a review confirmou como correto (vale registrar, porque foi verificado uma por uma): as 32 actions de escrita passam por `assertCanWrite()` ANTES de qualquer chamada ao banco, com a tabela nominal no relatorio; `assertCanWrite` e `getScopedDb` derivam do mesmo `getWorkspaceContext` memoizado, entao nao ha TOCTOU entre checar plano e escopar query; a assinatura e sempre resolvida pelo OWNER do workspace, nunca pelo usuario da sessao; dinheiro fica em centavos ate a fronteira (solo anual = R$238,80, team anual = R$1.078,80, batem com a spec); o webhook autentica antes de ler o corpo, com quatro testes que provam isso sem tocar no banco; zero `any` e zero comentario inline no codigo novo.

Onda unica de correcao despachada (opus): C1, C2, I3 (subscribe sobrescreve MANUAL no servidor — o bloqueio existia so no JSX), I5 (ASAAS_ENV cai para sandbox em silencio = receita zero com a tela saudavel), I1 (banner de trial vaza estado de cobranca do dono e vende assinatura inutil ao MEMBER), I6 (regra do "mais antigo" sem desempate, oscila entre requisicoes), I2 (trial vencido conta tres historias diferentes, sendo que uma delas e a tela onde a pessoa pagaria).

Onda de correcao final: 7 achados corrigidos, um commit por achado (bf2e9f3 C1, 7fcc9b9 C2, 68b0fd0 I3, f4f1aca I5, c5a87b5 I6, 41bc20e I1, 538884f I2). Verificacao independente minha: 162/162 testes em 20 arquivos (baseline 134/19), tsc limpo, lint limpo.

Verificacoes minhas antes de aceitar: (a) o implementador relatou ter sobrescrito acidentalmente `subscription.test.ts` e restaurado via --amend — comparei os nomes de teste entre 63879d4 e HEAD e os 13 originais estao intactos, com 1 novo somado, restauracao limpa; (b) li a migration de backfill: idempotente por `NOT EXISTS`, agrupa por `userId`, dimensiona o plano por `COUNT(*)`, e comeca com `--` (o buraco do P3018 do R4 nao se repetiu); (c) confirmei que o Postgres local e 16, entao `gen_random_uuid()` e nativo — PENDENTE verificar que o Postgres da VPS de producao e 13+, senao a migration falha na aplicacao. Isso entra no runbook de deploy como checagem previa.

O implementador reportou cinco defeitos do MEU brief, tres deles procedentes:
- O brief do C2 tinha duas frases contraditorias sobre `PAST_DUE` + cobranca paga. A leitura dele estava certa: promover COM evidencia de pagamento e o resgate que justifica a rotina; o que eu queria proibir era promover a partir do status da assinatura, que nao prova pagamento. Confirmei.
- O brief do I6 pedia um teste que nao e falseavel neste banco: ele removeu a correcao e o teste continuou verde, porque o planner usa Index Scan + Sort que preserva a ordem de `workspaceId`. Ele testou removendo a correcao em vez de presumir, que e a verificacao certa. Aceito como contrato documentado, nao como rede.
- O brief do I1 pedia `canManage`, que inclui ADMIN — e o estrago vale para ADMIN tambem, porque a cota conta por OWNER. Erro meu de recorte, mesma classe do C1 da revisao final do plano 1 (recorte herdado sem questionar). Despachei o aperto: banner de trial e CTAs de cobranca ficam OWNER-only, e o conceito de "administra o workspace" passa a ser separado de "responde pela assinatura".

Ruling R15 (a reconciliacao passa a exigir evidencia de pagamento e nunca rebaixa): implementada a consulta de cobrancas (`GET /v3/payments?subscription=`) em vez da versao so-relatorio. So promove a ACTIVE quando existe cobranca RECEIVED/CONFIRMED cobrindo o ciclo corrente; `ACTIVE` local sem cobranca paga vira linha de divergencia, nao rebaixamento automatico. Custo se errado: um inadimplente cuja cobranca esteja num estado que eu nao mapeei continua ativo e aparece como divergencia no log — visivel, ao contrario do buraco anterior, que era silencioso nos dois sentidos.

Aperto do I1 feito por mim (commit ec115df), porque o agente da onda bateu no limite de uso antes de grava-lo — verifiquei que HEAD continuava em 538884f e nada se perdeu. `canManage` (OWNER+ADMIN) virou `canManageBilling` (OWNER) nos dois banners, e o texto passou a nomear "o dono da conta" em vez de "quem administra a conta". A gestao de membros em `workspaces/members/page.tsx` mantem `canManage` com OWNER+ADMIN, que e a separacao correta: administrar o workspace e uma coisa, responder pela assinatura e outra. Verificado por mim: 162/162 testes, tsc, lint e build limpos.

Re-review escopado da onda inteira despachado (opus, 63879d4..ec115df, 8 commits): correcao real de cada achado, ausencia de buraco novo (a onda anterior deste branch fechou um Critical e abriu outro, entao a suspeita e justificada), e com peso na migration que toca producao — idempotencia, uma linha por usuario, dimensionamento do plano batendo com `plans.ts`, e sobretudo o trace de `canWriteInWorkspace` com a linha criada, para provar que o dono REALMENTE volta a escrever.

PENDENTE DE DEPLOY (nao bloqueia o merge, mas bloqueia o deploy): confirmar que o Postgres da VPS de producao e 13+, senao `gen_random_uuid()` nao existe e a migration de backfill falha na aplicacao. O Postgres local e 16.

Re-review da onda: APROVADO, PRONTO PARA MERGE. O revisor confirmou o que mais me preocupava na migration: ela roda o SQL real do disco no teste (nao uma reimplementacao) e afirma `canWriteInWorkspace` antes e depois, com o trace completo — status ACTIVE passa no primeiro if de `isSubscriptionUsable`, `effectiveLimit` cabe nos tres degraus, e como a checagem e ancorada no OWNER do workspace as funcionarias MEMBER voltam a escrever junto. E INSERT puro, sem UPDATE/DELETE/DDL, e quem ja tem assinatura nao e tocado. A janela de indisponibilidade nao existe porque o `migrate deploy` roda no start command, antes de o app subir.

Confirmado tambem: a reconciliacao nunca escreve rebaixamento (a unica escrita e `ACTIVE` sob `activate`), a matematica de cobertura erra na direcao conservadora no fuso (encurta a janela em ate 3h, nunca alonga), e o filtro `source: "ASAAS"` deixa as linhas MANUAL do backfill fora do alcance da rotina — bom acoplamento entre C1 e C2. A troca canManage->canManageBilling nao suprimiu informacao: o bloco de aviso continua renderizando para MEMBER e ADMIN nos tres ramos, so o botao inocuo sumiu.

Consequencia de projeto a confirmar com o dono (nao e defeito, e o R14 + I3 se somando): todo dono pre-billing fica com plano MANUAL gratuito E sem autoatendimento para contratar — para assinar de verdade precisaria de intervencao no banco. Para o caso real (o proprio dono e a Jenifer) isso e o desejado; registro para ficar explicito.

---

## Fila de follow-up

Ordenada por consequência, não por esforço.

1. **`cancelAsaasSubscription` na troca de plano ou ciclo.** Hoje a
   assinatura anterior continua cobrando no Asaas e o
   `asaasSubscriptionId` antigo é sobrescrito, então os pagamentos dela
   passam a não ter dono: caem no ramo de assinatura desconhecida, são
   gravados como processados e descartados. O caso ruim é o cliente que
   paga a cobrança errada — a antiga, que é a que está no app do banco
   dele — e fica bloqueado mesmo tendo pago. Mitigado hoje por aviso
   explícito e checkbox obrigatória, não por código. Ao corrigir,
   preservar os ids antigos para que nenhum pagamento fique órfão.

2. **Incluir `status` no guard de reassinatura e em `isCurrent`.** Deve
   andar junto com o item 1: hoje nada grava `CANCELED`, mas no dia em
   que o cancelamento existir, um cliente cancelado não conseguirá
   voltar e verá "você já tem uma assinatura ativa", que será falso.

3. **Harness de teste de componente, começando pelo `PlanPanel`.** A
   regressão que travou o checkout inteiro (nenhum usuário novo
   conseguia pagar) era 100% de UI e nenhum teste do projeto a pegaria.
   Enquanto não existir, qualquer edição em `isCurrent` ou
   `isSwitchingPlan` pode reintroduzi-la em silêncio.

4. **Agendar a reconciliação.** O script existe e é seguro (só promove
   com evidência de pagamento, nunca rebaixa), mas nada o executa.

5. **Detectar inadimplência pelas cobranças, não pela assinatura.** Um
   `PAYMENT_OVERDUE` perdido não tem hoje nenhuma rede: o cliente segue
   ativo indefinidamente. O atraso vive no nível da cobrança.

6. **Tratar estorno e chargeback** (`PAYMENT_REFUNDED`,
   `PAYMENT_CHARGEBACK_*`): hoje um estorno deixa o cliente ativo para
   sempre.

7. **Entrada de navegação permanente para a tela de assinatura.** Ela só
   é alcançável pelos banners, e os banners somem quando está tudo em
   dia — então o cliente adimplente não chega na própria assinatura.

8. **Pix Automático** (`POST /v3/pix/automatic/authorizations`), com o
   fluxo de autorização no app do banco. Ver ruling R7.

9. **Limpeza de lockfiles.** Três lockfiles versionados
   (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) e o deploy usa
   pnpm. Já quebrou um build.

10. **Backfill de `cycle`** para assinaturas anuais anteriores à coluna,
    se houver alguma em produção.

## Antes do deploy

- Confirmar que o Postgres da VPS é 13+ (`SELECT version();`). A
  migration de backfill usa `gen_random_uuid()`, nativo a partir do
  PG13. Como o `migrate deploy` roda no start command, uma migration que
  falhe trava os deploys seguintes.
- Definir `ASAAS_ENV` no Coolify. Agora a ausência lança erro em vez de
  cair em sandbox silenciosamente — que é o comportamento desejado, mas
  torna a variável obrigatória.
- Definir `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN`, e cadastrar a URL do
  webhook no painel do Asaas.
