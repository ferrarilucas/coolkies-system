import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "u1", canWrite: true };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({
    db: scopedDb(context.workspaceId),
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: "OWNER",
    canWrite: context.canWrite,
  }),
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
  assertCanWrite: async () => {
    if (!context.canWrite) throw new Error("Este workspace está em modo somente leitura.");
  },
}));

const { saveItem } = await import("./catalog");

type Value = { key: string; id: string | null; name: string };

function option(name: string, values: string[], id: string | null = null) {
  return { id, name, values: values.map((v): Value => ({ key: v.toLowerCase(), id: null, name: v })) };
}

function combo(valueKeys: string[], priceCents: number | null = null, id: string | null = null) {
  return { id, valueKeys, priceCents, recipeId: null, active: true };
}

async function savedOptions(itemId: string) {
  return testDb.itemOption.findMany({
    where: { itemId },
    orderBy: { position: "asc" },
    include: { values: { orderBy: { position: "asc" } } },
  });
}

function asInput(options: Awaited<ReturnType<typeof savedOptions>>) {
  return options.map((o) => ({
    id: o.id,
    name: o.name,
    values: o.values.map((v): Value => ({ key: v.id, id: v.id, name: v.name })),
  }));
}

describe("saveItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Loja");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria um produto com um eixo, uma combinação e preço, e o item fica sellable", async () => {
    const res = await saveItem(null, {
      name: "Cookie",
      genericPriceCents: null,
      options: [option("Sabor", ["Chocolate"])],
      combinations: [combo(["chocolate"], 500)],
      removedVariantIds: [],
    });

    expect(res.ok).toBe(true);
    const itemId = res.data!.id;
    const item = await testDb.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.sellable).toBe(true);

    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId } });
    expect(variant.name).toBe("Chocolate");
    const price = await testDb.priceListItem.findFirstOrThrow({ where: { itemId, variantId: variant.id } });
    expect(price.priceCents).toBe(500);
  });

  it("cria só as combinações marcadas de Tamanho × Cor, com nome gerado na ordem dos eixos", async () => {
    const res = await saveItem(null, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options: [option("Tamanho", ["P", "M"]), option("Cor", ["Azul", "Verde"])],
      combinations: [combo(["p", "azul"]), combo(["azul", "m"]), combo(["m", "verde"], 5900)],
      removedVariantIds: [],
    });

    expect(res.ok).toBe(true);
    const itemId = res.data!.id;
    const variants = await testDb.variant.findMany({
      where: { itemId },
      orderBy: { name: "asc" },
      include: { optionValues: true },
    });
    expect(variants.map((v) => v.name)).toEqual(["M / Azul", "M / Verde", "P / Azul"]);
    expect(variants.every((v) => v.optionValues.length === 2)).toBe(true);

    const options = await savedOptions(itemId);
    expect(options.map((o) => o.name)).toEqual(["Tamanho", "Cor"]);
    expect(options[0].values.map((v) => v.name)).toEqual(["P", "M"]);
  });

  it("recusa combinação repetida", async () => {
    const res = await saveItem(null, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options: [option("Tamanho", ["P"]), option("Cor", ["Azul"])],
      combinations: [combo(["p", "azul"]), combo(["azul", "p"])],
      removedVariantIds: [],
    });
    expect(res).toEqual({ ok: false, error: 'A combinação "P / Azul" está repetida.' });
  });

  it("recusa combinação sem preço próprio quando o produto não tem preço padrão", async () => {
    const res = await saveItem(null, {
      name: "Camiseta",
      genericPriceCents: null,
      options: [option("Tamanho", ["P", "M"])],
      combinations: [combo(["p"], 4900), combo(["m"])],
      removedVariantIds: [],
    });
    expect(res).toEqual({
      ok: false,
      error: 'Defina um preço para "M" ou um preço padrão para o produto.',
    });
  });

  it("produto sem eixos exige preço de venda", async () => {
    const semPreco = await saveItem(null, {
      name: "Caneca",
      genericPriceCents: null,
      options: [],
      combinations: [],
      removedVariantIds: [],
    });
    expect(semPreco.ok).toBe(false);

    const comPreco = await saveItem(null, {
      name: "Caneca",
      genericPriceCents: 3500,
      options: [],
      combinations: [],
      removedVariantIds: [],
    });
    expect(comPreco.ok).toBe(true);
  });

  it("renomear um valor atualiza o nome das combinações e preserva o snapshot da venda antiga", async () => {
    const created = await saveItem(null, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options: [option("Tamanho", ["M"]), option("Cor", ["Azul"])],
      combinations: [combo(["m", "azul"])],
      removedVariantIds: [],
    });
    const itemId = created.data!.id;
    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId } });
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    await testDb.sale.create({
      data: {
        userId: user.id, workspaceId: context.workspaceId, totalCents: 4900, status: "PAID",
        items: {
          create: [{
            itemId, variantId: variant.id, quantity: 1, unitPriceSnapshot: 4900,
            productNameSnapshot: "Camiseta", variantNameSnapshot: "M / Azul", workspaceId: context.workspaceId,
          }],
        },
      },
    });

    const options = asInput(await savedOptions(itemId));
    const azulKey = options[1].values[0].key;
    options[1].values[0].name = "Azul marinho";

    const res = await saveItem(itemId, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options,
      combinations: [combo([options[0].values[0].key, azulKey], null, variant.id)],
      removedVariantIds: [],
    });

    expect(res.ok).toBe(true);
    const renamed = await testDb.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(renamed.name).toBe("M / Azul marinho");
    const saleItem = await testDb.saleItem.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(saleItem.variantNameSnapshot).toBe("M / Azul");
  });

  it("adicionar um eixo exige valor para as combinações existentes", async () => {
    const created = await saveItem(null, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options: [option("Tamanho", ["M"])],
      combinations: [combo(["m"])],
      removedVariantIds: [],
    });
    const itemId = created.data!.id;
    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId } });
    const options = [...asInput(await savedOptions(itemId)), option("Cor", ["Azul"])];
    const mKey = options[0].values[0].key;

    const semCor = await saveItem(itemId, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options,
      combinations: [combo([mKey], null, variant.id)],
      removedVariantIds: [],
    });
    expect(semCor).toEqual({ ok: false, error: 'Escolha um valor de "Cor" para cada combinação.' });

    const comCor = await saveItem(itemId, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options,
      combinations: [combo([mKey, "azul"], null, variant.id)],
      removedVariantIds: [],
    });
    expect(comCor.ok).toBe(true);
    const updated = await testDb.variant.findUniqueOrThrow({
      where: { id: variant.id },
      include: { optionValues: true },
    });
    expect(updated.name).toBe("M / Azul");
    expect(updated.optionValues).toHaveLength(2);
  });

  it("desativa (não apaga) uma combinação desmarcada que já tem produção", async () => {
    const created = await saveItem(null, {
      name: "Bolo",
      genericPriceCents: null,
      options: [option("Sabor", ["Cenoura"])],
      combinations: [combo(["cenoura"], 800)],
      removedVariantIds: [],
    });
    const itemId = created.data!.id;
    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId } });
    await testDb.productionBatch.create({
      data: { itemId, variantId: variant.id, quantity: 10, workspaceId: context.workspaceId },
    });

    const res = await saveItem(itemId, {
      name: "Bolo",
      genericPriceCents: 800,
      options: [],
      combinations: [],
      removedVariantIds: [variant.id],
    });

    expect(res.ok).toBe(true);
    expect(res.data?.deactivated).toContain("Cenoura");
    const stillThere = await testDb.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(stillThere.active).toBe(false);
  });

  it("apaga de fato uma combinação desmarcada sem nenhuma referência", async () => {
    const created = await saveItem(null, {
      name: "Torta",
      genericPriceCents: null,
      options: [option("Sabor", ["Limão"])],
      combinations: [combo(["limão"], 700)],
      removedVariantIds: [],
    });
    const itemId = created.data!.id;
    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId } });

    const res = await saveItem(itemId, {
      name: "Torta",
      genericPriceCents: 700,
      options: [],
      combinations: [],
      removedVariantIds: [variant.id],
    });

    expect(res.ok).toBe(true);
    expect(res.data?.deactivated).toEqual([]);
    expect(await testDb.variant.findUnique({ where: { id: variant.id } })).toBeNull();
    expect(await testDb.itemOption.count({ where: { itemId } })).toBe(0);
  });

  it("recusa eixo de outro workspace passado como se fosse deste produto", async () => {
    const outro = await createWorkspace("Outra loja");
    const alheio = await testDb.item.create({ data: { name: "Alheio", workspaceId: outro.id } });
    const opcaoAlheia = await testDb.itemOption.create({
      data: { itemId: alheio.id, name: "Cor", position: 0, workspaceId: outro.id },
    });

    const created = await saveItem(null, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options: [],
      combinations: [],
      removedVariantIds: [],
    });

    const res = await saveItem(created.data!.id, {
      name: "Camiseta",
      genericPriceCents: 4900,
      options: [{ id: opcaoAlheia.id, name: "Cor", values: [{ key: "azul", id: null, name: "Azul" }] }],
      combinations: [combo(["azul"])],
      removedVariantIds: [],
    });

    expect(res).toEqual({ ok: false, error: "Produto não encontrado." });
    expect(await testDb.itemOption.findUniqueOrThrow({ where: { id: opcaoAlheia.id } })).toMatchObject({ name: "Cor" });
  });
});
