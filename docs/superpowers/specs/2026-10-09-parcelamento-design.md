# Parcelamento de vendas

Data: 2026-10-09
Status: aprovado, aguardando plano de implementação

## Objetivo

Na venda, além de "à vista" (o que existe hoje), o vendedor pode escolher
"parcelado": informa a quantidade de parcelas e a data da 1ª, e o total é
dividido em parcelas mensais. Cada parcela é cobrada e paga separadamente;
pagar uma parcela não quita a venda.

Critério de sucesso: vender R$ 100 em 3x com 1ª parcela no "Dia 5", ver
33,33 / 33,33 / 33,34 com vencimentos em três meses seguidos, receber só a 1ª
na cobrança do cliente e ver a venda continuar em aberto com "1/3 pagas" e
R$ 66,67 em aberto.

## Decisões

1. **Toda venda tem parcelas.** À vista = 1 parcela; parcelado = N. Painel,
   cobrança, PDF, exportação e API leem um único modelo. Escolhida em vez de
   manter dois caminhos (parcelas só nas parceladas), que duplicaria todas as
   consultas.
2. **`Sale.status`, `Sale.paidAt` e `Sale.paymentForecastDate` viram resumo**
   das parcelas, recalculados a cada mudança: `PAID` quando todas estão pagas;
   `paidAt` = pagamento da última parcela; `paymentForecastDate` = vencimento
   da próxima parcela em aberto. Filtros e índices atuais continuam valendo.
3. **De 2 a 24 parcelas** no modo parcelado.
4. **Centavos que sobram ficam na última parcela** (R$ 100 em 3x = 33,33 +
   33,33 + 33,34).
5. **1ª parcela usa o seletor atual** (Dia 5, 5º dia útil, data personalizada).
   As seguintes repetem a regra mês a mês:
   - Dia 5 → dia 5 dos meses seguintes;
   - 5º dia útil → recalculado em cada mês (`fifthBusinessDayOfMonth`);
   - data personalizada → mesmo dia do mês; em mês curto, último dia do mês.
6. **Cobrança é parcela a parcela.** A tela de cobrança do cliente lista
   parcelas, e o vendedor marca quais recebeu.
7. **Desfazer pagamento é por parcela.**
8. **Edição com parcela paga redistribui só o saldo:** parcelas pagas ficam
   intactas; (novo total − total pago) é redividido nas parcelas em aberto. O
   número de parcelas não pode ficar menor que o de parcelas pagas. Se o novo
   total for menor que o já pago, a edição é recusada.
9. **API v1 e MCP entram na mesma entrega.**
10. **Painel conta por parcela.** Realizado: cada parcela paga no bucket do seu
    `paidAt`. Previsto: cada parcela em aberto no bucket do seu `dueDate`.
    Uma venda de R$ 300 em 3x entra no previsto R$ 100 por mês, não R$ 300 no
    mês da venda. "Vencidas" passa a significar parcela vencida.

## Modelo de dados

```prisma
model SaleInstallment {
  id             String          @id @default(cuid())
  saleId         String
  sale           Sale            @relation(fields: [saleId], references: [id], onDelete: Cascade)
  number         Int
  amountCents    Int
  dueDate        DateTime?
  forecastPreset ForecastPreset?
  paidAt         DateTime?

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([saleId, number])
  @@index([workspaceId, paidAt, dueDate])
  @@map("sale_installment")
}
```

`Sale` ganha `installmentCount Int @default(1)` e a relação `installments`.

`dueDate` é nulo apenas em parcela única paga no ato (venda à vista "Pago
agora").

### Migration (SQL à mão)

1. Cria `sale_installment` e `sale.installment_count`.
2. Backfill: uma parcela `number = 1` por venda existente, com
   `amount_cents = total_cents`, `due_date = payment_forecast_date`,
   `forecast_preset = forecast_preset`, `paid_at = paid_at`.
3. Aplicada em `cookies` e `cookies_test` via docker psql.

## Regras de cálculo (`src/lib/installments.ts`)

Funções puras, testadas isoladamente:

- `splitAmount(totalCents, count)` → valores, resto na última.
- `buildSchedule(firstDue, preset, count)` → datas de vencimento.
- `redistribute(installments, newTotalCents, newCount)` → parcelas pagas
  preservadas, saldo redividido nas em aberto, vencimentos das novas parcelas
  continuando a sequência.
- `summarize(installments)` → `{ status, paidAt, paymentForecastDate }` para
  gravar na `Sale`.

Toda escrita em parcelas acontece em transação junto com a atualização do
resumo na `Sale`.

## Telas

- **Venda nova/edição (`sale-form.tsx`):** escolha "À vista" | "Parcelado".
  À vista mantém o fluxo atual (Pago agora / Dia 5 / 5º dia útil / data).
  Parcelado mostra quantidade (2–24), seletor da 1ª data (sem "Pago agora") e
  prévia: "3x de R$ 33,33 — 05/11, 05/12, 05/01".
- **Detalhe/edição da venda:** lista de parcelas com status, vencimento, botão
  de marcar paga e desfazer.
- **Lista de vendas:** selo "1/3 pagas" e valor em aberto nas parceladas.
  Resumo "pendente" e "vencido" somam parcelas em aberto, não `totalCents`.
- **Cobrança do cliente (`customer-collect-dialog.tsx`):** uma linha por
  parcela em aberto ("Venda 09/10 · parcela 2/3 · vence 05/12"), com seleção
  individual. "Receber tudo" marca só as parcelas listadas pelo filtro de data.
- **Painel:** conforme decisão 10.
- **PDF do cliente e exportação CSV:** uma linha por parcela em aberto; a
  exportação ganha colunas de parcelas pagas/total e valor em aberto.

## API v1 / MCP

- `POST /api/v1/sales`: aceita `installments` (1–24, padrão 1), `firstDueDate`
  e `forecastPreset`. Resposta inclui as parcelas.
- `GET /api/v1/sales`: inclui `installments` e `openCents`.
- `POST /api/v1/sales/mark-paid`: aceita `installmentIds`. Com `saleId`,
  `saleIds` ou `customerId`, quita só as parcelas já vencidas (ou sem
  vencimento); parcelas futuras ficam em aberto.
- Tools MCP `create_sale`, `list_sales` e `mark_sales_as_paid` acompanham os
  novos campos.

## Fora de escopo

- Juros, multa ou acréscimo por parcelamento.
- Entrada com valor diferente das parcelas.
- Pagamento parcial de uma parcela.
- Cobrança automática (Pix, cartão) das parcelas.

## Testes

- Unitários de `installments.ts`: divisão com resto, meses curtos, 5º dia útil
  em sequência, virada de ano, redistribuição com parcelas pagas, edição com
  total menor que o pago.
- Integração das actions: criar parcelada, pagar parcela, desfazer, editar com
  parcela paga, cobrança por parcela.
- Rotas v1: criação parcelada e `mark-paid` com parcelas futuras.
- Painel: venda parcelada distribuída nos buckets de cada vencimento.
