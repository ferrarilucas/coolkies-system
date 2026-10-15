# Onboarding guiado por setor

Data: 2026-10-15
Status: aguardando revisão do usuário

## Objetivo

Hoje, ao criar um workspace, o usuário só informa o nome do negócio e cai no
Painel vazio, sem saber por onde começar nem onde cada coisa é cadastrada. O app
é genérico (estoque, vendas, produção, compras, clientes), e cada ramo usa uma
parte diferente dele: uma loja de roupas não produz nada, uma confeitaria
depende de insumo, ficha técnica e produção.

Este spec cria um onboarding interativo e guiado que:

1. pergunta o **setor** do negócio ao criar o workspace;
2. roda um **tour de apresentação** curto, com holofote, mostrando onde fica
   cada coisa;
3. deixa um conjunto de **missões** de primeiros passos, específicas do
   modelo de operação do setor, cada uma com cliques guiados e animados sobre
   as telas reais do app.

Critério de sucesso: criar um workspace de confeitaria, fazer o tour, concluir
as seis missões só seguindo o holofote (incluindo o produto com variações
Sabor × Tamanho e ficha técnica por combinação) e ver o card e a bolha sumirem
com a comemoração final. O mesmo para um workspace de roupas, com Tamanho × Cor
e compra escolhendo a combinação.

## Decisões

1. **Tour curto + missões.** O tour de apresentação roda uma vez; depois ficam
   as missões pendentes. Tour de apresentação sozinho costuma ser pulado e
   esquecido; as missões levam o usuário a criar dados reais no ritmo dele.
2. **Setor concreto, modelo por baixo.** O usuário escolhe um setor familiar
   (com ícone); o sistema mapeia para um de quatro modelos de operação. Os
   textos e exemplos vêm do setor, a estrutura das missões vem do modelo.
3. **Missão é concluída pelo dado real.** "Produto no catálogo" está feita
   quando existe produto com preço no workspace, venha de onde vier (tour,
   fora do tour, API/MCP, outro membro). O tour é só o guia para chegar lá.
   Fechar o tour no meio não perde nada. O progresso não é gravado no banco.
4. **Quem vê o quê.** O checklist é do workspace; o tour de apresentação é de
   cada pessoa. Quem entra por convite vê só o tour de apresentação. Missões
   só aparecem para OWNER/ADMIN com `canWrite`, porque catálogo, compras e
   fichas técnicas exigem esses papéis no servidor.
5. **Workspaces antigos** (sem setor) recebem um convite discreto no Painel
   para informar o ramo. Informado o setor, as missões aparecem já com as
   concluídas marcadas. O convite também pode ser dispensado.
6. **Visual: holofote em tudo.** Tela escurecida, recorte animado no alvo com
   anel pulsante e balão com seta. Em formulários, o recorte envolve o campo
   ou o bloco que está sendo preenchido, e o usuário continua digitando.
7. **Missões em dois lugares.** No Painel, um card compacto com a próxima
   missão, a barra de progresso e "Ver todas". Nas outras telas, uma bolha de
   progresso flutuante ("2/5") que abre uma gaveta com a lista. No Painel a
   bolha não aparece; durante um holofote ativo, a bolha se esconde.
8. **Dá para tirar da tela.** Um "×" no card e na gaveta dispensa card e bolha
   juntos (com confirmação). Em Ajustes há "Retomar primeiros passos" e "Rever
   tour do app".
9. **Biblioteca: nextstepjs.** Feita para o App Router, já navega entre rotas
   (`nextRoute`/`prevRoute`), aceita `cardComponent` próprio e expõe
   `useNextStep()` para avançar por código. Traz a `motion` como dependência;
   o tour é carregado com `dynamic import` só quando há algo a mostrar, para
   não pesar no bundle de quem já terminou.
10. **Catálogo em todos os modelos.** Toda trilha passa pela missão "Monte seu
    produto no catálogo", a mais longa e mais explicada, com preço e
    variações. As variações são explicadas passo a passo, mas não são
    exigidas para concluir a missão (muito negócio vende produto único).
11. **Na revenda, catálogo antes da compra.** A linha de compra referencia
    item e, opcionalmente, combinação. A criação rápida de item dentro da
    compra não cria variações; comprar antes de cadastrar as combinações
    deixaria o estoque fora delas. Para insumo, a compra é o ponto de entrada:
    o próprio formulário de compra cria o insumo na hora.

## Setores e modelos

| Setor (chave) | Nome exibido | Modelo |
|---|---|---|
| `confeitaria` | Confeitaria, doces e bolos | PRODUZ |
| `salgados` | Salgados e marmitas | PRODUZ |
| `cosmeticos` | Cosméticos e velas artesanais | PRODUZ |
| `roupas` | Roupas e acessórios | REVENDE |
| `papelaria` | Papelaria e presentes | REVENDE |
| `revenda` | Revenda em geral | REVENDE |
| `artesanato` | Artesanato | SOB_ENCOMENDA |
| `marcenaria` | Marcenaria | SOB_ENCOMENDA |
| `costura` | Costura sob encomenda | SOB_ENCOMENDA |
| `outro` | Outro | GENERICO |

Cada setor traz exemplos usados nos textos dos passos:

```ts
type SectorExamples = {
  produto: string;
  insumo: string | null;
  fornecedor: string;
  eixos: { nome: string; opcoes: string[] }[];
};
```

Exemplos: confeitaria → produto "Bolo de pote", insumo "Farinha de trigo",
eixos Sabor (Ninho, Nutella, Doce de leite) × Tamanho (Mini, Tradicional);
roupas → produto "Camiseta", insumo nulo, eixos Tamanho (P, M, G) × Cor
(Azul, Verde). Os exemplos dos demais setores são definidos na implementação,
seguindo o mesmo formato.

## Missões por modelo

Ordem sugerida. A "próxima missão" é a primeira pendente nessa ordem; o
usuário pode fazer qualquer uma a qualquer momento.

| Modelo | Missões |
|---|---|
| PRODUZ | ① Compra do primeiro insumo ② Ficha técnica ③ Produto no catálogo ④ Produção ⑤ Venda ⑥ Cliente |
| REVENDE | ① Produto no catálogo ② Compra do fornecedor ③ Venda ④ Cliente |
| SOB_ENCOMENDA | ① Compra do primeiro insumo ② Produto no catálogo ③ Cliente ④ Venda parcelada |
| GENERICO | ① Produto no catálogo ② Venda ③ Cliente |

Regras de conclusão (basta existir ao menos um registro no workspace):

| Missão (id) | Regra | Rota de início |
|---|---|---|
| `compra-insumo` | `Purchase` com algum `PurchaseItem` cujo `Item.productionInput` é verdadeiro | `/purchases` |
| `compra-fornecedor` | `Purchase` | `/purchases` |
| `ficha-tecnica` | `Recipe` | `/admin/recipes/new` |
| `catalogo` | `PriceListItem` ativo | `/admin/catalog/new` |
| `producao` | `ProductionBatch` | `/production/new` |
| `venda` | `Sale` | `/sales/new` |
| `venda-parcelada` | `Sale` com `installmentCount > 1` (toda venda já tem a parcela 1 em `SaleInstallment`) | `/sales/new` |
| `cliente` | `Customer` | `/customers` |

### Missão "Produto no catálogo"

É a missão central. Antes do primeiro passo, abre o guia animado de variações
que já existe (`src/components/catalog/variations-guide.tsx`), agora com os
exemplos do setor em vez do Brownie fixo. Depois, holofote em:

1. **Nome:** "Digite {produto}".
2. **Preço:** o preço padrão vale para todas as combinações sem preço próprio.
3. **Adicionar tipo de variação:** "Tipo é o que muda ({eixo}). Opções são os
   valores ({opções})." Aqui existe a saída "Meu produto não tem variações",
   que pula para o passo 9.
4. **Nome do tipo** (avança quando preenchido).
5. **Opções** (avança com pelo menos duas opções).
6. **Lista de combinações:** "Cada linha é uma versão que você vende, com
   estoque próprio. Desmarque as que você não vende."
7. **Preço da combinação:** "Só preencha se esta versão custa diferente do
   preço padrão."
8. **Ficha técnica da combinação** (só no modelo PRODUZ): "Ligue a ficha para
   a produção baixar os insumos certos."
9. **Salvar produto.**

O botão (?) de variações no catálogo continua abrindo o mesmo guia, também com
os exemplos do setor.

### Demais missões (resumo dos passos)

- **Compra do primeiro insumo:** botão de nova compra → fornecedor → item →
  "+ Novo insumo" (cria o insumo dentro da compra) → quantidade e valor →
  salvar.
- **Compra do fornecedor (REVENDE):** nova compra → fornecedor → produto →
  combinação → quantidade e valor → salvar.
- **Ficha técnica:** nome → rendimento → adicionar insumo e quantidade →
  salvar.
- **Produção:** produto → combinação → quantidade → salvar, explicando que os
  insumos da ficha são baixados do estoque.
- **Venda / venda parcelada:** botão + → produto e combinação → cliente →
  forma de pagamento (parcelas, na parcelada) → salvar.
- **Cliente:** novo cliente → nome e telefone → salvar.

### Tour de apresentação

Um só para todos os setores; só a frase de abertura usa o setor ("Bem-vinda à
sua confeitaria!"). Paradas: Painel → botão + (nova venda) → Vendas →
Clientes → Ajustes (onde ficam Catálogo, Estoque, Compras e Produção no
celular) → card de primeiros passos. Os seletores mudam entre `bottom-nav`
(celular) e `side-nav` (desktop).

## Modelo de dados

Migration escrita à mão, só aditiva, aplicada em `cookies` e `cookies_test`:

```prisma
model Workspace {
  sector                String?
  onboardingDismissedAt DateTime?
}

model User {
  appTourCompletedAt DateTime?
}
```

- `sector` aceita só as chaves da tabela de setores; validação no servidor.
- Nenhum backfill: workspaces antigos ficam com `sector` nulo (decisão 5).
- Usuários antigos ficam com `appTourCompletedAt` nulo e veem o tour uma vez
  no próximo acesso, podendo pular.

## Arquitetura

### Dados declarativos (sem banco)

- `src/lib/onboarding/sectors.ts`: setores, modelo e exemplos; função
  `modelOf(sector)`.
- `src/lib/onboarding/missions.ts`: missões por modelo, com id, título, rota
  de início, regra de conclusão (id da regra) e passos. Textos com
  placeholders (`{produto}`, `{insumo}`, `{eixo}`...) preenchidos por
  `fillText(text, examples)`.
- `src/lib/onboarding/visibility.ts`: funções puras que decidem o que
  mostrar (`shouldShowAppTour`, `shouldShowMissions`, `shouldShowSectorPrompt`,
  `nextMission`).

Formato de um passo:

```ts
type TourStep = {
  target: string;
  route: string;
  title: string;
  content: string;
  side: "top" | "bottom" | "left" | "right";
  advanceOn: "next" | "click" | "input" | "element";
  waitFor?: string;
  models?: Model[];
};
```

`target` é o valor de um atributo `data-tour` (alguns passos têm um alvo para
celular e outro para desktop, resolvidos em tempo de execução).

### Servidor

- `src/server/tenant/onboarding.ts` (por causa da regra de lint de
  `@/lib/db`): `getOnboardingState(workspaceId, userId)` devolve setor,
  modelo, dispensado, tour feito e o progresso. O progresso faz um
  `findFirst({ select: { id: true } })` por regra do modelo, em paralelo, e
  só roda quando as missões estão visíveis. Em erro, devolve progresso vazio
  com as missões ocultas e registra o log.
- `src/server/actions/onboarding.ts`: `setWorkspaceSector`,
  `dismissOnboarding`, `resumeOnboarding`, `completeAppTour`,
  `restartAppTour`. As de workspace exigem OWNER/ADMIN.
- `createWorkspace` e `createWorkspaceForUser` passam a receber `sector`.

### Cliente

- `src/app/(app)/layout.tsx` busca `getOnboardingState` e passa para o
  `AppShell`.
- `OnboardingProvider` (carregado com `dynamic import` só quando há tour ou
  missão pendente) envolve `NextStepProvider` e `<NextStep>`, monta os passos
  da missão ativa para o layout visível e controla o avanço.
- `TourCard`: `cardComponent` do nextstepjs, com `Button`, tokens e dark mode
  do app; mostra título, texto, "Passo n de m", "Pular" e "Próximo" (só
  quando `advanceOn` é `"next"`).
- Anel pulsante: classe CSS aplicada ao alvo ativo, com keyframes em
  `globals.css`.
- `OnboardingCard` (Painel): próxima missão, barra de progresso, "Ver todas",
  "×". Para workspace sem setor, mostra o convite "Conte qual é o seu ramo".
- `OnboardingBubble` (demais telas): anel de progresso flutuante acima da
  navegação; abre uma gaveta inferior (construída sobre o `Dialog` existente, já que não há `Sheet` em `components/ui`) com a lista de missões e o "×".
- `SectorPicker`: grade de cards de setor, usada no passo 2 do
  `CreateWorkspaceForm` (onboarding e seletor de workspace) e no convite dos
  workspaces antigos.
- Ajustes (`/more`): "Retomar primeiros passos" (quando dispensado) e "Rever
  tour do app".
- `VariationsGuide` passa a receber os exemplos por props.
- Atributos `data-tour` nos alvos: navegação, botão +, catálogo, editor de
  variações, lista de combinações, diálogo de compra, combobox de item,
  formulário rápido de insumo, ficha técnica, produção, venda e cliente.

### Avanço dos passos

- `next`: botão Próximo do cartão.
- `click`: listener de clique no alvo; no passo final (Salvar), consulta o
  progresso por até 10 s até a missão aparecer concluída.
- `until`: avança quando um seletor de estado aparece (ex.: o campo ganha
  `data-filled`, a lista de opções ganha `data-count` maior que 1).
- `await`: usado quando o usuário precisa interagir com um `Select` ou
  `Popover` do Radix, que abrem fora do recorte. O holofote sai, o alvo fica
  com o anel pulsante e um cartão de dica fixo explica o que fazer; avança
  quando o seletor de estado aparece.

Passos dentro de um `Dialog` (compra, cliente) também usam o cartão de dica,
renderizado num portal dentro do próprio `DialogContent` (que ganha um `id`),
com o anel no alvo; o diálogo já escurece o fundo. Isso evita que um clique
no cartão conte como clique fora do diálogo e o feche.

Antes de mostrar cada passo, o controlador espera o alvo existir (polling a
cada 150 ms, até 8 s). Os componentes só ganham `data-tour` e atributos de
estado (`data-filled`, `data-count`, `data-checked`, `data-installments`);
nenhuma lógica de formulário muda.

### Conclusão e comemoração

Ao salvar, as actions já chamam `revalidatePath`; o layout re-renderiza com o
progresso novo. O `OnboardingProvider` compara com o progresso anterior
(`useRef`). Quando uma missão passa a concluída: fecha o tour dela, anima um
check com confete leve (CSS) e o card avança para a próxima missão com
transição. Concluída a última, aparece a tela "Tudo pronto!" e card e bolha
somem.

## Casos de borda

- **Alvo que não aparece em 8 s:** o tour pausa; o card mostra "Retomar
  missão". Sem erro para o usuário.
- **Navegou para fora da missão:** o tour pausa; a missão segue pendente.
- **Sem permissão ou em modo leitura** (membro, plano bloqueado): sem missões,
  só o tour de apresentação.
- **Troca de workspace no meio:** o tour fecha; o estado vem do novo
  workspace.
- **Diálogos e selects do Radix:** tratados pelo cartão de dica (ver
  "Avanço dos passos"). A primeira tarefa de interface valida no navegador
  que o holofote do nextstepjs funciona nas páginas e que o cartão de dica
  funciona dentro do diálogo de compra.

## Testes

- Unitários (vitest): `modelOf`, `fillText`, `nextMission`, funções de
  visibilidade (setor, dispensado, papel, `canWrite`, tour feito).
- `getOnboardingState` contra `cookies_test`: cada regra com e sem dados,
  isolamento entre workspaces, missões ocultas para MEMBER.
- Actions: criar workspace com setor, setor inválido rejeitado, dispensar e
  retomar, concluir e reiniciar o tour.
- Integridade dos roteiros: todo `target` citado em `missions.ts` e no tour de
  apresentação existe como `data-tour` em algum arquivo de `src/`.
- Verificação no navegador: workspace de confeitaria e de roupas, tour e uma
  missão completa de cada modelo, em 375 px e em desktop.

## Fora de escopo

- Aviso no catálogo sobre estoque que fica fora das combinações quando as
  variações são criadas depois da compra (problema existente, independente do
  onboarding).
- Métricas de funil do onboarding.
- Edição dos roteiros pelo painel de admin.
- Tradução para outros idiomas.
