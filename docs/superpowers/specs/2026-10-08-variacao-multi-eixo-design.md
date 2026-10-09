# Variação multi-eixo no catálogo

Data: 2026-10-08
Status: aprovado, implementação direta (sem plano em documento separado, a pedido)
Predecessor: [2026-09-16-estoque-producao-compras-generico-design.md](./2026-09-16-estoque-producao-compras-generico-design.md),
que deixou a variação multi-eixo explicitamente fora de escopo.

## Objetivo

Permitir que um produto varie em mais de um eixo (ex.: Camiseta com Tamanho × Cor)
com **estoque por combinação**: vender "M / Azul" baixa o estoque exatamente
dessa combinação.

Critério de sucesso: cadastrar Camiseta com Tamanho (P, M, G) × Cor (Azul, Verde),
marcar 5 das 6 combinações, vender "M / Azul" e ver o estoque de "M / Azul" baixar.

## Decisões

1. **`Variant` continua sendo a combinação (o SKU).** Estoque, preço, produção,
   compra, venda e API v1/MCP seguem referenciando `variantId`. Os eixos ficam
   por cima, em tabelas novas. Abordagem escolhida entre três (eixos por cima da
   Variant; atributos em JSON; reescrita do catálogo como no spec de 2026-08-30).
2. **Nome do eixo é livre por produto** ("Tamanho", "Cor", "Sabor"), sem preset.
3. **Preço como hoje:** padrão do produto + exceção por combinação. Sem acréscimo
   por valor de eixo.
4. **O usuário escolhe quais combinações existem**, a partir da lista de todas as
   combinações possíveis. Não há geração automática.
5. **`Variant.name` é gerado** a partir dos valores, na ordem dos eixos:
   "M / Azul". Fica gravado, então todos os consumidores atuais continuam
   funcionando. Em produto com eixos, o nome não é editado à mão.
6. **No máximo 3 eixos por produto.**
7. **Combinação desmarcada:** desativa se tiver venda, produção ou movimento de
   estoque; senão, apaga. Mesma regra que já vale para variação removida.
8. **Bug do R$ 0,00 corrigido junto:** toda combinação ativa precisa ter preço
   efetivo (o próprio ou o padrão do produto).

## Modelo de dados

```prisma
model ItemOption {
  id       String @id @default(cuid())
  itemId   String
  name     String
  position Int
  @@unique([itemId, name])
}

model ItemOptionValue {
  id       String @id @default(cuid())
  optionId String
  name     String
  position Int
  @@unique([optionId, name])
}

model VariantOptionValue {
  variantId     String
  optionValueId String
  @@id([variantId, optionValueId])
}
```

Todas com `workspaceId` e isolamento de tenant. Cascata a partir do `Item`
(`ItemOption`), da `ItemOption` (`ItemOptionValue`) e da `Variant`
(`VariantOptionValue`).

Regras garantidas pelo servidor:

- Uma combinação tem exatamente um valor de cada eixo do produto.
- Duas combinações do mesmo produto não têm o mesmo conjunto de valores.
- Produto sem eixos continua como hoje (com ou sem variações de nome livre).

### Migração

Escrita à mão, só aditiva. Cria as três tabelas e faz backfill: cada `Item` com
variações ganha um eixo "Variação" com um valor por variação existente, e cada
`Variant` é ligada ao seu valor. Os nomes não mudam (um eixo só gera o nome
atual). Tudo numa transação.

## Servidor

- `src/lib/variant-options.ts`: regras puras (validação de eixos e combinações,
  nome gerado, chave de combinação). Sem banco.
- `saveItem` (`src/server/actions/catalog.ts`) recebe eixos com valores e as
  combinações marcadas. Valores e eixos existentes vêm com id, para renomear não
  virar apagar + criar. Roda numa transação.
  - Marcar combinação: cria `Variant` + vínculos + nome gerado.
  - Desmarcar: regra da decisão 7.
  - Renomear valor: recalcula o nome de todas as combinações do produto. Vendas
    antigas mantêm o snapshot.
  - Remover valor ou eixo: combinações afetadas seguem a regra da decisão 7.
  - Adicionar eixo a produto com combinações: cada combinação existente precisa
    receber um valor do eixo novo; o servidor recusa se faltar.
- `getCatalogForSale` devolve os eixos e os valores de cada combinação.
- API v1 / MCP: sem mudança.

## Telas

- **Cadastro do produto:** seção Variações em dois passos. (1) Eixos: até 3,
  nome + valores como chips. (2) Combinações: lista de todas as possíveis, com
  caixa de marcar, "Marcar todas" e "Desmarcar todas"; cada marcada mostra
  preço próprio opcional, ficha técnica e ativo/inativo. Ao adicionar eixo, as
  combinações existentes recebem o primeiro valor do eixo novo.
- **Venda:** um seletor por eixo; valores sem combinação ativa compatível ficam
  desabilitados; ao completar, preenche o preço. Produto de um eixo só continua
  com um seletor.
- **Lista do catálogo:** "5 combinações · Tamanho × Cor".
- Produção, estoque, compras, painel e PDFs: sem mudança (usam o nome gerado).

## Testes

- Unitários das regras puras: limites de eixos, combinação incompleta ou
  duplicada, nome gerado na ordem dos eixos.
- Integração de `saveItem`: criar 5 combinações; renomear valor atualiza nomes e
  preserva snapshot da venda; desmarcar combinação vendida desativa; combinação
  sem preço efetivo é recusada; adicionar eixo exige valor para as existentes.
- Migração: produto com variações antigas ganha eixo "Variação" com os mesmos
  nomes.
- Venda de "M / Azul" gera `StockMovement` nessa `Variant`.

## Fora de escopo

- Relatórios e painel por eixo.
- Preço por acréscimo de valor do eixo.
- Eixos na API v1 e no MCP.
- Reordenar eixos e valores arrastando.
- Imagem, SKU ou código de barras por combinação.
