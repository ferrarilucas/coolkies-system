import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import {
  getOnboardingProgress,
  getOnboardingState,
  setAppTourCompleted,
  setOnboardingDismissed,
  setWorkspaceSector,
} from "./onboarding";

let ws = "";

async function seedUser(id: string) {
  return testDb.user.create({ data: { id, name: "Dona", email: `${id}@example.com` } });
}

describe("getOnboardingProgress", () => {
  beforeEach(async () => {
    await resetDb();
    ws = (await createWorkspace("Doce")).id;
  });

  it("começa com tudo pendente", async () => {
    const progress = await getOnboardingProgress(ws);
    expect(Object.values(progress).every((done) => done === false)).toBe(true);
  });

  it("conclui compra-insumo só com matéria-prima e compra-fornecedor com qualquer compra", async () => {
    const camiseta = await testDb.item.create({ data: { name: "Camiseta", workspaceId: ws } });
    const compra = await testDb.purchase.create({ data: { workspaceId: ws } });
    await testDb.purchaseItem.create({
      data: { purchaseId: compra.id, itemId: camiseta.id, quantity: 10, unit: "UN", pricePaidCents: 1000, workspaceId: ws },
    });

    let progress = await getOnboardingProgress(ws);
    expect(progress["compra-fornecedor"]).toBe(true);
    expect(progress["compra-insumo"]).toBe(false);

    const farinha = await testDb.item.create({
      data: { name: "Farinha", unit: "G", sellable: false, productionInput: true, workspaceId: ws },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: compra.id, itemId: farinha.id, quantity: 1000, unit: "G", pricePaidCents: 800, workspaceId: ws },
    });

    progress = await getOnboardingProgress(ws);
    expect(progress["compra-insumo"]).toBe(true);
  });

  it("conclui o catálogo só com preço ativo", async () => {
    const bolo = await testDb.item.create({ data: { name: "Bolo", workspaceId: ws } });
    const preco = await testDb.priceListItem.create({
      data: { itemId: bolo.id, priceCents: 1200, active: false, workspaceId: ws },
    });
    expect((await getOnboardingProgress(ws)).catalogo).toBe(false);

    await testDb.priceListItem.update({ where: { id: preco.id }, data: { active: true } });
    expect((await getOnboardingProgress(ws)).catalogo).toBe(true);
  });

  it("conclui ficha técnica, produção, venda e cliente", async () => {
    const bolo = await testDb.item.create({ data: { name: "Bolo", workspaceId: ws } });
    await testDb.recipe.create({ data: { name: "Bolo", workspaceId: ws } });
    await testDb.productionBatch.create({ data: { itemId: bolo.id, quantity: 10, workspaceId: ws } });
    await testDb.sale.create({ data: { workspaceId: ws } });
    await testDb.customer.create({ data: { name: "Ana", workspaceId: ws } });

    const progress = await getOnboardingProgress(ws);
    expect(progress["ficha-tecnica"]).toBe(true);
    expect(progress.producao).toBe(true);
    expect(progress.venda).toBe(true);
    expect(progress.cliente).toBe(true);
  });

  it("não conclui a venda parcelada com uma venda à vista, mesmo com a parcela 1", async () => {
    const avista = await testDb.sale.create({ data: { workspaceId: ws, totalCents: 1000 } });
    await testDb.saleInstallment.create({
      data: { saleId: avista.id, number: 1, amountCents: 1000, workspaceId: ws },
    });
    expect((await getOnboardingProgress(ws))["venda-parcelada"]).toBe(false);

    await testDb.sale.create({ data: { workspaceId: ws, totalCents: 3000, installmentCount: 3 } });
    expect((await getOnboardingProgress(ws))["venda-parcelada"]).toBe(true);
  });

  it("não conta dados de outro workspace", async () => {
    const outro = await createWorkspace("Outro");
    await testDb.customer.create({ data: { name: "Bia", workspaceId: outro.id } });
    await testDb.sale.create({ data: { workspaceId: outro.id, installmentCount: 2 } });

    const progress = await getOnboardingProgress(ws);
    expect(progress.cliente).toBe(false);
    expect(progress.venda).toBe(false);
    expect(progress["venda-parcelada"]).toBe(false);
  });
});

describe("getOnboardingState", () => {
  beforeEach(async () => {
    await resetDb();
    ws = (await createWorkspace("Doce")).id;
    await seedUser("u1");
  });

  it("devolve setor, tour e progresso para dono com escrita", async () => {
    await setWorkspaceSector(ws, "confeitaria");
    const state = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(state).toMatchObject({ workspaceId: ws, sector: "confeitaria", dismissed: false, appTourDone: false, eligible: true });
    expect(state.progress).not.toBeNull();
  });

  it("não calcula progresso para membro, modo leitura, sem setor ou dispensado", async () => {
    const semSetor = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(semSetor.progress).toBeNull();

    await setWorkspaceSector(ws, "roupas");
    const membro = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "MEMBER", canWrite: true });
    expect(membro).toMatchObject({ eligible: false, progress: null });

    const leitura = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: false });
    expect(leitura).toMatchObject({ eligible: false, progress: null });

    await setOnboardingDismissed(ws, true);
    const dispensado = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(dispensado).toMatchObject({ dismissed: true, progress: null });
  });

  it("mostra como concluídas as missões que um workspace antigo já cumpria ao escolher o setor", async () => {
    await testDb.customer.create({ data: { name: "Ana", workspaceId: ws } });
    await testDb.sale.create({ data: { workspaceId: ws } });

    await setWorkspaceSector(ws, "revenda");
    const state = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(state.progress?.venda).toBe(true);
    expect(state.progress?.cliente).toBe(true);
    expect(state.progress?.catalogo).toBe(false);
  });

  it("ignora um setor inválido gravado no banco", async () => {
    await testDb.workspace.update({ where: { id: ws }, data: { sector: "padaria" } });
    const state = await getOnboardingState({ workspaceId: ws, userId: "u1", role: "OWNER", canWrite: true });
    expect(state.sector).toBeNull();
    expect(state.progress).toBeNull();
  });
});

describe("gravações", () => {
  beforeEach(async () => {
    await resetDb();
    ws = (await createWorkspace("Doce")).id;
    await seedUser("u1");
  });

  it("recusa setor desconhecido sem gravar", async () => {
    await expect(setWorkspaceSector(ws, "padaria")).rejects.toThrow("Escolha o ramo do seu negócio.");
    const workspace = await testDb.workspace.findUnique({ where: { id: ws } });
    expect(workspace?.sector).toBeNull();
  });

  it("dispensa e retoma", async () => {
    await setOnboardingDismissed(ws, true);
    expect((await testDb.workspace.findUnique({ where: { id: ws } }))?.onboardingDismissedAt).toBeInstanceOf(Date);
    await setOnboardingDismissed(ws, false);
    expect((await testDb.workspace.findUnique({ where: { id: ws } }))?.onboardingDismissedAt).toBeNull();
  });

  it("marca e reinicia o tour do usuário", async () => {
    await setAppTourCompleted("u1", true);
    expect((await testDb.user.findUnique({ where: { id: "u1" } }))?.appTourCompletedAt).toBeInstanceOf(Date);
    await setAppTourCompleted("u1", false);
    expect((await testDb.user.findUnique({ where: { id: "u1" } }))?.appTourCompletedAt).toBeNull();
  });
});
