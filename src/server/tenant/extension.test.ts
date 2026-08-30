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
});
