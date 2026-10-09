# Parcelamento de vendas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir vender parcelado (2–24 parcelas mensais), com cobrança, pagamento e desfazer por parcela, refletido em vendas, clientes, painel, PDF, exportação, API v1 e MCP.

**Architecture:** Toda venda passa a ter linhas em `SaleInstallment` (à vista = 1). A `Sale` guarda um resumo das parcelas (`status`, `paidAt`, `paymentForecastDate`, `forecastPreset`, `openCents`, `installmentCount`) recalculado sempre na mesma transação que altera parcelas, para que filtros e índices atuais continuem valendo. As regras (divisão, calendário, redistribuição, resumo) ficam em funções puras em `src/lib/installments.ts`; o acesso ao banco fica em `src/server/sales/installments.ts`.

**Tech Stack:** Next.js App Router (server actions), Prisma + Postgres, Vitest (banco `cookies_test` real), date-fns, pnpm. MCP em repositório separado (`/Users/ferrari/code/coolkies-mcp`, Hono + zod).

**Spec:** [docs/superpowers/specs/2026-10-09-parcelamento-design.md](../specs/2026-10-09-parcelamento-design.md)

## Global Constraints

- Nunca escrever comentários no código (regra do usuário).
- Usar `pnpm`, nunca `npm`/`yarn`.
- Não rodar `prisma migrate dev/deploy`. Migration é SQL à mão em `prisma/migrations/<timestamp>_<nome>/migration.sql`, aplicada com `docker exec -i cookies_db psql -U cookies -d cookies` e `-d cookies_test`, seguida de `pnpm exec prisma generate`.
- Valores sempre em centavos (`Int`).
- Datas "só dia" vindas de formulário/API são interpretadas como `new Date(\`${yyyy-MM-dd}T12:00:00\`)` (meio-dia local), como o código atual.
- Parcelado: de 2 a 24 parcelas. Centavos que sobram ficam na última parcela.
- Copy em português do Brasil, com acentos.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Venda antiga (anterior à migration) sem parcelas: depois do backfill toda venda tem ao menos 1 parcela; nenhuma tela pode assumir `installments.length > 0` sem o backfill aplicado nos dois bancos (Task 2 testa o backfill).
- Data personalizada no dia 29/30/31: parcelas em meses curtos caem no último dia do mês e voltam ao dia original no mês seguinte (Task 1 testa 31/01 → 28/02 → 31/03).
- Edição de venda parcelada com parcela paga e total reduzido abaixo do já pago: recusa com mensagem, sem apagar itens nem estoque (Task 3 testa que nada muda no banco).
- `mark-paid` da API por `customerId` não pode quitar parcelas futuras (Task 7 testa).
- Pagar a mesma parcela duas vezes (duplo clique, duas abas): a segunda chamada não muda `paidAt` nem conta valor (Task 4 testa).
- Abrir a edição de uma venda parcelada com "Dia 5" meses depois e só trocar a observação: os vencimentos das parcelas em aberto não podem andar (Task 8, Step 1, mantém a 1ª data original; conferir no Step 6 do navegador editando uma venda e comparando as datas antes e depois).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/installments.ts` (novo) | Regras puras: divisão, calendário, plano de parcelas a partir da escolha de pagamento, resumo da venda. |
| `src/lib/installments.test.ts` (novo) | Testes unitários das regras. |
| `prisma/schema.prisma` | Model `SaleInstallment`, campos novos em `Sale`. |
| `prisma/migrations/20261009120000_sale_installments/migration.sql` (novo) | Tabela, colunas e backfill. |
| `src/test/db.ts` | `sale_installment` no reset; `backfillSaleInstallments()` para fixtures legadas. |
| `src/test/sales.ts` (novo) | `seedParceledSale()` para fixtures com várias parcelas. |
| `src/server/sales/installments.ts` (novo) | `writeInstallments`, `syncSaleSummary`, `toPlans`, `dueByWhere`. |
| `src/server/actions/sales.ts` | Criar/editar com parcelas; pagar/desfazer parcela. |
| `src/server/queries/sales.ts` | Resumo e lista com `openCents`; detalhe com parcelas; exportação. |
| `src/server/queries/customers.ts` + `src/lib/customer-balance.ts` | Saldo por parcela; parcelas em aberto do cliente; relatório. |
| `src/server/queries/dashboard.ts`, `consolidated-dashboard.ts` | Receita por parcela. |
| `src/app/api/v1/sales/route.ts`, `mark-paid/route.ts` | API com parcelas. |
| `src/components/sales/sale-form.tsx` | À vista × Parcelado, quantidade, prévia. |
| `src/components/sales/sale-installments.tsx` (novo) | Lista de parcelas na edição, com pagar/desfazer. |
| `src/components/sales/mark-as-paid-button.tsx`, `src/app/(app)/sales/page.tsx` | Selo "1/3 pagas", pagar próxima parcela, "Receber tudo" abrindo o diálogo. |
| `src/components/customers/customer-collect-dialog.tsx` | Cobrança por parcela. |
| `src/components/sales/collect-customer-button.tsx` | Removido (substituído pelo diálogo). |
| `src/server/pdf/customer-report.ts` | Linhas de parcelas em aberto. |
| `/Users/ferrari/code/coolkies-mcp/src/tools/sales.ts` | Tools com parcelas. |

---

### Task 1: Regras puras de parcelamento

**Files:**
- Create: `src/lib/installments.ts`
- Test: `src/lib/installments.test.ts`

**Interfaces:**
- Consumes: `fifthBusinessDayOfMonth(year, month)`, `resolveForecast(preset, custom?, from?)`, `type ForecastPreset` de `src/lib/business-days.ts`.
- Produces:
  - `MIN_INSTALLMENTS = 2`, `MAX_INSTALLMENTS = 24`
  - `type InstallmentPlan = { number: number; amountCents: number; dueDate: Date | null; forecastPreset: ForecastPreset | null; paidAt: Date | null }`
  - `splitAmount(totalCents: number, count: number): number[]`
  - `dueDateFor(firstDue: Date, preset: ForecastPreset, offset: number): Date`
  - `buildSchedule(firstDue: Date, preset: ForecastPreset, count: number): Date[]`
  - `type PaymentChoice = { mode: "CASH"; paidNow: true } | { mode: "CASH"; paidNow: false; preset: ForecastPreset | null; firstDue: Date | null } | { mode: "INSTALLMENTS"; count: number; preset: ForecastPreset; firstDue: Date }`
  - `type PaymentFields = { mode: string; status: string; count: number; preset: string; dueDate: Date | null }`
  - `parsePaymentChoice(fields: PaymentFields, now?: Date): PaymentChoice | { error: string }`
  - `type PlanResult = { ok: true; installments: InstallmentPlan[] } | { ok: false; error: string }`
  - `planPayment(choice: PaymentChoice, totalCents: number, existing: InstallmentPlan[], now: Date): PlanResult`
  - `type SaleSummaryFields = { status: "PAID" | "PENDING"; paidAt: Date | null; paymentForecastDate: Date | null; forecastPreset: ForecastPreset | null; openCents: number; installmentCount: number }`
  - `summarize(installments: InstallmentPlan[]): SaleSummaryFields`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { fifthBusinessDayOfMonth } from "./business-days";
import {
  buildSchedule,
  parsePaymentChoice,
  planPayment,
  splitAmount,
  summarize,
  type InstallmentPlan,
} from "./installments";

const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12);
const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

function paid(number: number, amountCents: number): InstallmentPlan {
  return { number, amountCents, dueDate: noon(2026, 10 + number - 1, 5), forecastPreset: "DAY_FIVE", paidAt: noon(2026, 10, 1) };
}

describe("splitAmount", () => {
  it("joga o resto na última parcela", () => {
    expect(splitAmount(10000, 3)).toEqual([3333, 3333, 3334]);
  });

  it("divide exato quando possível", () => {
    expect(splitAmount(30000, 3)).toEqual([10000, 10000, 10000]);
  });

  it("aceita total menor que o número de parcelas", () => {
    expect(splitAmount(2, 3)).toEqual([0, 0, 2]);
  });
});

describe("buildSchedule", () => {
  it("Dia 5 repete o dia 5 nos meses seguintes, virando o ano", () => {
    expect(buildSchedule(noon(2026, 10, 5), "DAY_FIVE", 3).map(ymd)).toEqual([
      "2026-11-05",
      "2026-12-05",
      "2027-01-05",
    ]);
  });

  it("5º dia útil é recalculado em cada mês", () => {
    const first = fifthBusinessDayOfMonth(2026, 10);
    const schedule = buildSchedule(first, "FIFTH_BUSINESS_DAY", 3);
    expect(schedule.map(ymd)).toEqual([
      ymd(fifthBusinessDayOfMonth(2026, 10)),
      ymd(fifthBusinessDayOfMonth(2026, 11)),
      ymd(fifthBusinessDayOfMonth(2027, 0)),
    ]);
  });

  it("data personalizada no dia 31 cai no último dia em mês curto e volta ao 31 depois", () => {
    expect(buildSchedule(noon(2027, 0, 31), "CUSTOM", 3).map(ymd)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });

  it("todas as datas ficam ao meio-dia local", () => {
    for (const d of buildSchedule(noon(2026, 10, 5), "DAY_FIVE", 3)) expect(d.getHours()).toBe(12);
  });
});

describe("parsePaymentChoice", () => {
  const now = noon(2026, 9, 9);

  it("à vista paga", () => {
    expect(parsePaymentChoice({ mode: "CASH", status: "PAID", count: 1, preset: "", dueDate: null }, now)).toEqual({
      mode: "CASH",
      paidNow: true,
    });
  });

  it("à vista pendente sem previsão continua sem previsão", () => {
    expect(parsePaymentChoice({ mode: "CASH", status: "PENDING", count: 1, preset: "", dueDate: null }, now)).toEqual({
      mode: "CASH",
      paidNow: false,
      preset: null,
      firstDue: null,
    });
  });

  it("parcelado com preset sem data calcula a 1ª data", () => {
    const choice = parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 3, preset: "DAY_FIVE", dueDate: null }, now);
    expect(choice).toMatchObject({ mode: "INSTALLMENTS", count: 3, preset: "DAY_FIVE" });
    expect(ymd((choice as { firstDue: Date }).firstDue)).toBe("2026-11-05");
  });

  it("parcelado com data e sem preset vira CUSTOM", () => {
    const choice = parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 2, preset: "", dueDate: noon(2026, 9, 20) }, now);
    expect(choice).toMatchObject({ mode: "INSTALLMENTS", preset: "CUSTOM" });
  });

  it("parcelado CUSTOM sem data é recusado", () => {
    expect(parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 2, preset: "CUSTOM", dueDate: null }, now)).toEqual({
      error: "Informe a data da 1ª parcela.",
    });
  });

  it("parcelado fora de 2 a 24 é recusado", () => {
    expect(parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 25, preset: "DAY_FIVE", dueDate: null }, now)).toEqual({
      error: "O parcelamento deve ter de 2 a 24 parcelas.",
    });
    expect(parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 1, preset: "DAY_FIVE", dueDate: null }, now)).toEqual({
      error: "O parcelamento deve ter de 2 a 24 parcelas.",
    });
  });
});

describe("planPayment", () => {
  const now = noon(2026, 9, 9);

  it("à vista paga vira uma parcela paga agora", () => {
    const res = planPayment({ mode: "CASH", paidNow: true }, 5000, [], now);
    expect(res).toEqual({
      ok: true,
      installments: [{ number: 1, amountCents: 5000, dueDate: null, forecastPreset: null, paidAt: now }],
    });
  });

  it("à vista paga preserva a data de pagamento de venda já quitada", () => {
    const before = noon(2026, 8, 1);
    const res = planPayment({ mode: "CASH", paidNow: true }, 6000, [{ number: 1, amountCents: 5000, dueDate: null, forecastPreset: null, paidAt: before }], now);
    expect(res.ok && res.installments[0].paidAt).toEqual(before);
  });

  it("à vista pendente recusa venda parcelada com parcela paga", () => {
    const existing = [paid(1, 3333), { ...paid(2, 3333), paidAt: null }, { ...paid(3, 3334), paidAt: null }];
    expect(planPayment({ mode: "CASH", paidNow: false, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 10000, existing, now)).toEqual({
      ok: false,
      error: "Esta venda tem parcelas pagas. Desfaça os pagamentos antes de mudar para à vista.",
    });
  });

  it("parcelado novo divide o total e monta o calendário", () => {
    const res = planPayment({ mode: "INSTALLMENTS", count: 3, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 10000, [], now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.installments.map((i) => [i.number, i.amountCents, ymd(i.dueDate), i.paidAt])).toEqual([
      [1, 3333, "2026-11-05", null],
      [2, 3333, "2026-12-05", null],
      [3, 3334, "2027-01-05", null],
    ]);
  });

  it("parcelado com parcela paga redistribui só o saldo", () => {
    const existing = [paid(1, 3333), { ...paid(2, 3333), paidAt: null }, { ...paid(3, 3334), paidAt: null }];
    const res = planPayment({ mode: "INSTALLMENTS", count: 3, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 12000, existing, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.installments.map((i) => [i.number, i.amountCents, i.paidAt !== null])).toEqual([
      [1, 3333, true],
      [2, 4333, false],
      [3, 4334, false],
    ]);
  });

  it("recusa total menor que o já pago", () => {
    const existing = [paid(1, 5000), { ...paid(2, 5000), paidAt: null }];
    expect(planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 4000, existing, now)).toEqual({
      ok: false,
      error: "O novo total é menor que o valor já pago.",
    });
  });

  it("recusa reduzir parcelas abaixo da maior parcela paga", () => {
    const existing = [{ ...paid(1, 3333), paidAt: null }, { ...paid(2, 3333), paidAt: null }, paid(3, 3334)];
    expect(planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 10000, existing, now)).toEqual({
      ok: false,
      error: "O número de parcelas não pode ser menor que 3, porque já há parcelas pagas.",
    });
  });

  it("recusa saldo sem parcela em aberto para receber", () => {
    const existing = [paid(1, 5000), paid(2, 5000)];
    expect(planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 12000, existing, now)).toEqual({
      ok: false,
      error: "Todas as parcelas já foram pagas. Aumente o número de parcelas para cobrar a diferença.",
    });
  });

  it("saldo zero descarta parcelas em aberto", () => {
    const existing = [paid(1, 5000), { ...paid(2, 5000), paidAt: null }];
    const res = planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 5000, existing, now);
    expect(res.ok && res.installments.map((i) => i.number)).toEqual([1]);
  });
});

describe("summarize", () => {
  it("venda com parcela em aberto fica pendente com a próxima previsão", () => {
    const list = [paid(1, 3333), { ...paid(2, 3333), paidAt: null }, { ...paid(3, 3334), paidAt: null }];
    expect(summarize(list)).toEqual({
      status: "PENDING",
      paidAt: null,
      paymentForecastDate: list[1].dueDate,
      forecastPreset: "DAY_FIVE",
      openCents: 6667,
      installmentCount: 3,
    });
  });

  it("venda toda paga fica paga com a data do último pagamento", () => {
    const last = noon(2026, 11, 20);
    const list = [paid(1, 5000), { ...paid(2, 5000), paidAt: last }];
    expect(summarize(list)).toEqual({
      status: "PAID",
      paidAt: last,
      paymentForecastDate: null,
      forecastPreset: null,
      openCents: 0,
      installmentCount: 2,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/installments.test.ts`
Expected: FAIL (`Cannot find module './installments'` / funções não definidas).

- [ ] **Step 3: Implement `src/lib/installments.ts`**

```ts
import { fifthBusinessDayOfMonth, resolveForecast, type ForecastPreset } from "./business-days";

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 24;

export type InstallmentPlan = {
  number: number;
  amountCents: number;
  dueDate: Date | null;
  forecastPreset: ForecastPreset | null;
  paidAt: Date | null;
};

export type PaymentChoice =
  | { mode: "CASH"; paidNow: true }
  | { mode: "CASH"; paidNow: false; preset: ForecastPreset | null; firstDue: Date | null }
  | { mode: "INSTALLMENTS"; count: number; preset: ForecastPreset; firstDue: Date };

export type PaymentFields = {
  mode: string;
  status: string;
  count: number;
  preset: string;
  dueDate: Date | null;
};

export type PlanResult = { ok: true; installments: InstallmentPlan[] } | { ok: false; error: string };

export type SaleSummaryFields = {
  status: "PAID" | "PENDING";
  paidAt: Date | null;
  paymentForecastDate: Date | null;
  forecastPreset: ForecastPreset | null;
  openCents: number;
  installmentCount: number;
};

const PRESETS: ForecastPreset[] = ["DAY_FIVE", "FIFTH_BUSINESS_DAY", "CUSTOM"];

function noon(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 12);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function splitAmount(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const amounts = Array.from({ length: count }, () => base);
  amounts[count - 1] += totalCents - base * count;
  return amounts;
}

export function dueDateFor(firstDue: Date, preset: ForecastPreset, offset: number): Date {
  const year = firstDue.getFullYear();
  const month = firstDue.getMonth() + offset;
  if (offset === 0) return noon(year, firstDue.getMonth(), firstDue.getDate());
  if (preset === "DAY_FIVE") return noon(year, month, 5);
  if (preset === "FIFTH_BUSINESS_DAY") {
    const date = fifthBusinessDayOfMonth(year, month);
    return noon(date.getFullYear(), date.getMonth(), date.getDate());
  }
  return noon(year, month, Math.min(firstDue.getDate(), lastDayOfMonth(year, month)));
}

export function buildSchedule(firstDue: Date, preset: ForecastPreset, count: number): Date[] {
  return Array.from({ length: count }, (_, offset) => dueDateFor(firstDue, preset, offset));
}

export function parsePaymentChoice(fields: PaymentFields, now: Date = new Date()): PaymentChoice | { error: string } {
  const knownPreset = PRESETS.includes(fields.preset as ForecastPreset) ? (fields.preset as ForecastPreset) : null;

  if (fields.mode !== "INSTALLMENTS") {
    if (fields.status !== "PENDING") return { mode: "CASH", paidNow: true };
    const preset = knownPreset ?? (fields.dueDate ? "CUSTOM" : null);
    const firstDue =
      fields.dueDate ?? (preset && preset !== "CUSTOM" ? resolveForecast(preset, undefined, now) : null);
    return { mode: "CASH", paidNow: false, preset, firstDue };
  }

  if (!Number.isInteger(fields.count) || fields.count < MIN_INSTALLMENTS || fields.count > MAX_INSTALLMENTS) {
    return { error: `O parcelamento deve ter de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas.` };
  }
  const preset = knownPreset ?? (fields.dueDate ? "CUSTOM" : "DAY_FIVE");
  const firstDue = fields.dueDate ?? (preset !== "CUSTOM" ? resolveForecast(preset, undefined, now) : null);
  if (!firstDue) return { error: "Informe a data da 1ª parcela." };
  return { mode: "INSTALLMENTS", count: fields.count, preset, firstDue };
}

function latestPaidAt(installments: InstallmentPlan[]): Date | null {
  return installments.reduce<Date | null>(
    (latest, i) => (i.paidAt && (!latest || i.paidAt > latest) ? i.paidAt : latest),
    null,
  );
}

export function planPayment(
  choice: PaymentChoice,
  totalCents: number,
  existing: InstallmentPlan[],
  now: Date,
): PlanResult {
  if (choice.mode === "CASH") {
    if (choice.paidNow) {
      const wasFullyPaid = existing.length > 0 && existing.every((i) => i.paidAt !== null);
      const paidAt = (wasFullyPaid ? latestPaidAt(existing) : null) ?? now;
      return {
        ok: true,
        installments: [{ number: 1, amountCents: totalCents, dueDate: null, forecastPreset: null, paidAt }],
      };
    }
    if (existing.length > 1 && existing.some((i) => i.paidAt !== null)) {
      return { ok: false, error: "Esta venda tem parcelas pagas. Desfaça os pagamentos antes de mudar para à vista." };
    }
    return {
      ok: true,
      installments: [
        { number: 1, amountCents: totalCents, dueDate: choice.firstDue, forecastPreset: choice.preset, paidAt: null },
      ],
    };
  }

  const paid = existing.filter((i) => i.paidAt !== null);
  const paidCents = paid.reduce((sum, i) => sum + i.amountCents, 0);
  if (totalCents < paidCents) return { ok: false, error: "O novo total é menor que o valor já pago." };

  const minCount = paid.reduce((max, i) => Math.max(max, i.number), 0);
  if (choice.count < minCount) {
    return {
      ok: false,
      error: `O número de parcelas não pode ser menor que ${minCount}, porque já há parcelas pagas.`,
    };
  }

  const remaining = totalCents - paidCents;
  const paidNumbers = new Set(paid.map((i) => i.number));
  const openNumbers = Array.from({ length: choice.count }, (_, idx) => idx + 1).filter((n) => !paidNumbers.has(n));

  if (remaining === 0) return { ok: true, installments: [...paid].sort((a, b) => a.number - b.number) };
  if (openNumbers.length === 0) {
    return {
      ok: false,
      error: "Todas as parcelas já foram pagas. Aumente o número de parcelas para cobrar a diferença.",
    };
  }

  const amounts = splitAmount(remaining, openNumbers.length);
  const open: InstallmentPlan[] = openNumbers.map((number, idx) => ({
    number,
    amountCents: amounts[idx],
    dueDate: dueDateFor(choice.firstDue, choice.preset, number - 1),
    forecastPreset: choice.preset,
    paidAt: null,
  }));
  return { ok: true, installments: [...paid, ...open].sort((a, b) => a.number - b.number) };
}

export function summarize(installments: InstallmentPlan[]): SaleSummaryFields {
  const open = installments.filter((i) => i.paidAt === null).sort((a, b) => a.number - b.number);
  const openCents = open.reduce((sum, i) => sum + i.amountCents, 0);
  if (open.length === 0) {
    return {
      status: "PAID",
      paidAt: latestPaidAt(installments),
      paymentForecastDate: null,
      forecastPreset: null,
      openCents: 0,
      installmentCount: installments.length,
    };
  }
  return {
    status: "PENDING",
    paidAt: null,
    paymentForecastDate: open[0].dueDate,
    forecastPreset: open[0].forecastPreset,
    openCents,
    installmentCount: installments.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/installments.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/installments.ts src/lib/installments.test.ts
git commit -m "feat(vendas): regras de divisão e calendário de parcelas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema, migration, helpers de banco e de teste

**Files:**
- Modify: `prisma/schema.prisma` (model `Sale`, `Workspace`, novo `SaleInstallment`)
- Create: `prisma/migrations/20261009120000_sale_installments/migration.sql`
- Modify: `src/test/db.ts`
- Create: `src/test/sales.ts`
- Create: `src/server/sales/installments.ts`
- Test: `src/server/sales/installments.test.ts`

**Interfaces:**
- Consumes: `InstallmentPlan`, `summarize` (Task 1).
- Produces:
  - `writeInstallments(tx: Prisma.TransactionClient, saleId: string, workspaceId: string, plans: InstallmentPlan[]): Promise<void>` — substitui todas as parcelas da venda e grava o resumo.
  - `syncSaleSummary(tx: Prisma.TransactionClient, saleIds: string[]): Promise<void>` — recalcula o resumo a partir das parcelas no banco.
  - `toPlans(rows: { number: number; amountCents: number; dueDate: Date | null; forecastPreset: ForecastPreset | null; paidAt: Date | null }[]): InstallmentPlan[]`
  - `dueByWhere(cutoff: Date): Prisma.SaleInstallmentWhereInput` — `{ OR: [{ dueDate: { lte: cutoff } }, { dueDate: null }] }`.
  - Teste: `backfillSaleInstallments(): Promise<void>` em `src/test/db.ts`; `seedParceledSale(input): Promise<Sale & { installments: SaleInstallment[] }>` em `src/test/sales.ts`.

- [ ] **Step 1: Schema**

Em `prisma/schema.prisma`, dentro de `model Sale`, depois de `totalCents Int @default(0)`:

```prisma
  installmentCount Int @default(1)
  openCents        Int @default(0)
```

e depois de `items SaleItem[]`:

```prisma
  installments SaleInstallment[]
```

Em `model Workspace`, depois de `saleItems SaleItem[]`:

```prisma
  saleInstallments       SaleInstallment[]
```

Depois de `model SaleItem { ... }`:

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

- [ ] **Step 2: Migration SQL**

`prisma/migrations/20261009120000_sale_installments/migration.sql`:

```sql
BEGIN;

ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "installmentCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "openCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "sale_installment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "forecastPreset" "ForecastPreset",
    "paidAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sale_installment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_installment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_installment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sale_installment_saleId_number_key" ON "sale_installment"("saleId", "number");
CREATE INDEX IF NOT EXISTS "sale_installment_workspaceId_paidAt_dueDate_idx" ON "sale_installment"("workspaceId", "paidAt", "dueDate");

INSERT INTO "sale_installment" ("id", "saleId", "number", "amountCents", "dueDate", "forecastPreset", "paidAt", "workspaceId", "updatedAt")
SELECT
    'inst_' || s."id",
    s."id",
    1,
    s."totalCents",
    s."paymentForecastDate",
    s."forecastPreset",
    CASE WHEN s."status" = 'PAID' THEN COALESCE(s."paidAt", s."soldAt") END,
    s."workspaceId",
    CURRENT_TIMESTAMP
FROM "sale" s
WHERE NOT EXISTS (SELECT 1 FROM "sale_installment" i WHERE i."saleId" = s."id");

UPDATE "sale"
SET "openCents" = CASE WHEN "status" = 'PENDING' THEN "totalCents" ELSE 0 END
WHERE "installmentCount" = 1;

COMMIT;
```

- [ ] **Step 3: Aplicar nos dois bancos e gerar o client**

```bash
docker exec -i cookies_db psql -U cookies -d cookies < prisma/migrations/20261009120000_sale_installments/migration.sql
```
```bash
docker exec -i cookies_db psql -U cookies -d cookies_test < prisma/migrations/20261009120000_sale_installments/migration.sql
```
```bash
pnpm exec prisma generate
```

Conferir no banco de dev que toda venda tem parcela:

```bash
docker exec cookies_db psql -U cookies -d cookies -c "SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM sale_installment i WHERE i.\"saleId\" = s.id)) AS sem_parcela, count(*) AS vendas FROM sale s"
```
Expected: `sem_parcela = 0`.

- [ ] **Step 4: Helpers de teste**

Em `src/test/db.ts`, incluir `"sale_installment"` na lista `TABLES`, logo antes de `"sale_item"`, e acrescentar ao fim do arquivo:

```ts
export async function backfillSaleInstallments() {
  await testDb.$executeRawUnsafe(`
    INSERT INTO "sale_installment" ("id", "saleId", "number", "amountCents", "dueDate", "forecastPreset", "paidAt", "workspaceId", "updatedAt")
    SELECT 'inst_' || s."id", s."id", 1, s."totalCents", s."paymentForecastDate", s."forecastPreset",
      CASE WHEN s."status" = 'PAID' THEN COALESCE(s."paidAt", s."soldAt") END, s."workspaceId", CURRENT_TIMESTAMP
    FROM "sale" s
    WHERE NOT EXISTS (SELECT 1 FROM "sale_installment" i WHERE i."saleId" = s."id")
  `);
  await testDb.$executeRawUnsafe(`
    UPDATE "sale" SET "openCents" = CASE WHEN "status" = 'PENDING' THEN "totalCents" ELSE 0 END
    WHERE "installmentCount" = 1
  `);
}
```

`src/test/sales.ts`:

```ts
import { summarize, type InstallmentPlan } from "@/lib/installments";
import { testDb } from "./db";

export async function seedParceledSale(input: {
  workspaceId: string;
  userId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  soldAt?: Date;
  parcels: { amountCents: number; dueDate: Date | null; paidAt?: Date | null }[];
}) {
  const plans: InstallmentPlan[] = input.parcels.map((p, idx) => ({
    number: idx + 1,
    amountCents: p.amountCents,
    dueDate: p.dueDate,
    forecastPreset: p.dueDate ? "CUSTOM" : null,
    paidAt: p.paidAt ?? null,
  }));
  const totalCents = plans.reduce((sum, p) => sum + p.amountCents, 0);
  return testDb.sale.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      customerId: input.customerId ?? null,
      customerName: input.customerName ?? null,
      soldAt: input.soldAt ?? new Date(),
      totalCents,
      ...summarize(plans),
      installments: { create: plans.map((p) => ({ ...p, workspaceId: input.workspaceId })) },
    },
    include: { installments: { orderBy: { number: "asc" } } },
  });
}
```

- [ ] **Step 5: Write the failing test for the DB helpers**

`src/server/sales/installments.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { backfillSaleInstallments, createWorkspace, resetDb, testDb } from "@/test/db";
import { syncSaleSummary, writeInstallments } from "./installments";

describe("parcelas no banco", () => {
  let workspaceId = "";

  beforeEach(async () => {
    await resetDb();
    workspaceId = (await createWorkspace("Parcelas")).id;
  });

  it("backfill cria uma parcela por venda legada com o resumo coerente", async () => {
    const forecast = new Date(2026, 10, 5, 12);
    const pending = await testDb.sale.create({
      data: { workspaceId, totalCents: 5000, status: "PENDING", paymentForecastDate: forecast, forecastPreset: "DAY_FIVE" },
    });
    const paid = await testDb.sale.create({ data: { workspaceId, totalCents: 3000, status: "PAID", paidAt: null } });

    await backfillSaleInstallments();

    const rows = await testDb.saleInstallment.findMany({ orderBy: { amountCents: "asc" } });
    expect(rows.map((r) => [r.saleId, r.number, r.amountCents, r.dueDate, r.paidAt !== null])).toEqual([
      [paid.id, 1, 3000, null, true],
      [pending.id, 1, 5000, forecast, false],
    ]);
    const sales = await testDb.sale.findMany({ orderBy: { totalCents: "asc" }, select: { openCents: true } });
    expect(sales.map((s) => s.openCents)).toEqual([0, 5000]);
  });

  it("writeInstallments troca as parcelas e grava o resumo; syncSaleSummary recalcula após pagamento", async () => {
    const sale = await testDb.sale.create({ data: { workspaceId, totalCents: 10000 } });
    const due = (m: number) => new Date(2026, m, 5, 12);

    await testDb.$transaction((tx) =>
      writeInstallments(tx, sale.id, workspaceId, [
        { number: 1, amountCents: 3333, dueDate: due(10), forecastPreset: "DAY_FIVE", paidAt: null },
        { number: 2, amountCents: 3333, dueDate: due(11), forecastPreset: "DAY_FIVE", paidAt: null },
        { number: 3, amountCents: 3334, dueDate: due(12), forecastPreset: "DAY_FIVE", paidAt: null },
      ]),
    );

    let saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.installmentCount, saved.paymentForecastDate]).toEqual([
      "PENDING",
      10000,
      3,
      due(10),
    ]);

    await testDb.saleInstallment.update({
      where: { saleId_number: { saleId: sale.id, number: 1 } },
      data: { paidAt: new Date() },
    });
    await testDb.$transaction((tx) => syncSaleSummary(tx, [sale.id]));

    saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paymentForecastDate]).toEqual(["PENDING", 6667, due(11)]);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run src/server/sales/installments.test.ts`
Expected: FAIL (`Cannot find module './installments'`).

- [ ] **Step 7: Implement `src/server/sales/installments.ts`**

```ts
import type { ForecastPreset, Prisma } from "@prisma/client";
import { summarize, type InstallmentPlan } from "@/lib/installments";

type InstallmentRow = {
  number: number;
  amountCents: number;
  dueDate: Date | null;
  forecastPreset: ForecastPreset | null;
  paidAt: Date | null;
};

export function toPlans(rows: InstallmentRow[]): InstallmentPlan[] {
  return rows.map(({ number, amountCents, dueDate, forecastPreset, paidAt }) => ({
    number,
    amountCents,
    dueDate,
    forecastPreset,
    paidAt,
  }));
}

export function dueByWhere(cutoff: Date): Prisma.SaleInstallmentWhereInput {
  return { OR: [{ dueDate: { lte: cutoff } }, { dueDate: null }] };
}

export async function writeInstallments(
  tx: Prisma.TransactionClient,
  saleId: string,
  workspaceId: string,
  plans: InstallmentPlan[],
): Promise<void> {
  await tx.saleInstallment.deleteMany({ where: { saleId } });
  await tx.saleInstallment.createMany({
    data: plans.map((plan) => ({ ...plan, saleId, workspaceId })),
  });
  await tx.sale.update({ where: { id: saleId }, data: summarize(plans) });
}

export async function syncSaleSummary(tx: Prisma.TransactionClient, saleIds: string[]): Promise<void> {
  const rows = await tx.saleInstallment.findMany({
    where: { saleId: { in: saleIds } },
    orderBy: { number: "asc" },
  });
  for (const saleId of saleIds) {
    const plans = toPlans(rows.filter((row) => row.saleId === saleId));
    await tx.sale.update({ where: { id: saleId }, data: summarize(plans) });
  }
}
```

- [ ] **Step 8: Run tests**

Run: `pnpm vitest run src/server/sales/installments.test.ts src/lib/installments.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS em toda a suíte (nenhuma consulta mudou ainda).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261009120000_sale_installments src/test/db.ts src/test/sales.ts src/server/sales
git commit -m "feat(vendas): tabela de parcelas com backfill e resumo na venda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Criar e editar venda com parcelas

**Files:**
- Modify: `src/server/actions/sales.ts` (`createSale`, `updateSale`)
- Test: `src/server/actions/sales-installments.test.ts`

**Interfaces:**
- Consumes: `parsePaymentChoice`, `planPayment` (Task 1); `writeInstallments`, `toPlans` (Task 2).
- Produces: `createSale(formData)` e `updateSale(id, formData)` leem os campos de formulário `paymentMode` (`"CASH" | "INSTALLMENTS"`), `installmentCount`, `status`, `forecastPreset`, `forecastDate` (yyyy-MM-dd). A UI (Task 8) envia exatamente esses nomes.

- [ ] **Step 1: Write the failing tests**

`src/server/actions/sales-installments.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "" };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({ ...context, role: "OWNER", db: scopedDb(context.workspaceId) }),
  assertCanWrite: async () => {},
}));

const { createSale, updateSale } = await import("./sales");

let itemId = "";

function form(fields: Record<string, string>, unitPriceCents = 10000, quantity = 1) {
  const fd = new FormData();
  fd.set("soldAt", "2026-10-09");
  fd.set("items", JSON.stringify([{ itemId, productName: "Bolo", variantId: null, variantName: null, quantity, unitPriceCents }]));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

async function installmentsOf(saleId: string) {
  return testDb.saleInstallment.findMany({ where: { saleId }, orderBy: { number: "asc" } });
}

describe("createSale / updateSale com parcelas", () => {
  beforeEach(async () => {
    await resetDb();
    const ws = await createWorkspace("Vendas");
    const user = await testDb.user.create({ data: { id: `u-${ws.id}`, name: "Dona", email: `d-${ws.id}@example.com` } });
    context.workspaceId = ws.id;
    context.userId = user.id;
    itemId = (
      await testDb.item.create({ data: { name: "Bolo", unit: "UN", sellable: true, productionInput: false, workspaceId: ws.id } })
    ).id;
  });

  it("à vista paga cria uma parcela paga", async () => {
    const res = await createSale(form({ paymentMode: "CASH", status: "PAID" }));
    expect(res.ok).toBe(true);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: res.data!.id } });
    expect([sale.status, sale.openCents, sale.installmentCount]).toEqual(["PAID", 0, 1]);
    const parcels = await installmentsOf(sale.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt !== null])).toEqual([[10000, true]]);
  });

  it("parcelado em 3x divide o total e agenda mês a mês", async () => {
    const res = await createSale(
      form({ paymentMode: "INSTALLMENTS", installmentCount: "3", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }),
    );
    expect(res.ok).toBe(true);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: res.data!.id } });
    expect([sale.status, sale.openCents, sale.installmentCount, ymd(sale.paymentForecastDate)]).toEqual([
      "PENDING",
      10000,
      3,
      "2026-10-20",
    ]);
    const parcels = await installmentsOf(sale.id);
    expect(parcels.map((p) => [p.amountCents, ymd(p.dueDate)])).toEqual([
      [3333, "2026-10-20"],
      [3333, "2026-11-20"],
      [3334, "2026-12-20"],
    ]);
  });

  it("recusa parcelado com 25 parcelas sem gravar nada", async () => {
    const res = await createSale(form({ paymentMode: "INSTALLMENTS", installmentCount: "25", forecastPreset: "DAY_FIVE" }));
    expect(res).toEqual({ ok: false, error: "O parcelamento deve ter de 2 a 24 parcelas." });
    expect(await testDb.sale.count()).toBe(0);
  });

  it("edição com parcela paga redistribui o saldo nas parcelas em aberto", async () => {
    const res = await createSale(
      form({ paymentMode: "INSTALLMENTS", installmentCount: "3", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }),
    );
    const saleId = res.data!.id;
    await testDb.saleInstallment.update({
      where: { saleId_number: { saleId, number: 1 } },
      data: { paidAt: new Date() },
    });

    const upd = await updateSale(
      saleId,
      form({ paymentMode: "INSTALLMENTS", installmentCount: "3", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }, 12000),
    );
    expect(upd).toEqual({ ok: true });
    const parcels = await installmentsOf(saleId);
    expect(parcels.map((p) => [p.number, p.amountCents, p.paidAt !== null])).toEqual([
      [1, 3333, true],
      [2, 4333, false],
      [3, 4334, false],
    ]);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect([sale.totalCents, sale.openCents]).toEqual([12000, 8667]);
  });

  it("edição que reduz o total abaixo do pago é recusada e não altera itens nem estoque", async () => {
    const res = await createSale(
      form({ paymentMode: "INSTALLMENTS", installmentCount: "2", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }),
    );
    const saleId = res.data!.id;
    await testDb.saleInstallment.update({
      where: { saleId_number: { saleId, number: 1 } },
      data: { paidAt: new Date() },
    });

    const upd = await updateSale(
      saleId,
      form({ paymentMode: "INSTALLMENTS", installmentCount: "2", forecastPreset: "CUSTOM", forecastDate: "2026-10-20" }, 4000),
    );
    expect(upd).toEqual({ ok: false, error: "O novo total é menor que o valor já pago." });
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
    expect([sale.totalCents, sale.items.length]).toEqual([10000, 1]);
    expect(await testDb.stockMovement.count({ where: { saleId } })).toBe(1);
  });

  it("editar venda à vista já paga mantém a data de pagamento original", async () => {
    const res = await createSale(form({ paymentMode: "CASH", status: "PAID" }));
    const saleId = res.data!.id;
    const original = new Date(2026, 8, 1, 12);
    await testDb.saleInstallment.updateMany({ where: { saleId }, data: { paidAt: original } });
    await testDb.sale.update({ where: { id: saleId }, data: { paidAt: original } });

    await updateSale(saleId, form({ paymentMode: "CASH", status: "PAID", notes: "ajuste" }));

    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.paidAt).toEqual(original);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/server/actions/sales-installments.test.ts`
Expected: FAIL (vendas sem parcelas; `installmentCount` fica 1 com 0 parcelas; mensagens diferentes).

- [ ] **Step 3: Implement**

Em `src/server/actions/sales.ts`, adicionar imports:

```ts
import { parsePaymentChoice, planPayment, type PaymentFields } from "@/lib/installments";
import { toPlans, writeInstallments } from "@/server/sales/installments";
```

Adicionar, junto aos helpers internos (depois de `parseDiscount`):

```ts
function readPaymentFields(formData: FormData): PaymentFields {
  const dateRaw = String(formData.get("forecastDate") ?? "").trim();
  return {
    mode: String(formData.get("paymentMode") ?? "CASH"),
    status: String(formData.get("status") ?? "PAID"),
    count: parseInt(String(formData.get("installmentCount") ?? "1"), 10) || 1,
    preset: String(formData.get("forecastPreset") ?? ""),
    dueDate: dateRaw ? new Date(`${dateRaw}T12:00:00`) : null,
  };
}

function saleItemsCreate(items: SaleItemInput[], workspaceId: string) {
  return items.map((item) => ({
    itemId: item.itemId,
    productNameSnapshot: item.productName,
    variantId: item.variantId,
    variantNameSnapshot: item.variantName,
    quantity: item.quantity,
    unitPriceSnapshot: item.unitPriceCents,
    workspaceId,
  }));
}
```

Substituir o corpo de `createSale` a partir das leituras de pagamento. Remover as variáveis `status`, `forecastPreset`, `forecastDateRaw`, `paymentForecastDate` e usar:

```ts
  const choice = parsePaymentChoice(readPaymentFields(formData));
  if ("error" in choice) return { ok: false, error: choice.error };
```

Depois de calcular `totalCents`:

```ts
  const plan = planPayment(choice, totalCents, [], new Date());
  if (!plan.ok) return { ok: false, error: plan.error };

  try {
    const sale = await db.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          userId,
          customerId,
          customerName,
          soldAt,
          notes,
          discountType,
          discountValue,
          totalCents,
          workspaceId,
          items: { create: saleItemsCreate(items, workspaceId) },
        },
      });
      for (const item of items) {
        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            variantId: item.variantId,
            type: StockMovementType.SALE,
            quantity: -item.quantity,
            saleId: created.id,
            workspaceId,
          },
        });
      }
      await writeInstallments(tx, created.id, workspaceId, plan.installments);
      return created;
    });

    revalidatePath("/sales");
    revalidatePath("/stock");
    return { ok: true, data: { id: sale.id } };
  } catch (e) {
    console.error("createSale error:", e);
    return { ok: false, error: "Erro ao registrar venda." };
  }
```

Em `updateSale`, mesma troca de leitura (`choice`) e, depois de `totalCents`:

```ts
  const existing = await db.saleInstallment.findMany({ where: { saleId: id }, orderBy: { number: "asc" } });
  const plan = planPayment(choice, totalCents, toPlans(existing), new Date());
  if (!plan.ok) return { ok: false, error: plan.error };

  try {
    await db.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { saleId: id } });
      await tx.saleItem.deleteMany({ where: { saleId: id } });
      await tx.sale.update({
        where: { id },
        data: {
          customerId,
          customerName,
          soldAt,
          notes,
          discountType,
          discountValue,
          totalCents,
          items: { create: saleItemsCreate(items, workspaceId) },
        },
      });
      for (const item of items) {
        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            variantId: item.variantId,
            type: StockMovementType.SALE,
            quantity: -item.quantity,
            saleId: id,
            workspaceId,
          },
        });
      }
      await writeInstallments(tx, id, workspaceId, plan.installments);
    });

    revalidatePath("/sales");
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    console.error("updateSale error:", e);
    return { ok: false, error: "Erro ao atualizar venda." };
  }
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/server/actions/sales-installments.test.ts src/server/actions/sales-write-lock.test.ts`
Expected: PASS. Se `sales-write-lock.test.ts` montar `FormData` sem `paymentMode`, ele continua válido (padrão `CASH`).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/sales.ts src/server/actions/sales-installments.test.ts
git commit -m "feat(vendas): criar e editar venda à vista ou parcelada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pagar e desfazer por parcela

**Files:**
- Modify: `src/server/actions/sales.ts` (remover `markAsPaid`, `markAsPending`, `markSalesAsPaid`, `markCustomerSalesAsPaid`; adicionar novas)
- Modify: `src/server/actions/sales-payments.test.ts` (reescrito)

**Interfaces:**
- Consumes: `syncSaleSummary` (Task 2).
- Produces:
  - `payInstallments(installmentIds: string[]): Promise<ActionResult<{ count: number; totalCents: number }>>`
  - `unpayInstallments(installmentIds: string[]): Promise<ActionResult>`
  - `payNextInstallment(saleId: string): Promise<ActionResult<{ installmentId: string; number: number; installmentCount: number; amountCents: number }>>`

As telas que chamavam as funções removidas são ajustadas nas Tasks 8 e 9; até lá `pnpm exec tsc --noEmit` acusa os imports quebrados em `mark-as-paid-button.tsx`, `customer-collect-dialog.tsx` e `collect-customer-button.tsx`. Isso é esperado e resolvido nessas tasks.

- [ ] **Step 1: Rewrite the tests**

Substituir `src/server/actions/sales-payments.test.ts` por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "" };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({ ...context, role: "OWNER", db: scopedDb(context.workspaceId) }),
  assertCanWrite: async () => {},
}));

const { payInstallments, unpayInstallments, payNextInstallment } = await import("./sales");

const due = (m: number) => new Date(2026, m, 5, 12);

describe("pagamento por parcela", () => {
  beforeEach(async () => {
    await resetDb();
    context.workspaceId = (await createWorkspace("Cookies")).id;
  });

  async function threeParcels() {
    return seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [
        { amountCents: 3333, dueDate: due(10) },
        { amountCents: 3333, dueDate: due(11) },
        { amountCents: 3334, dueDate: due(12) },
      ],
    });
  }

  it("pagar uma parcela não quita a venda", async () => {
    const sale = await threeParcels();
    const res = await payInstallments([sale.installments[0].id]);
    expect(res).toEqual({ ok: true, data: { count: 1, totalCents: 3333 } });
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paymentForecastDate]).toEqual(["PENDING", 6667, due(11)]);
  });

  it("pagar todas quita a venda", async () => {
    const sale = await threeParcels();
    await payInstallments(sale.installments.map((i) => i.id));
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paidAt !== null]).toEqual(["PAID", 0, true]);
  });

  it("pagar de novo a mesma parcela não muda a data nem soma valor", async () => {
    const sale = await threeParcels();
    await payInstallments([sale.installments[0].id]);
    const first = await testDb.saleInstallment.findUniqueOrThrow({ where: { id: sale.installments[0].id } });
    const res = await payInstallments([sale.installments[0].id]);
    expect(res).toEqual({ ok: false, error: "Nenhuma parcela em aberto selecionada." });
    const again = await testDb.saleInstallment.findUniqueOrThrow({ where: { id: sale.installments[0].id } });
    expect(again.paidAt).toEqual(first.paidAt);
  });

  it("desfazer reabre a parcela e a venda", async () => {
    const sale = await threeParcels();
    await payInstallments(sale.installments.map((i) => i.id));
    expect(await unpayInstallments([sale.installments[2].id])).toEqual({ ok: true });
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents, saved.paymentForecastDate]).toEqual(["PENDING", 3334, due(12)]);
  });

  it("payNextInstallment paga a primeira parcela em aberto", async () => {
    const sale = await threeParcels();
    await payInstallments([sale.installments[0].id]);
    const res = await payNextInstallment(sale.id);
    expect(res).toEqual({
      ok: true,
      data: { installmentId: sale.installments[1].id, number: 2, installmentCount: 3, amountCents: 3333 },
    });
  });

  it("não paga parcela de outro workspace", async () => {
    const other = await createWorkspace("Outra");
    const foreign = await seedParceledSale({ workspaceId: other.id, parcels: [{ amountCents: 1000, dueDate: due(10) }] });
    const res = await payInstallments([foreign.installments[0].id]);
    expect(res).toEqual({ ok: false, error: "Nenhuma parcela em aberto selecionada." });
  });

  it("recusa lista vazia", async () => {
    expect(await payInstallments([])).toEqual({ ok: false, error: "Selecione ao menos uma parcela." });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/server/actions/sales-payments.test.ts`
Expected: FAIL (`payInstallments is not a function`).

- [ ] **Step 3: Implement**

Em `src/server/actions/sales.ts`, apagar as seções `markAsPaid`, `markCustomerSalesAsPaid`, `markSalesAsPaid` e `markAsPending`, adicionar o import `syncSaleSummary` (junto de `toPlans, writeInstallments`) e colocar no lugar:

```ts
function revalidatePayments() {
  revalidatePath("/sales");
  revalidatePath("/customers");
  revalidatePath("/dashboard");
}

export async function payInstallments(
  installmentIds: string[],
): Promise<ActionResult<{ count: number; totalCents: number }>> {
  if (installmentIds.length === 0) return { ok: false, error: "Selecione ao menos uma parcela." };

  const { db } = await getScopedDb();
  await assertCanWrite();

  const open = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: null },
    select: { id: true, saleId: true, amountCents: true },
  });
  if (open.length === 0) return { ok: false, error: "Nenhuma parcela em aberto selecionada." };

  await db.$transaction(async (tx) => {
    await tx.saleInstallment.updateMany({
      where: { id: { in: open.map((i) => i.id) }, paidAt: null },
      data: { paidAt: new Date() },
    });
    await syncSaleSummary(tx, [...new Set(open.map((i) => i.saleId))]);
  });

  revalidatePayments();
  return {
    ok: true,
    data: { count: open.length, totalCents: open.reduce((sum, i) => sum + i.amountCents, 0) },
  };
}

export async function unpayInstallments(installmentIds: string[]): Promise<ActionResult> {
  if (installmentIds.length === 0) return { ok: false, error: "Selecione ao menos uma parcela." };

  const { db } = await getScopedDb();
  await assertCanWrite();

  const paid = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: { not: null } },
    select: { id: true, saleId: true },
  });
  if (paid.length === 0) return { ok: false, error: "Não foi possível desfazer." };

  await db.$transaction(async (tx) => {
    await tx.saleInstallment.updateMany({
      where: { id: { in: paid.map((i) => i.id) } },
      data: { paidAt: null },
    });
    await syncSaleSummary(tx, [...new Set(paid.map((i) => i.saleId))]);
  });

  revalidatePayments();
  return { ok: true };
}

export async function payNextInstallment(
  saleId: string,
): Promise<ActionResult<{ installmentId: string; number: number; installmentCount: number; amountCents: number }>> {
  const { db } = await getScopedDb();
  await assertCanWrite();

  const next = await db.saleInstallment.findFirst({
    where: { saleId, paidAt: null },
    orderBy: { number: "asc" },
    select: { id: true, number: true, amountCents: true, sale: { select: { installmentCount: true } } },
  });
  if (!next) return { ok: false, error: "Esta venda não tem parcela em aberto." };

  const res = await payInstallments([next.id]);
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: {
      installmentId: next.id,
      number: next.number,
      installmentCount: next.sale.installmentCount,
      amountCents: next.amountCents,
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/server/actions/sales-payments.test.ts src/server/actions/sales-installments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/sales.ts src/server/actions/sales-payments.test.ts
git commit -m "feat(vendas): pagar e desfazer pagamento por parcela

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Consultas de vendas e clientes por parcela

**Files:**
- Modify: `src/server/queries/sales.ts` (`getSales`, `getSalesSummary`, `getSaleById`, `getSalesForExport`; novo `computeSalesSummary`)
- Modify: `src/lib/customer-balance.ts` (novo `aggregateOpenInstallments`)
- Modify: `src/server/queries/customers.ts` (`getCustomersWithBalance`, `getPendingSalesByCustomer` → `getOpenInstallmentsByCustomer`, `getCustomerReport`)
- Modify: `src/app/(app)/sales/export/route.ts` (colunas novas)
- Test: `src/lib/customer-balance.test.ts`, `src/server/queries/customers-balance.test.ts`, `src/server/queries/sales-export.test.ts`, novo `src/server/queries/sales-summary.test.ts`

**Interfaces:**
- Consumes: `dueByWhere` (Task 2); `seedParceledSale`, `backfillSaleInstallments` (Task 2).
- Produces:
  - `computeSalesSummary(db: PrismaClient, base: Prisma.SaleWhereInput): Promise<SalesSummaryData>` com `SalesSummaryData = { pendingCents; pendingCount; paidCents; paidCount; overdueCents; overdueCount }` (mesmo shape de hoje).
  - `getSales` passa a incluir `_count: { select: { installments: { where: { paidAt: null } } } }` (use `sale._count.installments` como "parcelas em aberto").
  - `getSaleById` inclui `installments: { orderBy: { number: "asc" }, select: { id, number, amountCents, dueDate, forecastPreset, paidAt } }`.
  - `getOpenInstallmentsByCustomer(customerId: string, forecastTo?: string)` → `{ id: string; number: number; amountCents: number; dueDate: Date | null; sale: { id: string; soldAt: Date; installmentCount: number; notes: string | null } }[]`, ordenado por `sale.soldAt` e `number`.
  - `aggregateOpenInstallments(rows: { saleId: string; customerId: string | null; amountCents: number; dueDate: Date | null }[]): CustomerPendingRow[]` — `pendingCount` = vendas distintas.
  - `CustomerReportSale` ganha `openInstallments: { number: number; amountCents: number; dueDate: Date | null }[]` e `installmentCount: number`.
  - `SaleExportRow` ganha `installments: string` ("1/3 pagas" ou "" à vista) e `openCents: number`.

- [ ] **Step 1: Write failing tests**

`src/server/queries/sales-summary.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";
import { computeSalesSummary } from "./sales";

describe("computeSalesSummary", () => {
  let workspaceId = "";
  beforeEach(async () => {
    await resetDb();
    workspaceId = (await createWorkspace("Resumo")).id;
  });

  it("pendente soma só o em aberto; vencido soma só parcelas vencidas; recebido inclui parcelas pagas", async () => {
    const past = new Date(Date.now() - 10 * 86400000);
    const future = new Date(Date.now() + 40 * 86400000);
    await seedParceledSale({
      workspaceId,
      parcels: [
        { amountCents: 3000, dueDate: past, paidAt: past },
        { amountCents: 3000, dueDate: past },
        { amountCents: 4000, dueDate: future },
      ],
    });

    const summary = await computeSalesSummary(scopedDb(workspaceId), {});

    expect(summary).toEqual({
      pendingCents: 7000,
      pendingCount: 1,
      paidCents: 3000,
      paidCount: 0,
      overdueCents: 3000,
      overdueCount: 1,
    });
  });
});
```

Em `src/lib/customer-balance.test.ts`, acrescentar:

```ts
describe("aggregateOpenInstallments", () => {
  it("soma por cliente, conta vendas distintas e guarda o vencimento mais antigo", () => {
    const a = new Date(2026, 10, 5);
    const b = new Date(2026, 11, 5);
    expect(
      aggregateOpenInstallments([
        { saleId: "s1", customerId: "c1", amountCents: 100, dueDate: b },
        { saleId: "s1", customerId: "c1", amountCents: 100, dueDate: a },
        { saleId: "s2", customerId: "c1", amountCents: 50, dueDate: null },
        { saleId: "s3", customerId: null, amountCents: 999, dueDate: a },
      ]),
    ).toEqual([{ customerId: "c1", pendingCents: 250, pendingCount: 2, oldestForecastDate: a }]);
  });
});
```

(com `aggregateOpenInstallments` acrescentado ao import existente de `./customer-balance`).

Em `src/server/queries/customers-balance.test.ts`: importar `backfillSaleInstallments` de `@/test/db` e `seedParceledSale` de `@/test/sales`; chamar `await backfillSaleInstallments()` no fim de cada bloco que semeia vendas com `testDb.sale.create` (no `beforeEach` depois das criações, ou no início de cada `it` logo após as criações). Trocar o `describe` de `getPendingSalesByCustomer` para `getOpenInstallmentsByCustomer`, ajustando as asserções de `id`/`totalCents` para `sale.id`/`amountCents`, e acrescentar:

```ts
  it("lista parcelas em aberto de venda parcelada, respeitando o corte de data", async () => {
    const sale = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: anaId,
      parcels: [
        { amountCents: 3333, dueDate: new Date(2026, 10, 5, 12), paidAt: new Date(2026, 10, 5, 12) },
        { amountCents: 3333, dueDate: new Date(2026, 11, 5, 12) },
        { amountCents: 3334, dueDate: new Date(2027, 0, 5, 12) },
      ],
    });

    const rows = await getOpenInstallmentsByCustomer(anaId, "2026-12-31");

    expect(rows.filter((r) => r.sale.id === sale.id).map((r) => [r.number, r.amountCents])).toEqual([[2, 3333]]);
  });
```

(`anaId` = nome da variável do cliente já usada no arquivo; ajustar ao nome real.)

Em `src/server/queries/sales-export.test.ts`: chamar `await backfillSaleInstallments()` depois de semear as vendas e acrescentar às linhas esperadas `installments: ""` e `openCents` (igual a `totalCents` se `PENDING`, `0` se `PAID`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/server/queries/sales-summary.test.ts src/lib/customer-balance.test.ts src/server/queries/customers-balance.test.ts src/server/queries/sales-export.test.ts`
Expected: FAIL (`computeSalesSummary`, `aggregateOpenInstallments`, `getOpenInstallmentsByCustomer` inexistentes; colunas faltando).

- [ ] **Step 3: Implement `src/server/queries/sales.ts`**

Imports: `import type { Prisma, PrismaClient } from "@prisma/client";`

Substituir `getSalesSummary` por:

```ts
export type SalesSummary = Awaited<ReturnType<typeof computeSalesSummary>>;

export async function computeSalesSummary(db: PrismaClient, base: Prisma.SaleWhereInput) {
  const now = new Date();
  const [groups, overdue, overdueCount] = await Promise.all([
    db.sale.groupBy({
      by: ["status"],
      where: base,
      _sum: { totalCents: true, openCents: true },
      _count: { _all: true },
    }),
    db.saleInstallment.aggregate({
      where: { paidAt: null, dueDate: { lt: now }, sale: base },
      _sum: { amountCents: true },
    }),
    db.sale.count({
      where: { AND: [base, { installments: { some: { paidAt: null, dueDate: { lt: now } } } }] },
    }),
  ]);

  const byStatus = new Map(groups.map((g) => [g.status, g]));
  const pending = byStatus.get("PENDING");
  const paid = byStatus.get("PAID");
  const pendingTotal = pending?._sum.totalCents ?? 0;
  const pendingOpen = pending?._sum.openCents ?? 0;

  return {
    pendingCents: pendingOpen,
    pendingCount: pending?._count._all ?? 0,
    paidCents: (paid?._sum.totalCents ?? 0) + (pendingTotal - pendingOpen),
    paidCount: paid?._count._all ?? 0,
    overdueCents: overdue._sum.amountCents ?? 0,
    overdueCount,
  };
}

export async function getSalesSummary(filters: Omit<SalesFilters, "status" | "overdueOnly"> = {}) {
  const db = await getWorkspaceDb();
  return computeSalesSummary(db, buildSalesWhere({ ...filters, status: undefined, overdueOnly: undefined }));
}
```

Em `getSales`, dentro do `include`, acrescentar:

```ts
        _count: { select: { installments: { where: { paidAt: null } } } },
```

Em `getSaleById`, dentro do `include`, acrescentar:

```ts
      installments: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, amountCents: true, dueDate: true, forecastPreset: true, paidAt: true },
      },
```

Em `getSalesForExport`: `SaleExportRow` ganha `installments: string; openCents: number;`; o `findMany` inclui `_count: { select: { installments: { where: { paidAt: null } } } }`; o map acrescenta:

```ts
    installments:
      sale.installmentCount > 1
        ? `${sale.installmentCount - sale._count.installments}/${sale.installmentCount} pagas`
        : "",
    openCents: sale.openCents,
```

Em `src/app/(app)/sales/export/route.ts`, acrescentar às colunas, depois de `totalCents`:

```ts
      { key: "installments", label: "Parcelas" },
      { key: "openCents", label: "Em aberto (centavos)" },
```

- [ ] **Step 4: Implement clientes**

Em `src/lib/customer-balance.ts`, acrescentar:

```ts
export function aggregateOpenInstallments(
  rows: { saleId: string; customerId: string | null; amountCents: number; dueDate: Date | null }[],
): CustomerPendingRow[] {
  const byCustomer = new Map<string, { pendingCents: number; sales: Set<string>; oldest: Date | null }>();
  for (const row of rows) {
    if (!row.customerId) continue;
    const entry = byCustomer.get(row.customerId) ?? { pendingCents: 0, sales: new Set<string>(), oldest: null };
    entry.pendingCents += row.amountCents;
    entry.sales.add(row.saleId);
    if (row.dueDate && (!entry.oldest || row.dueDate < entry.oldest)) entry.oldest = row.dueDate;
    byCustomer.set(row.customerId, entry);
  }
  return [...byCustomer].map(([customerId, e]) => ({
    customerId,
    pendingCents: e.pendingCents,
    pendingCount: e.sales.size,
    oldestForecastDate: e.oldest,
  }));
}
```

Em `src/server/queries/customers.ts`:
- Importar `aggregateOpenInstallments` e `dueByWhere` (de `@/server/sales/installments`).
- Trocar `pendingForecastWhere` por:

```ts
function openInstallmentsWhere(forecastTo?: string) {
  const cutoff = parseForecastCutoff(forecastTo);
  return { paidAt: null, ...(cutoff ? dueByWhere(cutoff) : {}) };
}
```

- Em `getCustomersWithBalance`, substituir o `groupBy` e o `pendingRows` por:

```ts
  const open = await db.saleInstallment.findMany({
    where: {
      ...openInstallmentsWhere(filters.forecastTo),
      sale: { customerId: { in: customers.map((c) => c.id) } },
    },
    select: { saleId: true, amountCents: true, dueDate: true, sale: { select: { customerId: true } } },
  });

  const pendingRows = aggregateOpenInstallments(
    open.map((row) => ({
      saleId: row.saleId,
      customerId: row.sale.customerId,
      amountCents: row.amountCents,
      dueDate: row.dueDate,
    })),
  );
```

- Substituir `getPendingSalesByCustomer` por:

```ts
export async function getOpenInstallmentsByCustomer(customerId: string, forecastTo?: string) {
  const db = await getWorkspaceDb();
  return db.saleInstallment.findMany({
    where: { ...openInstallmentsWhere(forecastTo), sale: { customerId } },
    orderBy: [{ sale: { soldAt: "asc" } }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      amountCents: true,
      dueDate: true,
      sale: { select: { id: true, soldAt: true, installmentCount: true, notes: true } },
    },
  });
}
```

Observação: `customer-collect-dialog.tsx` importa `getPendingSalesByCustomer` diretamente de uma query (função server chamada do client). Mantenha `getOpenInstallmentsByCustomer` no mesmo arquivo e com a mesma forma de export, para a Task 9 trocar o import.

- Em `getCustomerReport`: `CustomerReportSale` ganha `installmentCount: number; openInstallments: { number: number; amountCents: number; dueDate: Date | null }[]`; o `select` inclui `installmentCount: true, openCents: true, installments: { where: { paidAt: null }, orderBy: { number: "asc" }, select: { number: true, amountCents: true, dueDate: true } }`; o retorno vira:

```ts
  const totalCents = sales.reduce((sum, s) => sum + s.totalCents, 0);
  const pendingCents = sales.reduce((sum, s) => sum + s.openCents, 0);

  return {
    customer,
    sales: sales.map((s) => ({
      id: s.id,
      soldAt: s.soldAt,
      status: s.status,
      totalCents: s.totalCents,
      installmentCount: s.installmentCount,
      items: s.items,
      openInstallments: s.installments,
    })),
    totalCents,
    paidCents: totalCents - pendingCents,
    pendingCents,
  };
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/server/queries src/lib/customer-balance.test.ts`
Expected: PASS em `sales-summary`, `customers-balance`, `sales-export`, `customer-balance`. (`dashboard.test.ts` e `consolidated-dashboard.test.ts` ainda passam porque o painel não mudou.)

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/sales.ts src/server/queries/customers.ts src/lib/customer-balance.ts src/lib/customer-balance.test.ts src/server/queries/*.test.ts "src/app/(app)/sales/export/route.ts"
git commit -m "feat(vendas): saldos, cobrança e exportação calculados por parcela

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Painel por parcela

**Files:**
- Modify: `src/server/queries/dashboard.ts:97-118` (select), `:303-310` (KPIs), `:390-397` (série)
- Modify: `src/server/queries/consolidated-dashboard.ts`
- Test: `src/server/queries/dashboard.test.ts`, `src/server/queries/consolidated-dashboard.test.ts`

**Interfaces:**
- Consumes: `seedParceledSale`, `backfillSaleInstallments` (Task 2).
- Produces: mesmo shape de retorno de `getDashboardData` e `getConsolidatedSummary`.

- [ ] **Step 1: Write failing tests**

Em `dashboard.test.ts`: importar `backfillSaleInstallments` e chamar depois das criações de venda em cada teste existente. Acrescentar:

```ts
  it("venda parcelada entra no realizado pela parcela paga e no previsto mês a mês", async () => {
    await seedParceledSale({
      workspaceId: context.workspaceId,
      soldAt: new Date(2027, 0, 10, 12),
      parcels: [
        { amountCents: 10000, dueDate: new Date(2027, 1, 5, 12), paidAt: new Date(2027, 1, 5, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 2, 5, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 3, 5, 12) },
      ],
    });

    const result = await getDashboardData({
      from: new Date(2027, 0, 1),
      to: new Date(2027, 5, 30),
      status: "ALL",
    });

    expect(result.kpis.paidRevenueCents).toBe(10000);
    expect(result.kpis.forecastRevenueCents).toBe(20000);
    expect(result.trend.map((b) => [b.realized, b.forecast])).toEqual([
      [0, 0],
      [10000, 0],
      [0, 10000],
      [0, 10000],
      [0, 0],
      [0, 0],
    ]);
  });
```

(importar `seedParceledSale` de `@/test/sales`.)

Em `consolidated-dashboard.test.ts`: chamar `await backfillSaleInstallments()` depois das criações e acrescentar:

```ts
  it("conta no faturamento pago só as parcelas já recebidas", async () => {
    const ws = await createWorkspace("Loja C");
    await seedParceledSale({
      workspaceId: ws.id,
      soldAt: new Date("2026-09-05T12:00:00Z"),
      parcels: [
        { amountCents: 2000, dueDate: new Date("2026-09-05T12:00:00Z"), paidAt: new Date("2026-09-05T12:00:00Z") },
        { amountCents: 2000, dueDate: new Date("2026-10-05T12:00:00Z") },
      ],
    });

    const [summary] = await getConsolidatedSummary([{ id: ws.id, name: "Loja C" }], {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-30T23:59:59.999Z"),
    });

    expect(summary).toMatchObject({ paidRevenueCents: 2000, salesCount: 1, avgTicketCents: 2000 });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/server/queries/dashboard.test.ts src/server/queries/consolidated-dashboard.test.ts`
Expected: os testes novos FALHAM (paid 0 / forecast 30000; consolidado 0); os existentes passam.

- [ ] **Step 3: Implement dashboard**

No `select` de `db.sale.findMany` em `getDashboardData`, acrescentar:

```ts
      installments: { select: { amountCents: true, paidAt: true, dueDate: true } },
```

No laço de KPIs, substituir o bloco `if (sale.status === "PAID") { ... } else { forecastRevenue += saleRevenue; }` por:

```ts
    const salePaidCents = sale.installments.reduce((s, i) => s + (i.paidAt ? i.amountCents : 0), 0);
    const paidShare = sale.totalCents > 0 ? salePaidCents / sale.totalCents : sale.status === "PAID" ? 1 : 0;
    const salePaidRevenue = Math.round(saleRevenue * paidShare);
    paidRevenue += salePaidRevenue;
    forecastRevenue += saleRevenue - salePaidRevenue;
    paidProductionCost += saleProductionCost * paidShare;
    paidProductionUnits += saleProductionQty * paidShare;
    paidResaleCost += saleResaleCost * paidShare;
    paidUncostedUnits += saleUncosted * paidShare;
```

Na série temporal, substituir o bloco `if (sale.status === "PAID") { ... } else { ... }` por:

```ts
    const scale = sale.totalCents > 0 ? rev / sale.totalCents : 0;
    for (const inst of sale.installments) {
      const amount = Math.round(inst.amountCents * scale);
      if (inst.paidAt) {
        const e = series.get(bucketKey(inst.paidAt));
        if (e) e.realized += amount;
      } else {
        const fd = inst.dueDate ?? sale.soldAt;
        const e = series.get(bucketKey(fd >= from && fd <= to ? fd : sale.soldAt));
        if (e) e.forecast += amount;
      }
    }
```

- [ ] **Step 4: Implement consolidado**

Em `consolidated-dashboard.ts`, trocar a consulta e as contas:

```ts
  const sales = await db.sale.findMany({
    where: { soldAt: { gte: filters.from, lte: filters.to } },
    select: { totalCents: true, openCents: true },
  });

  const paid = sales.map((s) => s.totalCents - s.openCents).filter((cents) => cents > 0);
  const paidRevenueCents = paid.reduce((sum, cents) => sum + cents, 0);
  const salesCount = paid.length;
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/server/queries`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/dashboard.ts src/server/queries/consolidated-dashboard.ts src/server/queries/dashboard.test.ts src/server/queries/consolidated-dashboard.test.ts
git commit -m "feat(painel): receita realizada e prevista por parcela

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: API v1 com parcelas

**Files:**
- Modify: `src/app/api/v1/sales/route.ts`
- Modify: `src/app/api/v1/sales/mark-paid/route.ts`
- Test: `src/app/api/v1/sales/route.test.ts`, `src/app/api/v1/sales/mark-paid/route.test.ts`

**Interfaces:**
- Consumes: `parsePaymentChoice`, `planPayment` (Task 1); `writeInstallments`, `syncSaleSummary`, `dueByWhere` (Task 2); `computeSalesSummary` (Task 5).
- Produces (contrato HTTP usado pelo MCP na Task 10):
  - `POST /api/v1/sales` body aceita `installments?: number` (1–24, padrão 1), `status?: "PAID" | "PENDING"`, `forecastPreset?: "DAY_FIVE" | "FIFTH_BUSINESS_DAY" | "CUSTOM"`, `forecastDate?: "YYYY-MM-DD"` (1ª parcela quando `installments >= 2`). Resposta `201 { sale: { id, totalCents, installments: { id, number, amountCents, dueDate, paidAt }[] } }`.
  - `GET /api/v1/sales`: cada venda inclui `installmentCount`, `openCents` (já são escalares) e `installments`.
  - `POST /api/v1/sales/mark-paid` body aceita `installmentIds?: string[]` além de `saleId`, `saleIds`, `customerId`. Com `saleId/saleIds/customerId` quita só parcelas com `dueDate <= fim de hoje` ou sem vencimento. Resposta `{ count, totalCents }` onde `count` = parcelas quitadas.

- [ ] **Step 1: Write failing tests**

Em `route.test.ts`: chamar `await backfillSaleInstallments()` depois das criações com `testDb.sale.create`. Acrescentar ao `describe("POST ...")`:

```ts
  it("cria venda parcelada em 3x com vencimentos mensais", async () => {
    const { ws } = await seedMember();
    const item = await testDb.item.create({
      data: { name: "Bolo", unit: "UN", sellable: true, productionInput: false, workspaceId: ws.id },
    });

    const res = await POST(
      postReq({
        installments: 3,
        forecastPreset: "CUSTOM",
        forecastDate: "2026-10-20",
        items: [{ itemId: item.id, productName: "Bolo", variantId: null, quantity: 1, unitPriceCents: 10000 }],
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sale.installments.map((i: { amountCents: number; dueDate: string }) => [i.amountCents, i.dueDate.slice(0, 10)])).toEqual([
      [3333, expect.stringMatching(/^2026-10-2/)],
      [3333, expect.stringMatching(/^2026-11-2/)],
      [3334, expect.stringMatching(/^2026-12-2/)],
    ]);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: body.sale.id } });
    expect([sale.status, sale.openCents, sale.installmentCount]).toEqual(["PENDING", 10000, 3]);
  });

  it("recusa parcelamento acima de 24", async () => {
    const { ws } = await seedMember();
    const item = await testDb.item.create({
      data: { name: "Bolo", unit: "UN", sellable: true, productionInput: false, workspaceId: ws.id },
    });
    const res = await POST(
      postReq({ installments: 30, items: [{ itemId: item.id, productName: "Bolo", variantId: null, quantity: 1, unitPriceCents: 100 }] }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "O parcelamento deve ter de 2 a 24 parcelas." });
  });
```

Em `mark-paid/route.test.ts`: chamar `await backfillSaleInstallments()` depois das criações existentes. Acrescentar:

```ts
  it("por cliente quita só parcelas vencidas e deixa as futuras em aberto", async () => {
    const user = await testDb.user.create({ data: { id: "u3", name: "Ana", email: "ana3@example.com" } });
    const owner = await testDb.user.create({ data: { id: "u3o", name: "Bruno", email: "bruno3@example.com" } });
    const ws = await createWorkspace("Loja 3");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({ data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" } });
    const customer = await testDb.customer.create({ data: { name: "Maria", workspaceId: ws.id } });
    const sale = await seedParceledSale({
      workspaceId: ws.id,
      customerId: customer.id,
      parcels: [
        { amountCents: 1000, dueDate: new Date(Date.now() - 5 * 86400000) },
        { amountCents: 1000, dueDate: new Date(Date.now() + 25 * 86400000) },
      ],
    });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ customerId: customer.id }));

    expect(await res.json()).toEqual({ count: 1, totalCents: 1000 });
    const saved = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect([saved.status, saved.openCents]).toEqual(["PENDING", 1000]);
  });

  it("quita parcela futura quando informada por installmentIds", async () => {
    const user = await testDb.user.create({ data: { id: "u4", name: "Ana", email: "ana4@example.com" } });
    const owner = await testDb.user.create({ data: { id: "u4o", name: "Bruno", email: "bruno4@example.com" } });
    const ws = await createWorkspace("Loja 4");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({ data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" } });
    const sale = await seedParceledSale({
      workspaceId: ws.id,
      parcels: [{ amountCents: 1500, dueDate: new Date(Date.now() + 25 * 86400000) }],
    });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ installmentIds: [sale.installments[0].id] }));

    expect(await res.json()).toEqual({ count: 1, totalCents: 1500 });
  });
```

(importar `seedParceledSale` de `@/test/sales` e `backfillSaleInstallments` de `@/test/db`.) Ajustar a mensagem esperada do teste de 404 para `"Nenhuma parcela em aberto encontrada."` e a do 400 para `"Informe installmentIds, saleId, saleIds ou customerId."`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/app/api/v1/sales`
Expected: FAIL nos testes novos e nas mensagens alteradas.

- [ ] **Step 3: Implement `POST /api/v1/sales`**

Imports:

```ts
import { parsePaymentChoice, planPayment } from "@/lib/installments";
import { writeInstallments } from "@/server/sales/installments";
import { buildSalesWhere, computeSalesSummary, type SalesFilters } from "@/server/queries/sales";
```

Remover a leitura de `status`, `forecastPreset` e `paymentForecastDate` e, no lugar dela, acrescentar:

```ts
    let forecastDate: Date | null = null;
    if (typeof body.forecastDate === "string" && body.forecastDate.trim()) {
      const parsed = parseDateOnly(body.forecastDate.trim());
      if (!isValidDate(parsed)) return Response.json({ error: "Data inválida." }, { status: 400 });
      forecastDate = parsed;
    }
    const count = body.installments === undefined ? 1 : Number(body.installments);
    const choice = parsePaymentChoice({
      mode: count > 1 || count < 1 || !Number.isInteger(count) ? "INSTALLMENTS" : "CASH",
      status: count > 1 ? "PENDING" : body.status === "PENDING" ? "PENDING" : "PAID",
      count,
      preset: typeof body.forecastPreset === "string" ? body.forecastPreset : "",
      dueDate: forecastDate,
    });
    if ("error" in choice) return Response.json({ error: choice.error }, { status: 400 });
```

Depois do cálculo de `totalCents`:

```ts
    const plan = planPayment(choice, totalCents, [], new Date());
    if (!plan.ok) return Response.json({ error: plan.error }, { status: 400 });

    const sale = await context.db.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          userId: context.userId,
          customerId,
          customerName,
          soldAt,
          notes,
          discountType,
          discountValue,
          totalCents,
          workspaceId: context.workspaceId,
          items: {
            create: items.map((item) => ({
              itemId: item.itemId,
              productNameSnapshot: item.productName,
              variantId: item.variantId,
              variantNameSnapshot: item.variantName ?? item.flavorName ?? null,
              quantity: item.quantity,
              unitPriceSnapshot: item.unitPriceCents,
              workspaceId: context.workspaceId,
            })),
          },
        },
      });
      for (const item of items) {
        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            variantId: item.variantId,
            type: StockMovementType.SALE,
            quantity: -item.quantity,
            saleId: created.id,
            workspaceId: context.workspaceId,
          },
        });
      }
      await writeInstallments(tx, created.id, context.workspaceId, plan.installments);
      return tx.saleInstallment.findMany({
        where: { saleId: created.id },
        orderBy: { number: "asc" },
        select: { id: true, number: true, amountCents: true, dueDate: true, paidAt: true },
      }).then((installments) => ({ id: created.id, installments }));
    });

    return Response.json({ sale: { id: sale.id, totalCents, installments: sale.installments } }, { status: 201 });
```

`mode` com contagem inválida (0, negativa, 30, decimal) é tratado como `INSTALLMENTS` de propósito, para cair na validação de 2–24 e responder 400 em vez de virar à vista silenciosamente.

- [ ] **Step 4: Implement `GET /api/v1/sales`**

Trocar o `groupBy` + `aggregate` pelo resumo compartilhado e incluir parcelas:

```ts
    const [sales, summary] = await Promise.all([
      db.sale.findMany({
        where,
        orderBy: { soldAt: "desc" },
        take: 50,
        include: {
          items: {
            select: { quantity: true, unitPriceSnapshot: true, productNameSnapshot: true, variantNameSnapshot: true },
          },
          installments: {
            orderBy: { number: "asc" },
            select: { id: true, number: true, amountCents: true, dueDate: true, paidAt: true },
          },
        },
      }),
      computeSalesSummary(db, summaryWhere),
    ]);

    return Response.json({
      sales: sales.map((sale) => ({
        ...sale,
        items: sale.items.map((item) => ({ ...item, flavorNameSnapshot: item.variantNameSnapshot })),
      })),
      summary,
    });
```

- [ ] **Step 5: Implement `mark-paid`**

Substituir o corpo por:

```ts
import { NextRequest } from "next/server";
import { endOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";
import { dueByWhere, syncSaleSummary } from "@/server/sales/installments";

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((id: unknown): id is string => typeof id === "string") : null;
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const installmentIds = stringList(body.installmentIds);
    const saleId = typeof body.saleId === "string" ? body.saleId : null;
    const saleIds = stringList(body.saleIds);
    const customerId = typeof body.customerId === "string" ? body.customerId : null;

    if (!installmentIds && !saleId && !saleIds && !customerId) {
      return Response.json({ error: "Informe installmentIds, saleId, saleIds ou customerId." }, { status: 400 });
    }

    const where: Prisma.SaleInstallmentWhereInput = installmentIds
      ? { id: { in: installmentIds }, paidAt: null }
      : {
          paidAt: null,
          ...dueByWhere(endOfDay(new Date())),
          sale: customerId ? { customerId } : { id: { in: saleId ? [saleId] : saleIds! } },
        };

    const open = await context.db.saleInstallment.findMany({
      where,
      select: { id: true, saleId: true, amountCents: true },
    });
    if (open.length === 0) {
      return Response.json({ error: "Nenhuma parcela em aberto encontrada." }, { status: 404 });
    }

    await context.db.$transaction(async (tx) => {
      await tx.saleInstallment.updateMany({
        where: { id: { in: open.map((i) => i.id) }, paidAt: null },
        data: { paidAt: new Date() },
      });
      await syncSaleSummary(tx, [...new Set(open.map((i) => i.saleId))]);
    });

    return Response.json({ count: open.length, totalCents: open.reduce((sum, i) => sum + i.amountCents, 0) });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run src/app/api/v1/sales`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/v1/sales
git commit -m "feat(api): vendas parceladas e quitação por parcela na API v1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Formulário de venda, lista e parcelas na edição

**Files:**
- Modify: `src/components/sales/sale-form.tsx` (estado e seção "Pagamento", `Props.initial`, `handleSubmit`)
- Modify: `src/app/(app)/sales/[id]/edit/page.tsx`
- Create: `src/components/sales/sale-installments.tsx`
- Modify: `src/components/sales/mark-as-paid-button.tsx`
- Modify: `src/app/(app)/sales/page.tsx` (`SaleCard`, `StatusBadge`)

**Interfaces:**
- Consumes: `buildSchedule`, `splitAmount`, `MIN_INSTALLMENTS`, `MAX_INSTALLMENTS` (Task 1); `payInstallments`, `unpayInstallments`, `payNextInstallment` (Task 4); `getSaleById` com `installments`, `getSales` com `_count.installments` (Task 5); campos do formulário da Task 3.
- Produces: `SaleInstallments({ installments }: { installments: { id: string; number: number; amountCents: number; dueDate: Date | null; paidAt: Date | null }[] })`.

Sem testes automatizados de componente no projeto; a verificação é feita no navegador (Step 6).

- [ ] **Step 1: `sale-form.tsx` — estado e envio**

Imports adicionais:

```ts
import { buildSchedule, splitAmount, MIN_INSTALLMENTS, MAX_INSTALLMENTS } from "@/lib/installments";
```

Em `Props.initial`, acrescentar `installmentCount: number;` e `firstDueDate: string | null;`.

Abaixo de `const [customDate, setCustomDate] = ...`, acrescentar:

```ts
  const [paymentMode, setPaymentMode] = useState<"CASH" | "INSTALLMENTS">(
    (initial?.installmentCount ?? 1) > 1 ? "INSTALLMENTS" : "CASH",
  );
  const [installmentCount, setInstallmentCount] = useState<number>(Math.max(initial?.installmentCount ?? 3, MIN_INSTALLMENTS));
```

Quando a venda é parcelada, o `customDate` inicial deve ser a 1ª parcela: trocar o `useState` de `customDate` por:

```ts
  const [customDate, setCustomDate] = useState(
    ((initial?.installmentCount ?? 1) > 1 ? initial?.firstDueDate : initial?.forecastDate) ?? "",
  );
```

E o `initialPayStatus` para tratar parcelada:

```ts
  const initialPayStatus: PayStatus =
    (initial?.installmentCount ?? 1) > 1 || initial?.status === "PENDING"
      ? ((initial?.forecastPreset as ForecastPreset) ?? "DAY_FIVE")
      : "PAID";
```

Incluir `paymentMode` e `installmentCount` no objeto de `currentSnapshot`.

Na edição de venda parcelada, a 1ª data não pode ser recalculada a partir de hoje (com "Dia 5" ou "5º dia útil", `resolveForecast` daria o próximo vencimento a partir da data atual e deslocaria todas as parcelas em aberto). Trocar o cálculo de `forecastDate` por:

```ts
  const keepFirstDue =
    paymentMode === "INSTALLMENTS" &&
    (initial?.installmentCount ?? 1) > 1 &&
    payStatus === initialPayStatus &&
    payStatus !== "CUSTOM" &&
    initial?.firstDueDate;

  const forecastDate: Date | null =
    payStatus === "PAID"
      ? null
      : keepFirstDue
        ? new Date(`${initial!.firstDueDate}T12:00:00`)
        : payStatus === "CUSTOM" && customDate
          ? new Date(`${customDate}T12:00:00`)
          : resolveForecast(payStatus as ForecastPreset, undefined);
```

Ao trocar para parcelado com `payStatus === "PAID"`, cair em `"DAY_FIVE"`:

```ts
  function choosePaymentMode(mode: "CASH" | "INSTALLMENTS") {
    setPaymentMode(mode);
    if (mode === "INSTALLMENTS" && payStatus === "PAID") setPayStatus("DAY_FIVE");
  }
```

Prévia (depois do cálculo de `forecastDate`):

```ts
  const installmentPreview =
    paymentMode === "INSTALLMENTS" && forecastDate
      ? (() => {
          const amounts = splitAmount(totalCents, installmentCount);
          return buildSchedule(forecastDate, payStatus as ForecastPreset, installmentCount).map((date, idx) => ({
            date,
            amountCents: amounts[idx],
          }));
        })()
      : [];
```

Em `handleSubmit`, antes de montar o `FormData`:

```ts
    if (paymentMode === "INSTALLMENTS" && !forecastDate) {
      toast.error("Escolha a data da 1ª parcela.");
      return;
    }
```

e acrescentar ao `fd`:

```ts
    fd.set("paymentMode", paymentMode);
    fd.set("installmentCount", String(paymentMode === "INSTALLMENTS" ? installmentCount : 1));
```

- [ ] **Step 2: `sale-form.tsx` — seção Pagamento**

Substituir o conteúdo da `<section>` de Pagamento por:

```tsx
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Pagamento
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {(["CASH", "INSTALLMENTS"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={paymentMode === mode ? "default" : "outline"}
              onClick={() => choosePaymentMode(mode)}
            >
              {mode === "CASH" ? "À vista" : "Parcelado"}
            </Button>
          ))}
        </div>

        {paymentMode === "INSTALLMENTS" && (
          <div className="space-y-2">
            <Label htmlFor="installment-count">Número de parcelas</Label>
            <Input
              id="installment-count"
              type="number"
              inputMode="numeric"
              min={MIN_INSTALLMENTS}
              max={MAX_INSTALLMENTS}
              value={installmentCount}
              onChange={(e) =>
                setInstallmentCount(
                  Math.min(MAX_INSTALLMENTS, Math.max(MIN_INSTALLMENTS, parseInt(e.target.value, 10) || MIN_INSTALLMENTS)),
                )
              }
            />
          </div>
        )}

        {paymentMode === "INSTALLMENTS" && (
          <Label className="text-muted-foreground">Vencimento da 1ª parcela</Label>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {payOptions
            .filter(({ key }) => paymentMode === "CASH" || key !== "PAID")
            .map(({ key, label }) => (
              <Button
                key={key}
                type="button"
                variant={payStatus === key ? "default" : "outline"}
                onClick={() => setPayStatus(key)}
                className="justify-center"
              >
                {label}
              </Button>
            ))}
        </div>

        {payStatus === "CUSTOM" && (
          <Input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            min={format(new Date(), "yyyy-MM-dd")}
          />
        )}

        {paymentMode === "CASH" && payStatus !== "PAID" && forecastDate && (
          <p className="text-sm text-muted-foreground">
            Previsão de recebimento:{" "}
            <span className="font-medium text-foreground">
              {format(forecastDate, "PPP", { locale: ptBR })}
            </span>
          </p>
        )}

        {installmentPreview.length > 0 && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">
              {installmentCount}x de {formatBRL(installmentPreview[0].amountCents)}
              {installmentPreview[installmentPreview.length - 1].amountCents !== installmentPreview[0].amountCents &&
                ` (última ${formatBRL(installmentPreview[installmentPreview.length - 1].amountCents)})`}
            </p>
            <p className="mt-1 text-muted-foreground">
              {installmentPreview.map((p) => format(p.date, "dd/MM/yy")).join(" · ")}
            </p>
          </div>
        )}
      </section>
```

- [ ] **Step 3: Página de edição e lista de parcelas**

`src/components/sales/sale-installments.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { payInstallments, unpayInstallments } from "@/server/actions/sales";
import { formatBRL } from "@/lib/money";

type Installment = { id: string; number: number; amountCents: number; dueDate: Date | null; paidAt: Date | null };

export function SaleInstallments({ installments }: { installments: Installment[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const total = installments.length;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao atualizar.");
      }
    });
  }

  return (
    <section className="mb-8 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Parcelas</h2>
      <ul className="divide-y rounded-lg border">
        {installments.map((inst) => {
          const overdue = !inst.paidAt && inst.dueDate !== null && inst.dueDate < new Date();
          return (
            <li key={inst.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium tabular-nums">
                  {inst.number}/{total} · {formatBRL(inst.amountCents)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {inst.paidAt
                    ? `Paga em ${format(inst.paidAt, "dd/MM/yyyy", { locale: ptBR })}`
                    : inst.dueDate
                      ? `Vence em ${format(inst.dueDate, "dd/MM/yyyy", { locale: ptBR })}`
                      : "Sem vencimento"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {overdue && <Badge variant="destructive">Atrasada</Badge>}
                {inst.paidAt ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => unpayInstallments([inst.id]), `Parcela ${inst.number} voltou para em aberto.`)}
                  >
                    Desfazer
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => payInstallments([inst.id]), `Parcela ${inst.number} recebida.`)}
                  >
                    Receber
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

Em `src/app/(app)/sales/[id]/edit/page.tsx`, acrescentar ao `initial`:

```ts
    installmentCount: sale.installmentCount,
    firstDueDate: sale.installments[0]?.dueDate ? format(sale.installments[0].dueDate, "yyyy-MM-dd") : null,
```

e trocar `forecastPreset: sale.forecastPreset ?? null` por `forecastPreset: (sale.installmentCount > 1 ? sale.installments[0]?.forecastPreset : sale.forecastPreset) ?? null`. Renderizar, antes do `<SaleForm>`:

```tsx
      {sale.installmentCount > 1 && <SaleInstallments installments={sale.installments} />}
```

(import `SaleInstallments` de `@/components/sales/sale-installments`.)

- [ ] **Step 4: Lista de vendas**

`src/components/sales/mark-as-paid-button.tsx`, substituir o componente por:

```tsx
export function MarkAsPaidButton({ id, parceled }: { id: string; parceled: boolean }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await payNextInstallment(id);
      if (!res.ok || !res.data) {
        toast.error(res.error ?? "Erro ao atualizar.");
        return;
      }
      const { installmentId, number, installmentCount } = res.data;
      toast.success(
        installmentCount > 1 ? `Parcela ${number}/${installmentCount} recebida.` : "Venda marcada como paga.",
        {
          action: {
            label: "Desfazer",
            onClick: () => {
              void unpayInstallments([installmentId]).then((r) => {
                if (r.ok) toast.success(installmentCount > 1 ? "Parcela voltou para em aberto." : "Venda voltou para pendente.");
                else toast.error(r.error ?? "Erro ao desfazer.");
              });
            },
          },
        },
      );
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-success border-success/40 hover:bg-success/10 hover:text-success"
      onClick={handleClick}
      disabled={pending}
    >
      <CheckCircle className="size-3.5" />
      {pending ? "Salvando..." : parceled ? "Receber parcela" : "Marcar como pago"}
    </Button>
  );
}
```

com o import trocado para `import { payNextInstallment, unpayInstallments } from "@/server/actions/sales";`.

Em `src/app/(app)/sales/page.tsx`, no `SaleCard`:
- `const parceled = sale.installmentCount > 1;` e `const openCount = sale._count.installments;`
- Trocar a linha `{isPending && sale.paymentForecastDate && ` · Prev. ...`}` por:

```tsx
            {isPending && sale.paymentForecastDate &&
              ` · ${parceled ? "Próx. parcela" : "Prev."} ${format(sale.paymentForecastDate, "dd/MM/yyyy")}`}
```

- Abaixo do total (`<p className="font-semibold tabular-nums">{formatBRL(sale.totalCents)}</p>`), acrescentar:

```tsx
          {parceled && isPending && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Em aberto: {formatBRL(sale.openCents)}
            </p>
          )}
```

- Trocar `<MarkAsPaidButton id={sale.id} />` por `<MarkAsPaidButton id={sale.id} parceled={parceled} />`.
- Em `StatusBadge`, antes do retorno "Pendente":

```tsx
  if (sale.installmentCount > 1) {
    return (
      <Badge className="text-xs bg-warning/15 text-warning-text border-warning/30 shrink-0">
        {sale.installmentCount - sale._count.installments}/{sale.installmentCount} pagas
      </Badge>
    );
  }
```

- [ ] **Step 5: Typecheck e lint**

Run: `pnpm exec tsc --noEmit`
Expected: só restam erros em `customer-collect-dialog.tsx` e `collect-customer-button.tsx` (resolvidos na Task 9).

- [ ] **Step 6: Verificação no navegador**

Iniciar o preview (`preview_start` com a config de dev do projeto; se não houver `.claude/launch.json`, criar com `pnpm dev` na porta 3000). Em `/sales/new`:
1. Adicionar um produto de R$ 100,00, escolher "Parcelado", 3 parcelas, "Dia 5". Conferir a prévia "3x de R$ 33,33 (última R$ 33,34)" com datas em três meses seguidos.
2. Registrar. Na lista, conferir o selo "0/3 pagas", "Em aberto: R$ 100,00" e o botão "Receber parcela". Clicar: toast "Parcela 1/3 recebida.", selo "1/3 pagas", "Em aberto: R$ 66,67". Clicar em "Desfazer" no toast e conferir a volta.
3. Abrir a edição: a lista "Parcelas" aparece com Receber/Desfazer; o formulário vem com "Parcelado", 3 e a mesma 1ª data.
4. `read_console_messages` sem erros. Screenshot da lista e da edição em largura de celular (`resize_window` preset `mobile`) e voltar com `desktop`.

- [ ] **Step 7: Commit**

```bash
git add src/components/sales "src/app/(app)/sales"
git commit -m "feat(vendas): escolher à vista ou parcelado e receber parcela a parcela

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Cobrança do cliente por parcela e PDF

**Files:**
- Modify: `src/components/customers/customer-collect-dialog.tsx`
- Delete: `src/components/sales/collect-customer-button.tsx`
- Modify: `src/app/(app)/sales/page.tsx` (bloco "Receber tudo")
- Modify: `src/server/pdf/customer-report.ts`

**Interfaces:**
- Consumes: `getOpenInstallmentsByCustomer` (Task 5), `payInstallments` (Task 4), `CustomerReportSale.openInstallments` / `installmentCount` (Task 5).
- Produces: `CustomerCollectDialog` ganha a prop opcional `triggerSize?: "sm" | "lg"` e `triggerLabel?: React.ReactNode`.

- [ ] **Step 1: Diálogo**

Em `customer-collect-dialog.tsx`:
- Trocar imports: `getOpenInstallmentsByCustomer` no lugar de `getPendingSalesByCustomer`; `payInstallments` no lugar de `markSalesAsPaid`; acrescentar `import { endOfDay } from "date-fns";` (junto do `format`) e `import type { ReactNode } from "react";`.
- `type PendingSale` vira `type OpenInstallment = Awaited<ReturnType<typeof getOpenInstallmentsByCustomer>>[number];` e o estado `sales` vira `installments`.
- Props: acrescentar `triggerSize = "sm"` e `triggerLabel`; o botão gatilho vira:

```tsx
      <Button size={triggerSize} className={triggerClassName} onClick={() => setOpen(true)}>
        <HandCoins />
        {triggerLabel ?? "Receber"}
      </Button>
```

- Seleção inicial só das vencidas até hoje ou sem vencimento:

```ts
    getOpenInstallmentsByCustomer(customerId, forecastTo).then((rows) => {
      if (!active) return;
      const today = endOfDay(new Date());
      setInstallments(rows);
      setSelected(new Set(rows.filter((r) => !r.dueDate || r.dueDate <= today).map((r) => r.id)));
    });
```

- `selectedCents` soma `amountCents`. `handleConfirm` chama `payInstallments([...selected])` e o toast vira:

```ts
        toast.success(
          `${res.data.count} ${res.data.count === 1 ? "parcela recebida" : "parcelas recebidas"} — ${formatBRL(res.data.totalCents)}.`,
        );
```

- Descrição: trocar `"venda pendente" / "vendas pendentes"` por `"venda em aberto" / "vendas em aberto"`; contador `"{selected.size} de {installments.length} selecionada(s)"` continua.
- Cada linha:

```tsx
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {formatBRL(inst.amountCents)}
                          {inst.sale.installmentCount > 1 && (
                            <span className="font-normal text-muted-foreground">
                              {" "}· parcela {inst.number}/{inst.sale.installmentCount}
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Venda {format(inst.sale.soldAt, "dd/MM/yyyy", { locale: ptBR })}
                          {inst.dueDate && ` · vence ${format(inst.dueDate, "dd/MM", { locale: ptBR })}`}
                        </span>
                      </span>
```

com `overdue = inst.dueDate !== null && inst.dueDate < new Date()`.
- Texto do vazio: "Nenhuma parcela em aberto."

- [ ] **Step 2: "Receber tudo" na tela de vendas**

Em `src/app/(app)/sales/page.tsx`, trocar o import de `CollectCustomerButton` por `CustomerCollectDialog` (`@/components/customers/customer-collect-dialog`) e o bloco por:

```tsx
      {selectedCustomer && summary.pendingCents > 0 && (
        <div className="mb-4">
          <CustomerCollectDialog
            customerId={selectedCustomer.id}
            customerName={selectedCustomer.name}
            customerSector={selectedCustomer.sector}
            pendingCents={summary.pendingCents}
            pendingCount={summary.pendingCount}
            triggerSize="lg"
            triggerClassName="w-full"
            triggerLabel={`Receber de ${selectedCustomer.name} · ${formatBRL(summary.pendingCents)}`}
          />
        </div>
      )}
```

Apagar o arquivo:

```bash
git rm src/components/sales/collect-customer-button.tsx
```

- [ ] **Step 3: PDF**

Em `src/server/pdf/customer-report.ts`, trocar:

```ts
      const statusLine = sale.status === "PENDING";
      if (statusLine) itemLines.push("Em aberto");
```

por:

```ts
      const statusLines =
        sale.status !== "PENDING"
          ? []
          : sale.installmentCount > 1
            ? sale.openInstallments.map(
                (inst) =>
                  `Parcela ${inst.number}/${sale.installmentCount} em aberto · ${money(inst.amountCents)}${
                    inst.dueDate ? ` · vence ${format(inst.dueDate, "dd/MM/yyyy")}` : ""
                  }`,
              )
            : ["Em aberto"];
      const firstStatusIndex = itemLines.length;
      itemLines.push(...statusLines);
```

e no `forEach`, `const isStatus = index >= firstStatusIndex && statusLines.length > 0;`. Se `format` de date-fns não estiver importado no arquivo, importar (`import { format } from "date-fns";`) ou reutilizar o formatador de data já existente no arquivo (o que gera `saleDateLabels`).

- [ ] **Step 4: Typecheck, lint e testes**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

Run: `pnpm lint`
Expected: sem erros novos.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Verificação no navegador**

1. Em `/customers`, abrir "Receber" de um cliente com uma venda parcelada (3x, 1ª vencida) e uma à vista pendente: a lista mostra "parcela 1/3", "parcela 2/3", "parcela 3/3" e a venda à vista; só as vencidas vêm marcadas. Confirmar e conferir que o saldo do cliente cai só no valor recebido.
2. Em `/sales?customer=<id>`, o botão grande "Receber de …" abre o mesmo diálogo.
3. Gerar o PDF do cliente (botão de relatório existente na tela do cliente) e conferir as linhas "Parcela 2/3 em aberto · R$ … · vence …".
4. `read_console_messages` sem erros; screenshot do diálogo.

- [ ] **Step 6: Commit**

```bash
git add src/components/customers/customer-collect-dialog.tsx "src/app/(app)/sales/page.tsx" src/server/pdf/customer-report.ts
git commit -m "feat(clientes): cobrança e relatório por parcela

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Tools MCP (repositório coolkies-mcp)

**Files (em `/Users/ferrari/code/coolkies-mcp`):**
- Modify: `src/tools/sales.ts`
- Test: `src/tools/sales.test.ts`

**Interfaces:**
- Consumes: contrato HTTP da Task 7.
- Produces: `create_sale` com `installments?: number` e `forecastPreset?`; `mark_sales_as_paid` com `installmentIds?: string[]`.

Trabalhar num branch `feat/parcelamento` nesse repositório.

- [ ] **Step 1: Write failing tests**

Em `src/tools/sales.test.ts`, seguindo o padrão já usado no arquivo para mockar `fetch`/`callCoolkiesApi`, acrescentar:

```ts
  it("create_sale envia parcelamento e normaliza a data da 1ª parcela", async () => {
    await createSaleHandler("tok", {
      installments: 3,
      forecastPreset: "CUSTOM",
      forecastDate: "2026-10-20T00:00:00.000Z",
      items: [{ itemId: "i1", productName: "Bolo", quantity: 1, unitPriceCents: 10000 }],
    });
    expect(lastRequestBody()).toMatchObject({ installments: 3, forecastPreset: "CUSTOM", forecastDate: "2026-10-20" });
  });

  it("mark_sales_as_paid repassa installmentIds", async () => {
    await markSalesAsPaidHandler("tok", { installmentIds: ["p1", "p2"] });
    expect(lastRequestBody()).toEqual({ installmentIds: ["p1", "p2"] });
  });
```

(`lastRequestBody` = o helper/inspeção de mock já existente no arquivo; se não houver, ler `JSON.parse(fetchMock.mock.calls.at(-1)[1].body)`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/ferrari/code/coolkies-mcp && pnpm vitest run src/tools/sales.test.ts`
Expected: FAIL de tipo/asserção (`installments` e `installmentIds` não existem nos tipos).

- [ ] **Step 3: Implement**

Em `CreateSaleArgs`, acrescentar `installments?: number;` e `forecastPreset?: "DAY_FIVE" | "FIFTH_BUSINESS_DAY" | "CUSTOM";`. Em `MarkSalesAsPaidArgs`, acrescentar `installmentIds?: string[];`.

No `inputSchema` de `create_sale`, acrescentar:

```ts
        installments: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe("Número de parcelas mensais. 1 ou omitido = à vista; de 2 a 24 = parcelado"),
        forecastPreset: z
          .enum(["DAY_FIVE", "FIFTH_BUSINESS_DAY", "CUSTOM"])
          .optional()
          .describe("Regra de vencimento: dia 5, 5º dia útil ou data em forecastDate; repetida mês a mês no parcelado"),
```

e trocar a descrição de `forecastDate` para `"Previsão de pagamento (à vista PENDING) ou vencimento da 1ª parcela, no formato YYYY-MM-DD"`.

Em `mark_sales_as_paid`:

```ts
      description:
        "Registra pagamento de parcelas. Com installmentIds quita exatamente essas parcelas (inclusive futuras). Com saleId, saleIds ou customerId quita só as parcelas vencidas até hoje.",
      inputSchema: {
        installmentIds: z.array(z.string()).optional(),
        saleId: z.string().optional(),
        saleIds: z.array(z.string()).optional(),
        customerId: z.string().optional(),
      },
```

Na descrição de `list_sales`, acrescentar: `"Cada venda traz installments (parcelas com id, number, amountCents, dueDate, paidAt) e openCents (valor em aberto)."`

- [ ] **Step 4: Run tests**

Run: `cd /Users/ferrari/code/coolkies-mcp && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit (no repositório coolkies-mcp)**

```bash
cd /Users/ferrari/code/coolkies-mcp && git checkout -b feat/parcelamento && git add src/tools && git commit -m "feat(vendas): parcelamento em create_sale e quitação por parcela

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verificação final

- [ ] **Step 1:** `pnpm test` — PASS completo.
- [ ] **Step 2:** `pnpm exec tsc --noEmit` e `pnpm lint` — sem erros.
- [ ] **Step 3:** `grep -rn "markAsPaid\|markAsPending\|markSalesAsPaid\|markCustomerSalesAsPaid\|getPendingSalesByCustomer\|CollectCustomerButton" src` — nenhuma ocorrência.
- [ ] **Step 4:** No navegador, abrir `/dashboard` com período cobrindo os próximos 3 meses e conferir que uma venda parcelada nova aparece no previsto distribuída por mês, e a parcela recebida no realizado. Screenshot.
- [ ] **Step 5:** Lembrar no resumo para o usuário que a migration precisa ser aplicada no banco de produção antes do deploy (mesmo SQL de `prisma/migrations/20261009120000_sale_installments/migration.sql`), e que o deploy do coolkies-mcp deve vir depois do coolkies-system.
