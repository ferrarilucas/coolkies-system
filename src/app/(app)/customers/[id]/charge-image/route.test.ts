import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";

const context: { workspaceId: string; fail: Error | null; dbFail: Error | null } = {
  workspaceId: "",
  fail: null,
  dbFail: null,
};

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceContext: async () => {
    if (context.fail) throw context.fail;
    return { workspaceId: context.workspaceId, userId: "u", role: "MEMBER", canWrite: true };
  },
  getWorkspaceDb: async () => {
    if (context.dbFail) throw context.dbFail;
    return scopedDb(context.workspaceId);
  },
}));

const { GET } = await import("./route");

function req(query: string, init?: { signal?: AbortSignal }) {
  return new NextRequest(`http://localhost/customers/x/charge-image${query}`, init);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /customers/[id]/charge-image", () => {
  let customerId = "";
  let installmentIds: string[] = [];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetDb();
    context.fail = null;
    context.dbFail = null;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    context.workspaceId = (await createWorkspace("Doceria São João")).id;
    customerId = (await testDb.customer.create({ data: { name: "João Pão", workspaceId: context.workspaceId } })).id;
    const sale = await seedParceledSale({
      workspaceId: context.workspaceId,
      customerId,
      parcels: [
        { amountCents: 1500, dueDate: new Date() },
        { amountCents: 1234, dueDate: new Date() },
      ],
    });
    installmentIds = sale.installments.map((i) => i.id);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("401 sem sessão", async () => {
    context.fail = new Error("Não autenticado");
    const res = await GET(req(`?i=${installmentIds[0]}`), params(customerId));
    expect(res.status).toBe(401);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("500 quando o contexto falha por outro motivo, com log", async () => {
    context.fail = new Error("Nenhum workspace disponível");
    const res = await GET(req(`?i=${installmentIds[0]}`), params(customerId));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "falha ao gerar imagem" });
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("[charge-image]");
  });

  it("500 quando o banco falha na consulta da seleção", async () => {
    context.dbFail = new Error("connection refused");
    const res = await GET(req(`?i=${installmentIds[0]}`), params(customerId));
    expect(res.status).toBe(500);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("[charge-image]");
  });

  it("400 sem i", async () => {
    expect((await GET(req(""), params(customerId))).status).toBe(400);
    expect((await GET(req("?i=,,"), params(customerId))).status).toBe(400);
  });

  it("400 com 201 ids", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id${i}`).join(",");
    expect((await GET(req(`?i=${ids}`), params(customerId))).status).toBe(400);
  });

  it("400 quando nenhuma parcela é do cliente", async () => {
    expect((await GET(req("?i=lixo"), params(customerId))).status).toBe(400);
  });

  it("404 quando o cliente é de outro workspace", async () => {
    const other = await createWorkspace("Outra");
    const foreign = await testDb.customer.create({ data: { name: "Fora", workspaceId: other.id } });
    const sale = await seedParceledSale({ workspaceId: other.id, customerId: foreign.id, parcels: [{ amountCents: 700, dueDate: null }] });
    const res = await GET(req(`?i=${sale.installments[0].id}`), params(foreign.id));
    expect(res.status).toBe(404);
  });

  it("404 quando o cliente não existe", async () => {
    expect((await GET(req(`?i=${installmentIds[0]}`), params("nao-existe"))).status).toBe(404);
  });

  it("requisição abortada não renderiza", async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await GET(req(`?i=${installmentIds[0]}`, { signal: controller.signal }), params(customerId));
    expect(res.status).toBe(499);
    expect(res.headers.get("content-type")).not.toBe("image/png");
  });

  it("200 image/png no-store com o total em centavos no header", async () => {
    const res = await GET(req(`?i=${installmentIds.join(",")}`), params(customerId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-charge-total-cents")).toBe("2734");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  });
});
