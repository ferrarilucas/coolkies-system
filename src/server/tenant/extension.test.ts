import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import { scopedDb } from "./extension";

describe("escopo por workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("findMany não enxerga dados de outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    await testDb.product.create({ data: { name: "Cookie A", workspaceId: a.id } });
    await testDb.product.create({ data: { name: "Cookie B", workspaceId: b.id } });

    const found = await scopedDb(a.id).product.findMany();

    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Cookie A");
  });

  it("create grava o workspaceId sem que o chamador informe", async () => {
    const a = await createWorkspace("A");
    const created = await scopedDb(a.id).product.create({ data: { name: "Cookie" } });
    expect(created.workspaceId).toBe(a.id);
  });

  it("deleteMany não atinge outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    await testDb.product.create({ data: { name: "X-a", workspaceId: a.id } });
    await testDb.product.create({ data: { name: "X-b", workspaceId: b.id } });

    const before = await testDb.product.findMany();
    expect(before).toHaveLength(2);

    await scopedDb(a.id).product.deleteMany({});

    const remaining = await testDb.product.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workspaceId).toBe(b.id);
  });

  it("count respeita o escopo", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    await testDb.product.create({ data: { name: "X", workspaceId: a.id } });
    await testDb.product.create({ data: { name: "Y", workspaceId: b.id } });

    expect(await scopedDb(a.id).product.count()).toBe(1);
  });

  it("upsert respeita o escopo no create e no update", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    const alheio = await testDb.product.create({
      data: { name: "Alheio", workspaceId: b.id },
    });

    const criado = await scopedDb(a.id).product.upsert({
      where: { id: alheio.id },
      create: { name: "Novo" },
      update: { name: "Sequestrado" },
    });

    expect(criado.workspaceId).toBe(a.id);
    expect(criado.id).not.toBe(alheio.id);

    const intacto = await testDb.product.findUnique({ where: { id: alheio.id } });
    expect(intacto?.name).toBe("Alheio");
  });

  it("update não atinge linha de outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    const alheio = await testDb.product.create({
      data: { name: "Alheio", workspaceId: b.id },
    });

    await expect(
      scopedDb(a.id).product.update({
        where: { id: alheio.id },
        data: { name: "Sequestrado" },
      }),
    ).rejects.toThrow();
  });

  it("não toca modelos de autenticação", async () => {
    const a = await createWorkspace("A");
    const all = await scopedDb(a.id).workspace.findMany();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it("findUnique não retorna linha de outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    const alheio = await testDb.product.create({
      data: { name: "Alheio", workspaceId: b.id },
    });

    const found = await scopedDb(a.id).product.findUnique({ where: { id: alheio.id } });

    expect(found).toBeNull();
  });

  it("findUnique retorna a linha do próprio workspace", async () => {
    const a = await createWorkspace("A");
    const meu = await testDb.product.create({ data: { name: "Meu", workspaceId: a.id } });

    const found = await scopedDb(a.id).product.findUnique({ where: { id: meu.id } });

    expect(found?.id).toBe(meu.id);
  });

  it("nested write de venda grava workspaceId nos itens", async () => {
    const a = await createWorkspace("A");
    const scoped = scopedDb(a.id);
    const user = await testDb.user.create({
      data: { id: "u-nested", name: "Ana", email: "ana@example.com" },
    });
    const product = await scoped.product.create({ data: { name: "Cookie" } });

    const sale = await scoped.sale.create({
      data: {
        userId: user.id,
        totalCents: 1000,
        items: {
          create: [
            {
              productId: product.id,
              productNameSnapshot: "Cookie",
              quantity: 2,
              unitPriceSnapshot: 500,
            },
          ],
        },
      },
      include: { items: true },
    });

    expect(sale.workspaceId).toBe(a.id);
    expect(sale.items[0].workspaceId).toBe(a.id);
  });

  it("nested write em update de venda grava workspaceId nos itens recriados", async () => {
    const a = await createWorkspace("A");
    const scoped = scopedDb(a.id);
    const user = await testDb.user.create({
      data: { id: "u-update", name: "Bia", email: "bia@example.com" },
    });
    const product = await scoped.product.create({ data: { name: "Cookie" } });

    const sale = await scoped.sale.create({
      data: {
        userId: user.id,
        totalCents: 1000,
        items: {
          create: [
            {
              productId: product.id,
              productNameSnapshot: "Cookie",
              quantity: 2,
              unitPriceSnapshot: 500,
            },
          ],
        },
      },
    });

    await scoped.saleItem.deleteMany({ where: { saleId: sale.id } });

    await scoped.sale.update({
      where: { id: sale.id },
      data: {
        totalCents: 1500,
        items: {
          create: [
            {
              productId: product.id,
              productNameSnapshot: "Cookie",
              quantity: 3,
              unitPriceSnapshot: 500,
            },
          ],
        },
      },
    });

    const items = await testDb.saleItem.findMany({ where: { saleId: sale.id } });

    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].workspaceId).toBe(a.id);
  });

  it("update não vaza workspaceId de outro workspace para itens aninhados", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    const user = await testDb.user.create({
      data: { id: "u-leak", name: "Cau", email: "cau@example.com" },
    });
    const product = await testDb.product.create({
      data: { name: "Cookie B", workspaceId: b.id },
    });
    const alheia = await testDb.sale.create({
      data: { userId: user.id, totalCents: 100, workspaceId: b.id },
    });

    await expect(
      scopedDb(a.id).sale.update({
        where: { id: alheia.id },
        data: {
          items: {
            create: [
              {
                productId: product.id,
                productNameSnapshot: "Cookie B",
                quantity: 1,
                unitPriceSnapshot: 100,
              },
            ],
          },
        },
      }),
    ).rejects.toThrow();

    const items = await testDb.saleItem.findMany();
    expect(items).toHaveLength(0);
  });
});
