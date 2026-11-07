import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { testDb, resetDb, createWorkspace } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "" };
const hooks: { failUpdate?: Error; afterFirstRead?: () => Promise<void> } = {};
const auth: { session: { userId: string } | null } = { session: null };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => auth.session } },
}));

function withHooks(client: ReturnType<typeof scopedDb>) {
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

vi.mock("@/server/tenant/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/tenant/context")>()),
  getScopedDb: async () => ({ ...context, role: "OWNER", db: withHooks(scopedDb(context.workspaceId)) }),
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
  writeBlocked: async () => null,
}));

const { receivePayment, payInstallments, unpayInstallments, unpayLastCollection, unpayLastInstallment, updateSale } =
  await import("./sales");

const { POST: markPaid } = await import("@/app/api/v1/sales/mark-paid/route");

const RACE = "Algumas parcelas já foram recebidas. Revise o valor.";
const UNPAY_RACE = "Esta venda mudou enquanto você desfazia. Tente de novo.";
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
  const open = parcels.filter((p) => p.paidAt === null);
  expect(sale.openCents).toBe(open.reduce((sum, p) => sum + p.amountCents, 0));
  expect(sale.installmentCount).toBe(parcels.length);
  expect(sale.status).toBe(open.length === 0 ? "PAID" : "PENDING");
  return { sale, parcels };
}

function summaryOf(sale: { status: string; openCents: number; installmentCount: number; paymentForecastDate: Date | null }) {
  return [sale.status, sale.openCents, sale.installmentCount, ymd(sale.paymentForecastDate)];
}

async function snapshot() {
  const parcels = await testDb.saleInstallment.findMany({ orderBy: [{ saleId: "asc" }, { number: "asc" }] });
  const sales = await testDb.sale.findMany({ orderBy: { id: "asc" } });
  return {
    parcels: parcels.map((p) => [p.id, p.number, p.amountCents, p.paidAt?.getTime() ?? null]),
    sales: sales.map((s) => [s.id, s.status, s.openCents, s.installmentCount, s.paymentForecastDate?.getTime() ?? null]),
    splits: await testDb.installmentSplit.count(),
  };
}

describe("desfazer recebimento parcial", () => {
  beforeEach(async () => {
    await resetDb();
    hooks.failUpdate = undefined;
    hooks.afterFirstRead = undefined;
    auth.session = null;
    context.workspaceId = (await createWorkspace("Cookies")).id;
  });

  async function single(amountCents = 5000) {
    return seedParceledSale({ workspaceId: context.workspaceId, parcels: [{ amountCents, dueDate: due(10) }] });
  }

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

  it("NEW_DATE desfeito volta a uma parcela de 5000 aberta", async () => {
    const seeded = await single();
    const paidId = seeded.installments[0].id;
    await receivePayment({ installmentIds: [paidId], amountCents: 2000, remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" } });
    expect(await unpayInstallments([paidId])).toEqual({ ok: true });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.id, p.amountCents, p.paidAt, ymd(p.dueDate)])).toEqual([[paidId, 5000, null, "2026-11-05"]]);
    expect(summaryOf(sale)).toEqual(["PENDING", 5000, 1, "2026-11-05"]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("SPREAD desfeito volta a 3333/3333/3334", async () => {
    const seeded = await threeParcels();
    await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
    expect(await unpayInstallments([seeded.installments[0].id])).toEqual({ ok: true });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.id, p.amountCents, p.paidAt])).toEqual([
      [seeded.installments[0].id, 3333, null],
      [seeded.installments[1].id, 3333, null],
      [seeded.installments[2].id, 3334, null],
    ]);
    expect(summaryOf(sale)).toEqual(["PENDING", 10000, 3, "2026-11-05"]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("APPEND com a parcela nova já paga só reabre o recebido", async () => {
    const seeded = await threeParcels();
    await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "APPEND" } });
    const appended = (await parcelsOf(seeded.id))[3];
    expect(appended.amountCents).toBe(2333);
    expect((await receivePayment({ installmentIds: [appended.id], amountCents: 2333 })).ok).toBe(true);
    expect(await unpayInstallments([seeded.installments[0].id])).toEqual({ ok: true });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.id, p.amountCents, p.paidAt !== null])).toEqual([
      [seeded.installments[0].id, 1000, false],
      [seeded.installments[1].id, 3333, false],
      [seeded.installments[2].id, 3334, false],
      [appended.id, 2333, true],
    ]);
    expect(summaryOf(sale)).toEqual(["PENDING", 7667, 4, "2026-11-05"]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("ciclo repetido: parcial, desfaz, parcial de novo e recebe o resto termina PAID", async () => {
    const seeded = await single();
    const paidId = seeded.installments[0].id;
    for (let round = 0; round < 2; round += 1) {
      await receivePayment({ installmentIds: [paidId], amountCents: 2000, remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" } });
      expect(await unpayInstallments([paidId])).toEqual({ ok: true });
      const { sale, parcels } = await expectBalanced(seeded.id);
      expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([[5000, null]]);
      expect(summaryOf(sale)).toEqual(["PENDING", 5000, 1, "2026-11-05"]);
    }
    await receivePayment({ installmentIds: [paidId], amountCents: 3000, remainder: { mode: "APPEND" } });
    const rest = (await parcelsOf(seeded.id))[1];
    expect(rest.amountCents).toBe(2000);
    expect((await receivePayment({ installmentIds: [rest.id], amountCents: 2000 })).ok).toBe(true);
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt !== null])).toEqual([
      [3000, true],
      [2000, true],
    ]);
    expect(summaryOf(sale)).toEqual(["PAID", 0, 2, null]);
    expect(await testDb.installmentSplit.count()).toBe(1);
  });

  it("unpayLastCollection com parcial no lote reverte o lote inteiro e avisa hadPartial", async () => {
    const customer = await testDb.customer.create({ data: { name: "Ana", workspaceId: context.workspaceId } });
    const a = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: customer.id,
      parcels: [{ amountCents: 2000, dueDate: due(9) }],
    });
    const b = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: customer.id,
      parcels: [
        { amountCents: 3333, dueDate: due(10) },
        { amountCents: 3333, dueDate: due(11) },
        { amountCents: 3334, dueDate: due(12) },
      ],
    });
    const received = await receivePayment({
      installmentIds: [a.installments[0].id, b.installments[0].id],
      amountCents: 3000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-11-20" },
    });
    expect(received.data?.partial).toBe(true);
    const res = await unpayLastCollection(customer.id);
    expect(res).toEqual({
      ok: true,
      data: {
        installmentIds: expect.arrayContaining([a.installments[0].id, b.installments[0].id]),
        count: 2,
        totalCents: 3000,
        hadPartial: true,
      },
    });
    const savedA = await expectBalanced(a.id);
    const savedB = await expectBalanced(b.id);
    expect(savedA.parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([[2000, null]]);
    expect(savedB.parcels.map((p) => [p.id, p.amountCents, p.paidAt])).toEqual([
      [b.installments[0].id, 3333, null],
      [b.installments[1].id, 3333, null],
      [b.installments[2].id, 3334, null],
    ]);
    expect(summaryOf(savedA.sale)).toEqual(["PENDING", 2000, 1, "2026-10-05"]);
    expect(summaryOf(savedB.sale)).toEqual(["PENDING", 10000, 3, "2026-11-05"]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("unpayLastCollection sem parcial devolve hadPartial false", async () => {
    const customer = await testDb.customer.create({ data: { name: "Bia", workspaceId: context.workspaceId } });
    const a = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: customer.id,
      parcels: [{ amountCents: 2000, dueDate: due(9) }],
    });
    await receivePayment({ installmentIds: [a.installments[0].id], amountCents: 2000 });
    expect(await unpayLastCollection(customer.id)).toEqual({
      ok: true,
      data: { installmentIds: [a.installments[0].id], count: 1, totalCents: 2000, hadPartial: false },
    });
    await expectBalanced(a.id);
  });

  it("parcela que só recebeu parte do restante e já foi paga deixa o desfazer não limpo", async () => {
    const seeded = await threeParcels();
    await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
    expect((await payInstallments([seeded.installments[1].id])).ok).toBe(true);
    expect(await unpayInstallments([seeded.installments[0].id])).toEqual({ ok: true });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.id, p.amountCents, p.paidAt !== null])).toEqual([
      [seeded.installments[0].id, 1000, false],
      [seeded.installments[1].id, 4499, true],
      [seeded.installments[2].id, 4501, false],
    ]);
    expect(summaryOf(sale)).toEqual(["PENDING", 5501, 3, "2026-11-05"]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("parcela criada com valor alterado deixa o desfazer não limpo", async () => {
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      parcels: [
        { amountCents: 5000, dueDate: due(10) },
        { amountCents: 5000, dueDate: due(11) },
      ],
    });
    const [first, second] = seeded.installments;
    await receivePayment({ installmentIds: [second.id], amountCents: 2000, remainder: { mode: "NEW_DATE", dueDate: "2027-02-10" } });
    const created = (await parcelsOf(seeded.id))[2];
    expect([created.amountCents, created.paidAt]).toEqual([3000, null]);
    await receivePayment({ installmentIds: [first.id], amountCents: 1000, remainder: { mode: "SPREAD" } });
    expect((await testDb.saleInstallment.findUniqueOrThrow({ where: { id: created.id } })).amountCents).toBe(7000);

    expect(await unpayInstallments([second.id])).toEqual({ ok: true });
    const afterSecond = await expectBalanced(seeded.id);
    expect(afterSecond.parcels.map((p) => [p.id, p.amountCents, p.paidAt !== null])).toEqual([
      [first.id, 1000, true],
      [second.id, 2000, false],
      [created.id, 7000, false],
    ]);
    expect(await testDb.installmentSplit.count()).toBe(1);

    expect(await unpayInstallments([first.id])).toEqual({ ok: true });
    const afterFirst = await expectBalanced(seeded.id);
    expect(afterFirst.parcels.map((p) => [p.id, p.amountCents, p.paidAt !== null])).toEqual([
      [first.id, 5000, false],
      [second.id, 2000, false],
      [created.id, 3000, false],
    ]);
    expect(summaryOf(afterFirst.sale)).toEqual(["PENDING", 10000, 3, "2026-11-05"]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("parcela criada que sumiu deixa o desfazer não limpo", async () => {
    const seeded = await threeParcels();
    await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
    const split = await testDb.installmentSplit.findFirstOrThrow();
    await testDb.installmentSplit.update({
      where: { id: split.id },
      data: { shares: [{ installmentId: "inexistente", cents: 2333, created: false }] },
    });
    expect(await unpayInstallments([seeded.installments[0].id])).toEqual({ ok: true });
    const { parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([
      [1000, null],
      [4499, null],
      [4501, null],
    ]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("shares em formato inválido não lança, avisa e só reabre o recebido", async () => {
    const seeded = await single();
    const paidId = seeded.installments[0].id;
    await receivePayment({ installmentIds: [paidId], amountCents: 2000, remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" } });
    const split = await testDb.installmentSplit.findFirstOrThrow();
    await testDb.installmentSplit.update({ where: { id: split.id }, data: { shares: { lixo: true } } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await unpayInstallments([paidId]);
    const calls = warn.mock.calls;
    warn.mockRestore();
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual([["revertSplits shares inválido", { splitId: split.id }]]);
    const { parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([
      [2000, null],
      [3000, null],
    ]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("valor da parcela paga diferente do registrado no split não é limpo", async () => {
    const seeded = await threeParcels();
    await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
    const split = await testDb.installmentSplit.findFirstOrThrow();
    await testDb.installmentSplit.update({ where: { id: split.id }, data: { originalCents: 3000 } });
    expect(await unpayInstallments([seeded.installments[0].id])).toEqual({ ok: true });
    const { parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([
      [1000, null],
      [4499, null],
      [4501, null],
    ]);
  });

  it("editar a venda depois do parcial e desfazer a paga reabre com o valor recebido", async () => {
    const item = await testDb.item.create({
      data: { name: "Bolo", unit: "UN", sellable: true, productionInput: false, workspaceId: context.workspaceId },
    });
    const seeded = await single();
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
    expect(await testDb.installmentSplit.count()).toBe(0);
    const paid = (await parcelsOf(seeded.id))[0];
    expect([paid.amountCents, paid.paidAt !== null]).toEqual([2000, true]);
    expect(await unpayInstallments([paid.id])).toEqual({ ok: true });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([
      [2000, null],
      [1500, null],
      [1500, null],
    ]);
    expect([sale.totalCents, sale.openCents, sale.status]).toEqual([5000, 5000, "PENDING"]);
  });

  it("desfazer em cadeia no mesmo pedido volta à parcela original", async () => {
    const seeded = await single();
    const firstId = seeded.installments[0].id;
    await receivePayment({ installmentIds: [firstId], amountCents: 2000, remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" } });
    const second = (await parcelsOf(seeded.id))[1];
    await receivePayment({ installmentIds: [second.id], amountCents: 1000, remainder: { mode: "APPEND" } });
    expect(await testDb.installmentSplit.count()).toBe(2);
    expect(await unpayInstallments([firstId, second.id])).toEqual({ ok: true });
    const { sale, parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.id, p.amountCents, p.paidAt])).toEqual([[firstId, 5000, null]]);
    expect(summaryOf(sale)).toEqual(["PENDING", 5000, 1, "2026-11-05"]);
    expect(await testDb.installmentSplit.count()).toBe(0);
  });

  it("unpayLastInstallment desfaz o parcial da última parcela paga", async () => {
    const seeded = await threeParcels();
    await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
    const res = await unpayLastInstallment(seeded.id);
    expect(res).toEqual({
      ok: true,
      data: { installmentId: seeded.installments[0].id, number: 1, installmentCount: 3, hadPartial: true },
    });
    const { parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => p.amountCents)).toEqual([3333, 3333, 3334]);
  });

  it("unpayLastInstallment devolve a contagem relida depois de reverter", async () => {
    const seeded = await single();
    const paidId = seeded.installments[0].id;
    await receivePayment({ installmentIds: [paidId], amountCents: 2000, remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" } });
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: seeded.id } })).installmentCount).toBe(2);
    expect(await unpayLastInstallment(seeded.id)).toEqual({
      ok: true,
      data: { installmentId: paidId, number: 1, installmentCount: 1, hadPartial: true },
    });
    await expectBalanced(seeded.id);
  });

  it("unpayLastInstallment sem parcial devolve hadPartial false", async () => {
    const seeded = await threeParcels();
    await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 3333 });
    expect(await unpayLastInstallment(seeded.id)).toEqual({
      ok: true,
      data: { installmentId: seeded.installments[0].id, number: 1, installmentCount: 3, hadPartial: false },
    });
    await expectBalanced(seeded.id);
  });

  it("unpayLastInstallment com split não limpo também avisa hadPartial", async () => {
    const seeded = await threeParcels();
    const [first, , third] = seeded.installments;
    await receivePayment({ installmentIds: [third.id], amountCents: 1000, remainder: { mode: "NEW_DATE", dueDate: "2027-03-10" } });
    const created = (await parcelsOf(seeded.id))[3];
    expect(created.amountCents).toBe(2334);
    await receivePayment({ installmentIds: [first.id], amountCents: 1000, remainder: { mode: "SPREAD" } });
    expect((await testDb.saleInstallment.findUniqueOrThrow({ where: { id: created.id } })).amountCents).not.toBe(2334);
    expect(await unpayLastInstallment(seeded.id)).toEqual({
      ok: true,
      data: { installmentId: third.id, number: 3, installmentCount: 4, hadPartial: true },
    });
    const { parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.id, p.paidAt !== null])).toEqual([
      [first.id, true],
      [seeded.installments[1].id, false],
      [third.id, false],
      [created.id, false],
    ]);
    expect(parcels[2].amountCents).toBe(1000);
    expect(await testDb.installmentSplit.count({ where: { paidInstallmentId: third.id } })).toBe(0);
  });

  it("desfazer recusa parcela em aberto sem mexer em nada", async () => {
    const seeded = await threeParcels();
    const before = await snapshot();
    expect(await unpayInstallments([seeded.installments[0].id])).toEqual({ ok: false, error: "Não foi possível desfazer." });
    expect(await snapshot()).toEqual(before);
  });

  it("não desfaz parcela de outro workspace", async () => {
    const other = await createWorkspace("Outra");
    const foreign = await seedParceledSale({
      workspaceId: other.id,
      parcels: [{ amountCents: 1000, dueDate: due(10), paidAt: new Date(2026, 9, 1, 12) }],
    });
    expect(await unpayInstallments([foreign.installments[0].id])).toEqual({ ok: false, error: "Não foi possível desfazer." });
    expect((await parcelsOf(foreign.id))[0].paidAt).not.toBeNull();
  });

  it("desfazer e receber ao mesmo tempo na mesma venda não perde centavos", async () => {
    for (let round = 0; round < 6; round += 1) {
      const seeded = await threeParcels();
      const firstId = seeded.installments[0].id;
      await receivePayment({ installmentIds: [firstId], amountCents: 1000, remainder: { mode: "NEW_DATE", dueDate: "2026-11-20" } });
      const created = (await parcelsOf(seeded.id))[1];
      const [undo, receive] = await Promise.all([
        unpayInstallments([firstId]),
        receivePayment({ installmentIds: [created.id], amountCents: 500, remainder: { mode: "APPEND" } }),
      ]);
      expect(undo.ok || undo.error === UNPAY_RACE).toBe(true);
      expect(receive.ok || receive.error === RACE).toBe(true);
      expect(undo.ok || receive.ok).toBe(true);
      const { sale, parcels } = await expectBalanced(seeded.id);
      expect(sale.totalCents).toBe(10000);
      const paidCents = parcels.filter((p) => p.paidAt !== null).reduce((sum, p) => sum + p.amountCents, 0);
      expect(paidCents).toBe((undo.ok ? 0 : 1000) + (receive.ok ? 500 : 0));
      const splits = await testDb.installmentSplit.findMany({ where: { saleId: seeded.id } });
      const paidIds = new Set(parcels.filter((p) => p.paidAt !== null).map((p) => p.id));
      for (const split of splits) expect(paidIds.has(split.paidInstallmentId)).toBe(true);
    }
  });

  it("desfazer perde a corrida para outro desfazer e devolve a mensagem de corrida", async () => {
    const customer = await testDb.customer.create({ data: { name: "Ana", workspaceId: context.workspaceId } });
    const seeded = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId: customer.id,
      parcels: [{ amountCents: 5000, dueDate: due(10) }],
    });
    await receivePayment({
      installmentIds: [seeded.installments[0].id],
      amountCents: 2000,
      remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" },
    });
    let inner: Awaited<ReturnType<typeof unpayLastCollection>> | undefined;
    hooks.afterFirstRead = async () => {
      inner = await unpayLastCollection(customer.id);
    };
    const outer = await unpayLastCollection(customer.id);
    expect(inner?.ok).toBe(true);
    expect(inner?.data?.hadPartial).toBe(true);
    expect(outer).toEqual({ ok: false, error: UNPAY_RACE });
    const { parcels } = await expectBalanced(seeded.id);
    expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([[5000, null]]);
  });

  it("dois unpayLastCollection concorrentes: um desfaz e o outro não mexe em nada", async () => {
    const customer = await testDb.customer.create({ data: { name: "Bia", workspaceId: context.workspaceId } });
    for (let round = 0; round < 6; round += 1) {
      const seeded = await seedParceledSale({
        workspaceId: context.workspaceId,
        customerId: customer.id,
        parcels: [
          { amountCents: 3333, dueDate: due(10) },
          { amountCents: 3333, dueDate: due(11) },
          { amountCents: 3334, dueDate: due(12) },
        ],
      });
      await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
      const results = await Promise.all([unpayLastCollection(customer.id), unpayLastCollection(customer.id)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok)!;
      expect([UNPAY_RACE, "Nenhum recebimento para desfazer."]).toContain(loser.error);
      const { parcels } = await expectBalanced(seeded.id);
      expect(parcels.map((p) => [p.amountCents, p.paidAt])).toEqual([
        [3333, null],
        [3333, null],
        [3334, null],
      ]);
      await testDb.sale.delete({ where: { id: seeded.id } });
    }
  });

  it("desfazer e payInstallments ao mesmo tempo não dão deadlock nem erro genérico", async () => {
    for (let round = 0; round < 12; round += 1) {
      const seeded = await threeParcels();
      await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
      const error = vi.spyOn(console, "error");
      const settled = await Promise.allSettled([
        unpayInstallments([seeded.installments[0].id]),
        payInstallments([seeded.installments[1].id]),
      ]);
      const errors = error.mock.calls.length;
      error.mockRestore();
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      const [undo, pay] = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
      expect(undo).toEqual({ ok: true });
      expect(pay?.ok).toBe(true);
      expect(errors).toBe(0);
      const { parcels } = await expectBalanced(seeded.id);
      const paid = parcels.filter((p) => p.paidAt !== null);
      expect(paid.map((p) => p.id)).toEqual([seeded.installments[1].id]);
      expect([3333, 4499]).toContain(paid[0].amountCents);
      expect(pay?.data?.totalCents).toBe(paid[0].amountCents);
      expect(await testDb.installmentSplit.count({ where: { saleId: seeded.id } })).toBe(0);
    }
  });

  it("desfazer e mark-paid ao mesmo tempo não dão deadlock", async () => {
    const owner = await testDb.user.create({ data: { id: "u-undo", name: "Ana", email: "ana-undo@example.com" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: context.workspaceId, role: "OWNER" } });
    await testDb.subscription.create({ data: { userId: owner.id, plan: "corre", status: "TRIALING", provider: "INTERPIX" } });
    auth.session = { userId: owner.id };
    for (let round = 0; round < 16; round += 1) {
      const seeded = await threeParcels();
      await receivePayment({ installmentIds: [seeded.installments[0].id], amountCents: 1000, remainder: { mode: "SPREAD" } });
      const error = vi.spyOn(console, "error");
      const delay = round % 8;
      const settled = await Promise.allSettled([
        new Promise<void>((resolve) => setTimeout(resolve, delay)).then(() => unpayInstallments([seeded.installments[0].id])),
        markPaid(
          new NextRequest("http://localhost/api/v1/sales/mark-paid", {
            method: "POST",
            body: JSON.stringify({ installmentIds: [seeded.installments[1].id] }),
          }),
        ),
      ]);
      const errors = error.mock.calls.length;
      error.mockRestore();
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      const undo = settled[0].status === "fulfilled" ? settled[0].value : null;
      const response = settled[1].status === "fulfilled" ? (settled[1].value as Response) : null;
      expect(undo).toEqual({ ok: true });
      expect(response?.status).toBe(200);
      expect(errors).toBe(0);
      const { parcels } = await expectBalanced(seeded.id);
      const paid = parcels.filter((p) => p.paidAt !== null);
      expect(paid.map((p) => p.id)).toEqual([seeded.installments[1].id]);
      expect([3333, 4499]).toContain(paid[0].amountCents);
    }
  });

  describe("classificação de erros", () => {
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError("falha", { code, clientVersion: "6.19.3" });

    async function unpayWith(failure: Error) {
      const seeded = await single();
      const paidId = seeded.installments[0].id;
      await receivePayment({ installmentIds: [paidId], amountCents: 2000, remainder: { mode: "NEW_DATE", dueDate: "2026-12-10" } });
      const before = await snapshot();
      hooks.failUpdate = failure;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await unpayInstallments([paidId]);
      const calls = { error: error.mock.calls, warn: warn.mock.calls };
      error.mockRestore();
      warn.mockRestore();
      expect(await snapshot()).toEqual(before);
      return { res, calls };
    }

    it("P2034 vira corrida sem console.error e faz rollback", async () => {
      const { res, calls } = await unpayWith(known("P2034"));
      expect(res).toEqual({ ok: false, error: UNPAY_RACE });
      expect(calls.error).toEqual([]);
      expect(calls.warn).toHaveLength(1);
    });

    it("outro erro vira genérico com console.error e faz rollback", async () => {
      const failure = known("P2028");
      const { res, calls } = await unpayWith(failure);
      expect(res).toEqual({ ok: false, error: "Erro ao desfazer." });
      expect(calls.error).toEqual([["unpayInstallments error:", failure]]);
    });
  });
});
