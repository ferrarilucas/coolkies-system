import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";
import { fifthBusinessDayOfMonth } from "@/lib/business-days";
import { Prisma } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "" };
const hooks: { afterFirstRead?: () => Promise<void>; failUpdate?: Error } = {};

function withReadHook(client: ReturnType<typeof scopedDb>) {
  return client.$extends({
    query: {
      saleInstallment: {
        async findMany({ args, query }) {
          const rows = await query(args);
          const hook = hooks.afterFirstRead;
          hooks.afterFirstRead = undefined;
          if (hook) await hook();
          return rows;
        },
        async updateMany({ args, query }) {
          const failure = hooks.failUpdate;
          hooks.failUpdate = undefined;
          if (failure) throw failure;
          return query(args);
        },
      },
    },
  });
}

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({ ...context, role: "OWNER", db: withReadHook(scopedDb(context.workspaceId)) }),
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
  writeBlocked: async () => null,
}));

const { receivePayment, updateSale } = await import("./sales");
const { getSales } = await import("@/server/queries/sales");
const { applyPartial, isConcurrencyError } = await import("@/server/sales/partial-payment");

const RACE = "Algumas parcelas já foram recebidas. Revise o valor.";
const due = (m: number) => new Date(2026, m, 5, 12);
const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

async function parcelsOf(saleId: string) {
  return testDb.saleInstallment.findMany({ where: { saleId }, orderBy: { number: "asc" } });
}

async function expectBalanced(saleId: string) {
  const sale = await testDb.sale.findUniqueOrThrow({ where: { id: saleId } });
  const parcels = await parcelsOf(saleId);
  expect(parcels.reduce((sum, p) => sum + p.amountCents, 0)).toBe(sale.totalCents);
  expect(parcels.map((p) => p.number)).toEqual(parcels.map((_, idx) => idx + 1));
  return { sale, parcels };
}

async function snapshot() {
  const parcels = await testDb.saleInstallment.findMany({ orderBy: [{ saleId: "asc" }, { number: "asc" }] });
  const sales = await testDb.sale.findMany({ orderBy: { id: "asc" } });
  return {
    parcels: parcels.map((p) => [p.id, p.number, p.amountCents, p.paidAt?.getTime() ?? null, p.dueDate?.getTime() ?? null]),
    sales: sales.map((s) => [s.id, s.status, s.openCents, s.installmentCount, s.paymentForecastDate?.getTime() ?? null]),
    splits: await testDb.installmentSplit.count(),
  };
}

describe("receivePayment", () => {
  beforeEach(async () => {
    await resetDb();
    hooks.afterFirstRead = undefined;
    hooks.failUpdate = undefined;
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

  describe("expected da prévia", () => {
    async function paidOutside(id: string) {
      await testDb.saleInstallment.update({ where: { id }, data: { paidAt: new Date(2026, 10, 1, 12) } });
    }

    it("parcela selecionada paga por fora com o valor ainda cabendo dá corrida quando expected vem", async () => {
      const seeded = await threeParcels();
      const ids = seeded.installments.map((i) => i.id);
      await paidOutside(ids[0]);
      const before = await snapshot();
      const res = await receivePayment({
        installmentIds: ids,
        amountCents: 5000,
        remainder: { mode: "APPEND" },
        expected: { partialId: ids[1], paidCents: 1667, remainderCents: 1666 },
      });
      expect(res).toEqual({ ok: false, error: RACE });
      expect(await snapshot()).toEqual(before);
    });

    it("sem expected, o mesmo cenário realoca como antes", async () => {
      const seeded = await threeParcels();
      const ids = seeded.installments.map((i) => i.id);
      await paidOutside(ids[0]);
      const res = await receivePayment({ installmentIds: ids, amountCents: 5000, remainder: { mode: "APPEND" } });
      expect(res).toEqual({
        ok: true,
        data: { count: 2, totalCents: 5000, partial: true, paidInstallmentIds: [ids[1], ids[2]] },
      });
    });

    it("expected null recusa quando a realocação passa a ter parcial", async () => {
      const seeded = await threeParcels();
      const ids = seeded.installments.map((i) => i.id);
      await paidOutside(ids[0]);
      const before = await snapshot();
      const res = await receivePayment({ installmentIds: ids, amountCents: 3333, expected: null });
      expect(res).toEqual({ ok: false, error: RACE });
      expect(await snapshot()).toEqual(before);
    });

    it("expected igual à alocação recebe normalmente", async () => {
      const seeded = await threeParcels();
      const ids = seeded.installments.map((i) => i.id);
      const res = await receivePayment({
        installmentIds: ids,
        amountCents: 5000,
        remainder: { mode: "SPREAD" },
        expected: { partialId: ids[1], paidCents: 1667, remainderCents: 1666 },
        expectedRows: seeded.installments.map((i) => ({ id: i.id, amountCents: i.amountCents })),
      });
      expect(res.ok).toBe(true);
      const { parcels } = await expectBalanced(seeded.id);
      expect(parcels.map((p) => [p.amountCents, p.paidAt !== null])).toEqual([
        [3333, true],
        [1667, true],
        [5000, false],
      ]);
    });

    it("SPREAD com valor de parcela seguinte alterado dá corrida", async () => {
      const seeded = await threeParcels();
      const [first, second, third] = seeded.installments;
      const seen = seeded.installments.map((i) => ({ id: i.id, amountCents: i.amountCents }));
      await testDb.saleInstallment.update({ where: { id: second.id }, data: { amountCents: 3367 } });
      await testDb.saleInstallment.update({ where: { id: third.id }, data: { amountCents: 3300 } });
      const before = await snapshot();
      const res = await receivePayment({
        installmentIds: [first.id],
        amountCents: 1000,
        remainder: { mode: "SPREAD" },
        expected: { partialId: first.id, paidCents: 1000, remainderCents: 2333 },
        expectedRows: seen,
      });
      expect(res).toEqual({ ok: false, error: RACE });
      expect(await snapshot()).toEqual(before);
    });

    it("SPREAD com parcela seguinte paga por fora dá corrida", async () => {
      const seeded = await threeParcels();
      const [first, , third] = seeded.installments;
      const seen = seeded.installments.map((i) => ({ id: i.id, amountCents: i.amountCents }));
      await paidOutside(third.id);
      const res = await receivePayment({
        installmentIds: [first.id],
        amountCents: 1000,
        remainder: { mode: "SPREAD" },
        expected: { partialId: first.id, paidCents: 1000, remainderCents: 2333 },
        expectedRows: seen,
      });
      expect(res).toEqual({ ok: false, error: RACE });
    });

    it("recusa expected malformado", async () => {
      const seeded = await threeParcels();
      const res = await receivePayment({
        installmentIds: [seeded.installments[0].id],
        amountCents: 1000,
        remainder: { mode: "APPEND" },
        expected: { partialId: "", paidCents: -1, remainderCents: 0 },
      });
      expect(res.ok).toBe(false);
      expect(await testDb.installmentSplit.count()).toBe(0);
    });
  });

  it("venda simples com NEW_DATE vira paga + restante na nova data", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [{ amountCents: 5000, dueDate: due(10) }],
    });
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 2000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" },
    });
    expect(res).toEqual({
      ok: true,
      data: { count: 1, totalCents: 2000, partial: true, paidInstallmentIds: [seeded.installments[0].id] },
    });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt !== null, ymd(p.dueDate), p.forecastPreset])).toEqual([
      [2000, true, "2026-11-05", "CUSTOM"],
      [3000, false, "2026-12-10", "CUSTOM"],
    ]);
    expect(parcels[1].dueDate).toEqual(new Date(2026, 11, 10, 12));
    expect([sale.status, sale.installmentCount, sale.openCents, ymd(sale.paymentForecastDate)]).toEqual([
      "PENDING",
      2,
      3000,
      "2026-12-10",
    ]);
    const splits = await testDb.installmentSplit.findMany();
    expect(splits).toHaveLength(1);
    expect(splits[0]).toMatchObject({
      saleId: seeded.id,
      paidInstallmentId: seeded.installments[0].id,
      originalCents: 5000,
      mode: "NEW_DATE",
      workspaceId: context.workspaceId,
      shares: [{ installmentId: parcels[1].id, cents: 3000, created: true }],
    });
  });

  it("SPREAD dilui o restante nas parcelas seguintes", async () => {
    const seeded = await threeParcels();
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 1000,
      remainder: { mode: "SPREAD" },
    });
    expect(res.ok).toBe(true);
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.id, p.amountCents, p.paidAt !== null])).toEqual([
      [seeded.installments[0].id, 1000, true],
      [seeded.installments[1].id, 4499, false],
      [seeded.installments[2].id, 4501, false],
    ]);
    expect([sale.status, sale.installmentCount, sale.openCents, sale.paymentForecastDate]).toEqual([
      "PENDING",
      3,
      9000,
      due(11),
    ]);
    const split = await testDb.installmentSplit.findFirstOrThrow();
    expect([split.originalCents, split.mode, split.shares]).toEqual([
      3333,
      "SPREAD",
      [
        { installmentId: seeded.installments[1].id, cents: 1166, created: false },
        { installmentId: seeded.installments[2].id, cents: 1167, created: false },
      ],
    ]);
  });

  it("APPEND cria uma parcela no fim, um mês após a última", async () => {
    const seeded = await threeParcels();
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 1000,
      remainder: { mode: "APPEND" },
    });
    expect(res.ok).toBe(true);
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.number, p.amountCents, p.paidAt !== null, ymd(p.dueDate)])).toEqual([
      [1, 1000, true, "2026-11-05"],
      [2, 3333, false, "2026-12-05"],
      [3, 3334, false, "2027-01-05"],
      [4, 2333, false, "2027-02-05"],
    ]);
    expect([sale.installmentCount, sale.openCents]).toEqual([4, 9000]);
    const split = await testDb.installmentSplit.findFirstOrThrow();
    expect([split.mode, split.shares]).toEqual(["APPEND", [{ installmentId: parcels[3].id, cents: 2333, created: true }]]);
  });

  it("NEW_DATE na #1 de 3 coloca o restante como #2 e empurra as antigas", async () => {
    const seeded = await threeParcels();
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 1000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-11-20" },
    });
    expect(res.ok).toBe(true);
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.number, p.amountCents, p.paidAt !== null, ymd(p.dueDate)])).toEqual([
      [1, 1000, true, "2026-11-05"],
      [2, 2333, false, "2026-11-20"],
      [3, 3333, false, "2026-12-05"],
      [4, 3334, false, "2027-01-05"],
    ]);
    expect(parcels[0].id).toBe(seeded.installments[0].id);
    expect(parcels[2].id).toBe(seeded.installments[1].id);
    expect(parcels[3].id).toBe(seeded.installments[2].id);
    expect([sale.installmentCount, sale.openCents, ymd(sale.paymentForecastDate)]).toEqual([4, 9000, "2026-11-20"]);
  });

  it("APPEND usa o preset do plano, não o CUSTOM de um restante", async () => {
    const plans = [due(10), due(11), due(12)].map((d, idx) => {
      const date = fifthBusinessDayOfMonth(d.getFullYear(), d.getMonth());
      return {
        number: idx + 1,
        amountCents: idx === 2 ? 3334 : 3333,
        dueDate: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12),
        forecastPreset: "FIFTH_BUSINESS_DAY" as const,
        paidAt: null,
        workspaceId: context.workspaceId,
      };
    });
    const seeded = await testDb.sale.create({
      data: {
        workspaceId: context.workspaceId,
        soldAt: new Date(2026, 9, 1, 12),
        totalCents: 10000,
        status: "PENDING",
        openCents: 10000,
        installmentCount: 3,
        forecastPreset: "FIFTH_BUSINESS_DAY",
        paymentForecastDate: plans[0].dueDate,
        installments: { create: plans },
      },
      include: { installments: { orderBy: { number: "asc" } } },
    });
    const first = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 1000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-11-01" },
    });
    expect(first.ok).toBe(true);
    const afterFirst = await testDb.sale.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(afterFirst.forecastPreset).toBe("CUSTOM");
    const remainder = (await parcelsOf(seeded.id))[1];
    expect([remainder.amountCents, remainder.forecastPreset]).toEqual([2333, "CUSTOM"]);

    const second = await receivePayment({
      installmentIds: [remainder.id],
      amountCents: 333,
      remainder: { mode: "APPEND" },
    });
    expect(second.ok).toBe(true);
    const { parcels } = await expectBalanced(seeded.id);
    const last = parcels[parcels.length - 1];
    const expected = fifthBusinessDayOfMonth(2027, 1);
    expect(parcels).toHaveLength(5);
    expect([last.amountCents, last.forecastPreset, ymd(last.dueDate)]).toEqual([
      2000,
      "FIFTH_BUSINESS_DAY",
      ymd(expected),
    ]);
  });

  it("ficha do cliente abate na ordem e parcela só a venda do meio", async () => {
    const customer = await testDb.customer.create({ data: { name: "Ana", workspaceId: context.workspaceId } });
    const a = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: customer.id,
      soldAt: new Date(2026, 8, 1, 12),
      parcels: [{ amountCents: 6000, dueDate: due(9) }],
    });
    const b = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: customer.id,
      soldAt: new Date(2026, 8, 2, 12),
      parcels: [{ amountCents: 7000, dueDate: due(10) }],
    });
    const c = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: customer.id,
      soldAt: new Date(2026, 8, 3, 12),
      parcels: [{ amountCents: 5000, dueDate: due(11) }],
    });
    const res = await receivePayment({
      installmentIds: [c.installments[0].id, a.installments[0].id, b.installments[0].id],
      amountCents: 10000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-12-20" },
    });
    expect(res).toEqual({
      ok: true,
      data: {
        count: 2,
        totalCents: 10000,
        partial: true,
        paidInstallmentIds: [a.installments[0].id, b.installments[0].id],
      },
    });
    const sa = await expectBalanced(a.id);
    const sb = await expectBalanced(b.id);
    const sc = await expectBalanced(c.id);
    expect([sa.sale.status, sa.sale.openCents, sa.parcels.length]).toEqual(["PAID", 0, 1]);
    expect(sb.parcels.map((p) => [p.amountCents, p.paidAt !== null])).toEqual([
      [4000, true],
      [3000, false],
    ]);
    expect([sb.sale.status, sb.sale.openCents, sb.sale.installmentCount]).toEqual(["PENDING", 3000, 2]);
    expect([sc.sale.status, sc.sale.openCents, sc.parcels.length, sc.parcels[0].paidAt]).toEqual(["PENDING", 5000, 1, null]);
    expect(sa.parcels[0].paidAt).toEqual(sb.parcels[0].paidAt);
  });

  it("valor que fecha parcelas inteiras não gera parcial nem split", async () => {
    const a = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 6000, dueDate: due(9) }] });
    const b = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 7000, dueDate: due(10) }] });
    const c = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 5000, dueDate: due(11) }] });
    const res = await receivePayment({
      installmentIds: [a.installments[0].id, b.installments[0].id, c.installments[0].id],
      amountCents: 13000,
    });
    expect(res).toEqual({
      ok: true,
      data: { count: 2, totalCents: 13000, partial: false, paidInstallmentIds: [a.installments[0].id, b.installments[0].id] },
    });
    expect(await testDb.installmentSplit.count()).toBe(0);
    const sc = await expectBalanced(c.id);
    expect(sc.sale.status).toBe("PENDING");
  });

  it("corrida antes da leitura: parcela paga por fora recusa e não grava nada", async () => {
    const a = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 6000, dueDate: due(9) }] });
    const b = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 7000, dueDate: due(10) }] });
    const c = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 5000, dueDate: due(11) }] });
    await testDb.saleInstallment.update({ where: { id: a.installments[0].id }, data: { paidAt: new Date() } });
    const before = await snapshot();
    const res = await receivePayment({
      installmentIds: [a.installments[0].id, b.installments[0].id, c.installments[0].id],
      amountCents: 18000,
    });
    expect(res).toEqual({ ok: false, error: RACE });
    expect(await snapshot()).toEqual(before);
  });

  it("corrida depois da leitura numa parcela inteira faz rollback", async () => {
    const a = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 6000, dueDate: due(9) }] });
    const b = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 7000, dueDate: due(10) }] });
    const before = await snapshot();
    const external = new Date(2026, 9, 1, 12);
    hooks.afterFirstRead = async () => {
      await testDb.saleInstallment.update({ where: { id: a.installments[0].id }, data: { paidAt: external } });
    };
    const res = await receivePayment({
      installmentIds: [a.installments[0].id, b.installments[0].id],
      amountCents: 10000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-12-20" },
    });
    expect(res).toEqual({ ok: false, error: RACE });
    const after = await snapshot();
    expect(after.splits).toBe(0);
    expect(after.parcels).toEqual(
      before.parcels.map((p) => (p[0] === a.installments[0].id ? [p[0], p[1], p[2], external.getTime(), p[4]] : p)),
    );
    expect(after.sales).toEqual(before.sales);
  });

  it("corrida depois da leitura na parcela parcial faz rollback", async () => {
    const a = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 6000, dueDate: due(9) }] });
    const b = await seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents: 7000, dueDate: due(10) }] });
    const external = new Date(2026, 9, 1, 12);
    hooks.afterFirstRead = async () => {
      await testDb.saleInstallment.update({ where: { id: b.installments[0].id }, data: { paidAt: external } });
    };
    const res = await receivePayment({
      installmentIds: [a.installments[0].id, b.installments[0].id],
      amountCents: 10000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-12-20" },
    });
    expect(res).toEqual({ ok: false, error: RACE });
    const pa = await parcelsOf(a.id);
    const pb = await parcelsOf(b.id);
    expect(pa.map((p) => [p.amountCents, p.paidAt])).toEqual([[6000, null]]);
    expect(pb.map((p) => [p.amountCents, p.paidAt])).toEqual([[7000, external]]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("parcial sem destino do restante recusa e não grava nada", async () => {
    const seeded = await threeParcels();
    const before = await snapshot();
    const res = await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000 });
    expect(res).toEqual({ ok: false, error: "Escolha o que fazer com o restante." });
    expect(await snapshot()).toEqual(before);
  });

  it("SPREAD na última parcela aberta recusa e desfaz as inteiras do lote", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [
        { amountCents: 2500, dueDate: due(10) },
        { amountCents: 2500, dueDate: due(11) },
      ],
    });
    const before = await snapshot();
    const res = await receivePayment({
      installmentIds: seeded.installments.map((i) => i.id),
      amountCents: 4000,
      remainder: { mode: "SPREAD" },
    });
    expect(res).toEqual({ ok: false, error: "Não há parcelas seguintes para diluir." });
    expect(await snapshot()).toEqual(before);
  });

  it("SPREAD ignora as parcelas quitadas no mesmo lote", async () => {
    const seeded = await threeParcels();
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id, seeded.installments[1].id],
      amountCents: 5000,
      remainder: { mode: "SPREAD" },
    });
    expect(res.ok).toBe(true);
    const { parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt !== null])).toEqual([
      [3333, true],
      [1667, true],
      [5000, false],
    ]);
  });

  it("NEW_DATE com data inválida recusa sem gravar", async () => {
    const seeded = await threeParcels();
    const before = await snapshot();
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 1000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-02-30" },
    });
    expect(res).toEqual({ ok: false, error: "Informe uma data válida." });
    expect(await snapshot()).toEqual(before);
  });

  it("valida a entrada", async () => {
    const seeded = await threeParcels();
    const id = seeded.installments[0].id;
    expect(await receivePayment({ installmentIds: [], amountCents: 100 })).toEqual({
      ok: false,
      error: "Selecione ao menos uma parcela.",
    });
    expect(await receivePayment({ installmentIds: [id, id], amountCents: 100 })).toEqual({
      ok: false,
      error: "Parcelas repetidas na seleção.",
    });
    expect(await receivePayment({ installmentIds: [id], amountCents: 0 })).toEqual({
      ok: false,
      error: "Informe um valor maior que zero.",
    });
    expect(await receivePayment({ installmentIds: [id], amountCents: 10.5 })).toEqual({
      ok: false,
      error: "Informe um valor maior que zero.",
    });
    expect(
      await receivePayment({
        installmentIds: [id],
        amountCents: 100,
        remainder: { mode: "OUTRO" } as unknown as { mode: "SPREAD" },
      }),
    ).toEqual({ ok: false, error: "Escolha o que fazer com o restante." });
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("valida a entrada com zod sem lançar", async () => {
    const seeded = await threeParcels();
    const id = seeded.installments[0].id;
    const call = (value: unknown) => receivePayment(value as Parameters<typeof receivePayment>[0]);
    const before = await snapshot();
    expect(await call(null)).toEqual({ ok: false, error: "Dados de recebimento inválidos." });
    expect(await call({ installmentIds: "x", amountCents: 100 })).toEqual({
      ok: false,
      error: "Selecione ao menos uma parcela.",
    });
    expect(await call({ installmentIds: [123], amountCents: 100 })).toEqual({
      ok: false,
      error: "Selecione ao menos uma parcela.",
    });
    expect(await call({ installmentIds: [""], amountCents: 100 })).toEqual({
      ok: false,
      error: "Selecione ao menos uma parcela.",
    });
    expect(await call({ installmentIds: [id], amountCents: "100" })).toEqual({
      ok: false,
      error: "Informe um valor maior que zero.",
    });
    expect(await call({ installmentIds: [id], amountCents: -5 })).toEqual({
      ok: false,
      error: "Informe um valor maior que zero.",
    });
    expect(await call({ installmentIds: [id], amountCents: Number.NaN })).toEqual({
      ok: false,
      error: "Informe um valor maior que zero.",
    });
    expect(await call({ installmentIds: [id], amountCents: 100_000_001 })).toEqual({
      ok: false,
      error: "O valor é maior que o total selecionado.",
    });
    expect(await call({ installmentIds: [id], amountCents: 100, remainder: { mode: "NEW_DATE" } })).toEqual({
      ok: false,
      error: "Informe uma data válida.",
    });
    expect(await call({ installmentIds: [id], amountCents: 100, remainder: "SPREAD" })).toEqual({
      ok: false,
      error: "Escolha o que fazer com o restante.",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("valor acima do aberto selecionado não é corrida", async () => {
    const seeded = await threeParcels();
    const before = await snapshot();
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id, seeded.installments[1].id],
      amountCents: 7000,
      remainder: { mode: "APPEND" },
    });
    expect(res).toEqual({ ok: false, error: "O valor é maior que o total selecionado." });
    expect(await snapshot()).toEqual(before);
  });

  it("corrida: SPREAD por fora aumenta a parcela inteira entre a leitura e a transação", async () => {
    const seeded = await threeParcels();
    const [first, second, third] = seeded.installments;
    const external = new Date(2026, 9, 1, 12);
    hooks.afterFirstRead = async () => {
      await testDb.$transaction([
        testDb.saleInstallment.update({ where: { id: first.id }, data: { amountCents: 1000, paidAt: external } }),
        testDb.saleInstallment.update({ where: { id: second.id }, data: { amountCents: 4499 } }),
        testDb.saleInstallment.update({ where: { id: third.id }, data: { amountCents: 4501 } }),
      ]);
    };
    const res = await receivePayment({ installmentIds: [second.id], amountCents: 3333 });
    expect(res).toEqual({ ok: false, error: RACE });
    const parcels = await parcelsOf(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([
      [1000, external],
      [4499, null],
      [4501, null],
    ]);
    expect(parcels.reduce((sum, p) => sum + p.amountCents, 0)).toBe(10000);
  });

  it("depois de um NEW_DATE tardio, o botão da lista recebe a parcela de menor vencimento", async () => {
    const seeded = await threeParcels();
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 1000,
      remainder: { mode: "NEW_DATE", dueDate: "2027-03-01" },
    });
    expect(res.ok).toBe(true);
    const { items } = await getSales();
    const sale = items.find((s) => s.id === seeded.id)!;
    const listed = sale.installments[0];
    expect([listed.id, listed.number, listed.amountCents]).toEqual([seeded.installments[1].id, 3, 3333]);
    const target = sale.saleRows.find((row) => row.id === listed.id)!;
    expect([target.number, target.amountCents, target.paidAt]).toEqual([3, 3333, null]);
    const paid = await receivePayment({ installmentIds: [target.id], amountCents: target.amountCents });
    expect(paid).toEqual({
      ok: true,
      data: { count: 1, totalCents: 3333, partial: false, paidInstallmentIds: [seeded.installments[1].id] },
    });
  });

  it("recebimentos concorrentes na mesma venda nunca perdem centavos", async () => {
    for (let round = 0; round < 5; round += 1) {
      const seeded = await threeParcels();
      const results = await Promise.all([
        receivePayment({
          installmentIds: [seeded.installments[0].id],
          amountCents: 1000,
          remainder: { mode: "NEW_DATE", dueDate: "2026-11-20" },
        }),
        receivePayment({
          installmentIds: [seeded.installments[1].id],
          amountCents: 1000,
          remainder: { mode: "APPEND" },
        }),
      ]);
      for (const r of results) {
        expect(r.ok || r.error === RACE).toBe(true);
      }
      expect(results.some((r) => r.ok)).toBe(true);
      const { sale, parcels } = await expectBalanced(seeded.id);
      const okCount = results.filter((r) => r.ok).length;
      expect(parcels).toHaveLength(3 + okCount);
      expect(sale.openCents).toBe(10000 - 1000 * okCount);
      expect(await testDb.installmentSplit.count({ where: { saleId: seeded.id } })).toBe(okCount);
    }
  });

  it("recebimentos concorrentes em vendas cruzadas não dão deadlock", async () => {
    for (let round = 0; round < 5; round += 1) {
      const a = await threeParcels();
      const b = await threeParcels();
      const results = await Promise.all([
        receivePayment({
          installmentIds: [a.installments[0].id, b.installments[0].id],
          amountCents: 5000,
          remainder: { mode: "APPEND" },
        }),
        receivePayment({
          installmentIds: [b.installments[1].id, a.installments[1].id],
          amountCents: 5000,
          remainder: { mode: "NEW_DATE", dueDate: "2027-05-01" },
        }),
      ]);
      expect(results.map((r) => r.ok)).toEqual([true, true]);
      await expectBalanced(a.id);
      await expectBalanced(b.id);
    }
  });

  it("não recebe parcela de outro workspace", async () => {
    const other = await createWorkspace("Outra");
    const foreign = await seedParceledSale({ workspaceId: other.id, parcels: [{ amountCents: 1000, dueDate: due(10) }] });
    const res = await receivePayment({ installmentIds: [foreign.installments[0].id], amountCents: 500, remainder: { mode: "APPEND" } });
    expect(res).toEqual({ ok: false, error: RACE });
    const parcels = await parcelsOf(foreign.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([[1000, null]]);
  });

  it("parcial em sequência: recebe parte, depois parte do restante, depois o resto", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [{ amountCents: 5000, dueDate: due(10) }],
    });
    await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 2000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" },
    });
    const second = (await parcelsOf(seeded.id))[1];
    await receivePayment({ installmentIds: [second.id], amountCents: 1000, remainder: { mode: "APPEND" } });
    const third = (await parcelsOf(seeded.id))[2];
    const res = await receivePayment({ installmentIds: [third.id], amountCents: 2000 });
    expect(res.ok).toBe(true);
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt !== null])).toEqual([
      [2000, true],
      [1000, true],
      [2000, true],
    ]);
    expect([sale.status, sale.openCents]).toEqual(["PAID", 0]);
    expect(await testDb.installmentSplit.count()).toBe(2);
  });

  it("editar a venda depois de um parcial preserva o pago e redistribui o aberto", async () => {
    const item = await testDb.item.create({
      data: { name: "Bolo", unit: "UN", sellable: true, productionInput: false, workspaceId: context.workspaceId },
    });
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [{ amountCents: 5000, dueDate: due(10) }],
    });
    await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 2000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" },
    });
    const fd = new FormData();
    fd.set("soldAt", "2026-10-09");
    fd.set(
      "items",
      JSON.stringify([{ itemId: item.id, productName: "Bolo", variantId: null, variantName: null, quantity: 1, unitPriceCents: 5000 }]),
    );
    fd.set("paymentMode", "INSTALLMENTS");
    fd.set("installmentCount", "3");
    fd.set("forecastPreset", "CUSTOM");
    fd.set("forecastDate", "2026-11-05");
    expect(await updateSale(seeded.id, fd)).toEqual({ ok: true });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.number, p.amountCents, p.paidAt !== null])).toEqual([
      [1, 2000, true],
      [2, 1500, false],
      [3, 1500, false],
    ]);
    expect([sale.totalCents, sale.openCents, sale.installmentCount]).toEqual([5000, 3000, 3]);
  });
});

describe("applyPartial", () => {
  beforeEach(async () => {
    await resetDb();
    context.workspaceId = (await createWorkspace("Cookies")).id;
  });

  it("substitui split antigo da mesma parcela e avisa", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [
        { amountCents: 2000, dueDate: due(10) },
        { amountCents: 3000, dueDate: due(11) },
      ],
    });
    await testDb.installmentSplit.create({
      data: {
        saleId: seeded.id,
        paidInstallmentId: seeded.installments[0].id,
        originalCents: 5000,
        mode: "NEW_DATE",
        shares: [{ installmentId: seeded.installments[1].id, cents: 3000, created: true }],
        workspaceId: context.workspaceId,
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 500,
      remainder: { mode: "SPREAD" },
    });
    expect(res.ok).toBe(true);
    expect(warn).toHaveBeenCalledWith("applyPartial removeu split antigo", {
      saleId: seeded.id,
      installmentId: seeded.installments[0].id,
    });
    warn.mockRestore();
    const splits = await testDb.installmentSplit.findMany();
    expect(splits.map((x) => [x.originalCents, x.mode])).toEqual([[2000, "SPREAD"]]);
    await expectBalanced(seeded.id);
  });

  it("recusa parcela parcial que já foi paga", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [{ amountCents: 5000, dueDate: due(10), paidAt: due(9) }],
    });
    const res = await testDb.$transaction((tx) =>
      applyPartial(tx, {
        saleId: seeded.id,
        workspaceId: context.workspaceId,
        partialId: seeded.installments[0].id,
        paidCents: 2000,
        remainderCents: 3000,
        choice: { mode: "APPEND" },
        paidAt: new Date(),
        excludeIds: [],
      }),
    );
    expect(res).toEqual({ ok: false, error: RACE });
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("recusa quando o valor da parcela mudou desde a leitura", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [{ amountCents: 5000, dueDate: due(10) }],
    });
    const res = await testDb.$transaction((tx) =>
      applyPartial(tx, {
        saleId: seeded.id,
        workspaceId: context.workspaceId,
        partialId: seeded.installments[0].id,
        paidCents: 2000,
        remainderCents: 2000,
        choice: { mode: "APPEND" },
        paidAt: new Date(),
        excludeIds: [],
      }),
    );
    expect(res).toEqual({ ok: false, error: RACE });
  });
});

describe("lista de vendas", () => {
  beforeEach(async () => {
    await resetDb();
    context.workspaceId = (await createWorkspace("Cookies")).id;
  });

  it("mostra a parcela aberta de menor vencimento", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [
        { amountCents: 3000, dueDate: due(12) },
        { amountCents: 2000, dueDate: due(10) },
        { amountCents: 5000, dueDate: null },
      ],
    });
    const { items } = await getSales();
    const row = items.find((s) => s.id === seeded.id)!;
    expect(row.installments).toEqual([{ id: seeded.installments[1].id, number: 2, amountCents: 2000, dueDate: due(10) }]);
    expect(row.saleRows.map((r) => [r.id, r.number, r.amountCents, r.paidAt])).toEqual(
      seeded.installments.map((i) => [i.id, i.number, i.amountCents, null]),
    );
    expect(row.paymentForecastDate).toEqual(due(10));
  });
});

describe("isConcurrencyError", () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("falha", { code, clientVersion: "6.19.3", meta });
  const deadlock = () =>
    new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "40P01", message: "deadlock detected" }', {
      clientVersion: "6.19.3",
    });

  it("classifica só deadlock e write conflict como corrida", () => {
    expect(isConcurrencyError(known("P2034"))).toBe(true);
    expect(isConcurrencyError(known("P2010", { code: "40P01", message: "deadlock detected" }))).toBe(true);
    expect(isConcurrencyError(deadlock())).toBe(true);
  });

  it("não engole outros erros", () => {
    expect(isConcurrencyError(known("P2028"))).toBe(false);
    expect(isConcurrencyError(known("P2002", { target: ["saleId", "number"] }))).toBe(false);
    expect(isConcurrencyError(known("P2010", { code: "40001" }))).toBe(false);
    expect(isConcurrencyError(known("P2025"))).toBe(false);
    expect(isConcurrencyError(known("P2003", { field_name: "saleId" }))).toBe(false);
    expect(isConcurrencyError(new Error("deadlock detected"))).toBe(false);
    expect(
      isConcurrencyError(new Prisma.PrismaClientUnknownRequestError("connection reset", { clientVersion: "6.19.3" })),
    ).toBe(false);
  });

  describe("na action", () => {
    beforeEach(async () => {
      await resetDb();
      hooks.afterFirstRead = undefined;
      hooks.failUpdate = undefined;
      context.workspaceId = (await createWorkspace("Cookies")).id;
    });

    async function receiveWith(failure: Error) {
      const seeded = await seedParceledSale({
        workspaceId: context.workspaceId,
        parcels: [{ amountCents: 5000, dueDate: due(10) }],
      });
      const before = await snapshot();
      hooks.failUpdate = failure;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 5000 });
      const calls = { error: error.mock.calls, warn: warn.mock.calls };
      error.mockRestore();
      warn.mockRestore();
      expect(await snapshot()).toEqual(before);
      return { res, calls };
    }

    it("P2028 vira erro genérico com console.error do erro original", async () => {
      const failure = known("P2028");
      const { res, calls } = await receiveWith(failure);
      expect(res).toEqual({ ok: false, error: "Erro ao receber pagamento." });
      expect(calls.error).toEqual([["receivePayment error:", failure]]);
      expect(calls.warn).toEqual([]);
    });

    it("P2002 vira erro genérico com console.error", async () => {
      const failure = known("P2002", { target: ["saleId", "number"] });
      const { res, calls } = await receiveWith(failure);
      expect(res).toEqual({ ok: false, error: "Erro ao receber pagamento." });
      expect(calls.error).toEqual([["receivePayment error:", failure]]);
    });

    it("P2034 vira corrida sem console.error", async () => {
      const { res, calls } = await receiveWith(known("P2034"));
      expect(res).toEqual({ ok: false, error: RACE });
      expect(calls.error).toEqual([]);
      expect(calls.warn).toHaveLength(1);
    });

    it("40P01 vira corrida sem console.error", async () => {
      const { res, calls } = await receiveWith(deadlock());
      expect(res).toEqual({ ok: false, error: RACE });
      expect(calls.error).toEqual([]);
      expect(calls.warn).toHaveLength(1);
    });
  });
});
