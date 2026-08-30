# Runbook: migration multi-tenant em produção (Douce Vie)

Este runbook aplica em produção o trabalho já validado localmente: workspace por
tenant, `workspaceId` obrigatório em todas as tabelas de domínio, uniques e índices
compostos por workspace.

Produção hoje **não tem nenhuma das três migrations novas aplicadas**. O ponto de
partida é o schema antigo, single-tenant.

## A ordem, em uma tela

A ordem abaixo não é negociável. Cada passo depende do anterior, e três das
dependências não são óbvias — estão explicadas na seção "Por que esta ordem" no
fim do documento.

A numeração abaixo é a das seções deste documento.

| # | Passo | Por que aqui |
|---|-------|--------------|
| 2 | Entrar em janela de manutenção | Nenhuma escrita pode entrar com `workspaceId` NULL depois do backfill |
| 3 | Dump completo + contagens de referência | Único caminho de volta a partir do passo 8 |
| 4 | Aplicar **apenas** a migration aditiva | Cria `Workspace`/`Member`/`Invitation` e a coluna opcional |
| 5 | Rodar o backfill | Preenche `workspaceId` e cria o workspace + memberships |
| 6 | Deployar o código da Fase 3 | Só agora `member` existe **e** tem linhas para resolver o contexto |
| 7 | Rodar `verify:backfill` | Trava bloqueante antes do passo irreversível |
| 8 | Aplicar o aperto + os índices | Torna `workspaceId` NOT NULL |
| 9 | Confirmar sucesso e sair da manutenção | — |

> **O erro que este runbook existe para evitar:** deployar o código da Fase 3
> antes do passo 4. Esse código chama `db.member.findFirst()` em toda requisição
> autenticada, e a tabela `member` só passa a existir na migration aditiva.
> Deployar antes derruba o app inteiro — não é uma degradação parcial, é 500 em
> qualquer página autenticada.

## 1. Pré-requisitos: qual conexão usar

Use sempre `DIRECT_URL` — a conexão **direta** ao Postgres, na porta **5432**.
**Nunca** use o pooler (porta 6543, `DATABASE_URL`) para dump, backfill ou
migration.

Por quê: o pooler roda em modo *transaction* com `connection_limit=1`. Ele não
sustenta uma sessão longa nem múltiplas conexões simultâneas, que é exatamente o
que `pg_dump`, o script de backfill (que abre uma transação com `timeout: 120000`)
e o `prisma migrate deploy` precisam. Rodar qualquer um desses comandos contra o
pooler pode travar a conexão ou cortá-la no meio, deixando o banco em estado
inconsistente.

Os scripts `npm run backfill` e `npm run verify:backfill` já garantem isso
internamente: eles abrem o `PrismaClient` com `datasources.db.url` apontando
para `DIRECT_URL` (com fallback para `DATABASE_URL` só se `DIRECT_URL` não
estiver definida — veja `scripts/direct-database-url.ts`), então usam sempre a
conexão direta independentemente de qual variável o restante do ambiente
carregou por último. Isso não muda a necessidade de cuidado nos comandos
manuais abaixo (`pg_dump`, `psql`, `prisma migrate deploy`), que continuam
lendo a variável de ambiente do shell diretamente — só nos scripts do projeto.

**Cuidado com qual `.env` está em jogo — dois mecanismos diferentes:**

- `npm run backfill` e `npm run verify:backfill` rodam via
  `dotenv -e .env -- tsx ...` (veja `package.json`). Isso lê o **arquivo
  `.env` na raiz do projeto, no disco**, não variáveis exportadas no shell.
  Antes de rodar qualquer um dos dois, confirme com `cat .env | grep -E
  'DIRECT_URL|DATABASE_URL'` que o arquivo tem as credenciais de **produção**
  — e não as de desenvolvimento local que normalmente ficam lá. Rodar o
  backfill com o `.env` local ainda no lugar aplica tudo no banco local, sem
  aviso.
- `pg_dump`, `psql` e `npx prisma migrate deploy` (passos 3, 4 e 8) usam a
  variável `$DIRECT_URL` exportada no **shell**, não o arquivo. Exporte-a
  explicitamente antes desses comandos, por exemplo lendo o mesmo `.env` de
  produção: `set -a; source .env; set +a` — e confira com `echo $DIRECT_URL`
  que aponta para o host de produção antes de prosseguir.

Confirme antes de seguir que a `DIRECT_URL` que você vai usar — tanto no
arquivo `.env` quanto exportada no shell — é a de produção.

## 2. Entrar em janela de manutenção

**A partir daqui até o fim do passo 9, a aplicação não pode aceitar escritas.**

Qualquer linha criada pelo app entre o backfill (passo 5) e a migration de aperto
(passo 8) entra com `workspaceId NULL` e derruba o `ALTER COLUMN ... SET NOT NULL`
— ou, pior, passa despercebida pela verificação do passo 7 se a escrita acontecer
depois dela.

Coloque a aplicação em modo de manutenção / leitura — pause o deploy, escale para
zero instâncias ou redirecione o tráfego para uma página de manutenção, conforme o
mecanismo disponível na sua hospedagem — e só libere as escritas de novo no
passo 9.

## 3. Dump completo do banco e contagens de referência

```bash
pg_dump "$DIRECT_URL" -Fc -f backup-antes-do-aperto-$(date +%Y%m%d-%H%M).dump
```

`-Fc` gera o dump no formato *custom* do Postgres (comprimido, restaurável com
`pg_restore`).

Depois de rodar, confirme que o arquivo existe e tem tamanho plausível antes de
seguir para o próximo passo — um dump vazio ou truncado (poucos KB, quando o banco
tem milhares de linhas) significa que algo deu errado na conexão e você não tem
uma cópia de segurança de verdade:

```bash
ls -lh backup-antes-do-aperto-*.dump
```

Se o tamanho não bater com o que você espera do banco de produção, **não
prossiga** — investigue a conexão antes de continuar.

Aproveite esta mesma janela para anotar as contagens de referência que serão
comparadas no passo 9:

```sql
SELECT 'product' AS t, count(*) FROM product
UNION ALL SELECT 'sale', count(*) FROM sale
UNION ALL SELECT 'sale_item', count(*) FROM sale_item;
```

Guarde esse resultado (cole num lugar que você vá reabrir no passo 9) — sem ele
não há como confirmar que a migration não perdeu nem duplicou linhas.

## 4. Aplicar APENAS a migration aditiva

Este é o passo onde é mais fácil errar, e o erro é caro.

**`prisma migrate deploy` não tem flag de "aplicar até a migration X".** Ele
aplica **todas** as migrations pendentes, em ordem, de uma vez. Se você rodar
`npx prisma migrate deploy` agora, ele aplica a aditiva, o aperto e os índices na
mesma execução — e o aperto vai falhar, porque o backfill (passo 5) ainda não
rodou e todas as linhas existentes têm `workspaceId NULL`.

O caminho para aplicar só a aditiva tem duas partes: rodar o SQL dela à mão e
depois registrar no Prisma que ela já foi aplicada.

### 4.1. Rodar o SQL da aditiva

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 \
  -f prisma/migrations/20260829235758_add_workspace_models_and_nullable_workspace_id/migration.sql
```

- `-v ON_ERROR_STOP=1` aborta no primeiro erro em vez de seguir executando o
  resto do arquivo.
- `-1` roda o arquivo inteiro em **uma única transação**: ou tudo aplica, ou
  nada aplica. Sem isso, um erro no meio deixa o schema pela metade.

Essa migration é aditiva — cria `workspace`, `member`, `invitation` e adiciona
`workspaceId` como coluna **opcional** (`NULL` permitido) nas tabelas de domínio.
Ela não altera nenhuma linha existente e não quebra o código antigo que ainda
está rodando.

### 4.2. Registrar a migration como aplicada

O Prisma não sabe que você rodou o SQL à mão. Se você parar aqui, o próximo
`migrate deploy` vai tentar aplicá-la de novo e falhar com "already exists".

```bash
npx prisma migrate resolve --applied 20260829235758_add_workspace_models_and_nullable_workspace_id
```

Isso insere a linha correspondente em `_prisma_migrations` sem executar o SQL de
novo.

### 4.3. Conferir que só a aditiva foi aplicada

```bash
npx prisma migrate status
```

A saída **precisa** listar exatamente estas duas como não aplicadas:

```
Following migrations have not yet been applied:
20260830020652_enforce_workspace_scope
20260830023313_add_missing_workspace_indexes
```

Se aparecer alguma coisa diferente disso — em especial se disser "Database schema
is up to date!" — **pare**. "Up to date" aqui significa que as três migrations
foram aplicadas, provavelmente porque alguém rodou `migrate deploy` direto. Vá
para a seção de rollback.

## 5. Backfill do workspace Douce Vie

Com a aplicação ainda parada para escrita:

```bash
npm run backfill -- <email-do-owner>
```

Substitua `<email-do-owner>` pelo e-mail real do usuário que será o `OWNER` do
workspace (precisa já existir como `User` no banco).

O script (`scripts/backfill-workspace.ts`) roda em uma única transação, contra
a conexão direta (`DIRECT_URL`, com fallback para `DATABASE_URL` — veja passo
1): cria o workspace `Douce Vie` (slug `douce-vie`), torna o dono do e-mail
informado `OWNER`, adiciona os demais usuários existentes como `MEMBER`, e
preenche `workspaceId` em todas as tabelas de domínio listadas em
`scripts/domain-tables.ts` onde ele estiver `NULL`.

A saída esperada é uma linha por tabela com a contagem de linhas atualizadas,
seguida de um resumo:

```
product: 42 linhas
sale: 118 linhas
...
Workspace Douce Vie criado: <id>
Owner: <email-do-owner>
Membros adicionais: <n>
```

Se o script falhar (por exemplo, "Nenhum usuário com o e-mail ... Backfill
abortado" ou "Workspace douce-vie já existe"), a transação é revertida
automaticamente — nada fica parcialmente aplicado. Corrija a causa antes de rodar
de novo. A aplicação continua em modo de manutenção enquanto isso.

## 6. Deployar o código da Fase 3

**Só agora.** Não antes do passo 4, e não antes do passo 5.

O código da Fase 3 (Tasks 10–12: `src/server/actions/*` e as páginas migradas
para `getWorkspaceDb()`) depende de duas coisas que só existem depois dos passos
anteriores:

1. **A tabela `member` precisa existir.** `getWorkspaceContext()` chama
   `db.member.findFirst()` em toda requisição autenticada. Antes do passo 4 essa
   tabela não existe e toda página autenticada retorna 500.
2. **Precisa haver uma linha em `member` para o usuário.** Sem membership,
   `getWorkspaceContext()` lança `Nenhum workspace disponível` e a página falha.
   As memberships são criadas pelo backfill do passo 5.

Deploye o código e confirme que está servindo tráfego. A aplicação continua em
modo de manutenção para escrita — o objetivo aqui é só ter o código novo no ar
antes do aperto, para que nenhuma escrita passe pelo código antigo depois que a
coluna virar `NOT NULL`.

## 7. Verificação bloqueante

```bash
npm run verify:backfill
```

Essa é a trava de segurança antes da migration de aperto. O script
(`scripts/verify-backfill.ts`), também contra a conexão direta, conta em cada
uma das tabelas de domínio quantas linhas ainda têm `workspaceId IS NULL`.

**Regra: se a saída não for exit code 0, pare.** Um exit code diferente de 0
significa que existem linhas sem `workspaceId` — aplicar a migration de aperto
nesse estado faz o `ALTER COLUMN ... SET NOT NULL` falhar. Volte ao passo 5,
entenda por que sobraram linhas sem workspace, e só depois repita a verificação.

Se o passo 6 (deploy) tiver deixado escapar alguma escrita, é aqui que ela
aparece. Nesse caso, reforce o modo de manutenção antes de repetir.

## 8. Aplicar o aperto e os índices

Com a verificação em exit 0:

```bash
npx prisma migrate deploy
```

Agora `migrate deploy` é o comando certo: as duas migrations restantes são
exatamente as que você quer aplicar, nesta ordem, e a aditiva já está registrada
como aplicada.

Isso aplica:

- `20260830020652_enforce_workspace_scope`: torna `workspaceId` `NOT NULL` em
  todas as 16 tabelas de domínio, declara as foreign keys para `workspace`,
  troca as uniques globais (`name`, `email`) por compostas (`workspaceId` +
  campo), e recria os índices com `workspaceId` na frente.
- `20260830023313_add_missing_workspace_indexes`: os 8 índices de `Flavor`,
  `PriceListItem`, `PriceHistory`, `SaleItem`, `RecipeIngredient`,
  `ProductionBatch`, `ProductionFilling` e `ShoppingListItem`.

Não use `prisma migrate dev` em produção — esse comando é interativo e pode
oferecer resetar o banco, o que apagaria os dados. `migrate deploy` só aplica
migrations já geradas e commitadas, sem prompts.

## 9. Como confirmar sucesso e sair da manutenção

```bash
npx prisma migrate status
```

Deve mostrar "Database schema is up to date!".

Em seguida, rode a verificação de backfill de novo — ela deve continuar passando
(agora é redundante, já que a coluna é `NOT NULL`, mas serve de dupla-checagem):

```bash
npm run verify:backfill
```

Por fim, confira que os dados de negócio continuam intactos comparando com as
contagens anotadas no passo 3:

```sql
SELECT 'product' AS t, count(*) FROM product
UNION ALL SELECT 'sale', count(*) FROM sale
UNION ALL SELECT 'sale_item', count(*) FROM sale_item;
```

As contagens antes e depois da migration devem ser idênticas — a migration só
altera colunas e índices, nunca linhas.

Só com essas três verificações confirmadas, **tire a aplicação do modo de
manutenção** e libere as escritas de novo. Faça um teste de escrita real
(registrar uma venda, por exemplo) logo depois de liberar.

## 10. Como reverter, etapa por etapa

- **Falhou no passo 3 (dump):** nada foi alterado no banco. Investigue a conexão
  (`DIRECT_URL` correta? porta 5432 acessível?) e repita.

- **Falhou no passo 4.1 (SQL da aditiva):** o `-1` garante que a transação
  inteira foi revertida — o schema está como antes e nada foi registrado em
  `_prisma_migrations`. Corrija a causa e rode de novo. Confirme com
  `npx prisma migrate status` que as **três** migrations aparecem como não
  aplicadas.

- **Rodou `migrate deploy` cedo demais e as três foram aplicadas de uma vez:** o
  aperto falha no meio com `23502` (`column "workspaceId" ... contains null
  values`) e o Prisma marca a migration como **falha**, bloqueando qualquer
  deploy seguinte com `P3018`. O Postgres roda cada migration em transação, então
  o aperto em si foi revertido — a coluna continua nullable e os índices antigos
  continuam lá. Recupere assim:

  ```bash
  npx prisma migrate resolve --rolled-back 20260830020652_enforce_workspace_scope
  ```

  Isso desbloqueia o histórico. A aditiva continua aplicada (ela é aditiva e
  passou), então retome o runbook **a partir do passo 5** (backfill). Não é
  necessário restaurar o dump neste caso.

- **Falhou no passo 5 (backfill):** o script roda em transação — uma falha no
  meio já desfaz tudo sozinha. Confirme com uma query rápida que o workspace
  `douce-vie` não existe (`SELECT * FROM workspace WHERE slug = 'douce-vie'`) antes
  de tentar de novo.

- **Falhou no passo 6 (deploy do código):** o banco não foi tocado. Faça rollback
  do deploy para a versão anterior — ela continua funcionando, porque a coluna
  ainda é nullable e as tabelas novas apenas existem sem serem usadas. Investigue
  e repita.

- **Falhou no passo 7 (verificação):** não é uma falha de banco, é um sinal de
  parada. Volte ao passo 5.

- **Falhou no passo 8 (aperto):** este é o único ponto realmente arriscado. Se
  `prisma migrate deploy` retornar erro, primeiro rode
  `npx prisma migrate resolve --rolled-back 20260830020652_enforce_workspace_scope`
  para destravar o histórico. Se o banco tiver ficado em estado inconsistente,
  restaure o dump do passo 3:

  ```bash
  pg_restore --clean --if-exists -d "$DIRECT_URL" backup-antes-do-aperto-<timestamp>.dump
  ```

  **Ensaie este restore antes de precisar dele de verdade.** `pg_restore
  --clean --if-exists` contra um Postgres gerenciado (Supabase) costuma
  falhar em objetos que o role da aplicação não possui — é comum ver erros de
  permissão em `DROP`/`ALTER OWNER` durante o restore, mesmo quando o restore
  em si é bem-sucedido no que importa. Teste o comando completo, com um dump
  real, contra um banco descartável (uma branch do Supabase ou um Postgres
  local carregado a partir do mesmo dump) antes do dia da migration, para
  saber de antemão quais erros são esperados e inofensivos e quais indicam que
  o restore de fato falhou.

  A causa mais provável **não** é duplicidade de `name` ou `email` dentro do
  mesmo workspace — isso não é alcançável: as uniques globais antigas (`name`,
  `email` sozinhos) eram estritamente mais fortes que as compostas novas
  (`workspaceId` + campo), então nenhum dado que já satisfazia a unique antiga
  pode violar a nova. A causa real mais provável é uma linha **nova**, com
  `workspaceId NULL`, escrita pelo app depois da verificação do passo 7 — sinal
  de que a janela de manutenção não foi respeitada.

## 11. Por que esta ordem

Três dependências, e nenhuma delas é óbvia lendo só o schema:

**Aditiva antes do código da Fase 3.** O código novo chama
`db.member.findFirst()` em toda requisição autenticada. A tabela `member` nasce
na migration aditiva. Código novo sem a migration = app inteiro fora do ar.

**Backfill antes do código da Fase 3.** Ter a tabela não basta: sem uma linha de
`member` para o usuário, `getWorkspaceContext()` lança `Nenhum workspace
disponível`. O backfill é quem cria o workspace e as memberships.

**Código da Fase 3 antes do aperto.** O aperto torna `workspaceId` `NOT NULL`. O
código antigo escreve sem informar `workspaceId`. Se o aperto for aplicado com o
código antigo ainda no ar, toda escrita passa a falhar com violação de not-null —
registrar uma venda, cadastrar um cliente, lançar uma produção. O app fica no ar,
mas incapaz de gravar.

**Backfill entre a aditiva e o aperto.** `ALTER COLUMN "workspaceId" SET NOT NULL`
falha imediatamente se existir uma única linha com `workspaceId IS NULL` — e antes
do backfill é exatamente isso que existe: todo o histórico de produção. Rodar o
aperto fora de ordem não corrompe dados (a transação reverte), mas trava a
migration e exige `migrate resolve --rolled-back` para destravar.

É por isso que a aditiva precisa ser aplicada **sozinha** (passo 4), e não com um
`migrate deploy` que levaria as três de uma vez: o backfill e o deploy do código
precisam acontecer **entre** a aditiva e o aperto, e não existe flag de "aplicar
até aqui".
