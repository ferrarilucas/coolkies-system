import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { createSale } = await import("./sales");

describe("createSale bloqueada por assinatura inutilizável", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("recusa a chamada e não grava nada no banco", async () => {
    const user = await testDb.user.create({
      data: { id: "u-lock", name: "Dono sem plano", email: "lock@example.com" },
    });
    const ws = await testDb.workspace.create({
      data: { name: "Padaria", slug: "padaria-lock" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });

    sessionResult = {
      user: { id: user.id },
      session: { id: "s-lock", activeWorkspaceId: ws.id },
    };

    const formData = new FormData();
    formData.set(
      "items",
      JSON.stringify([
        {
          productId: "p1",
          productName: "Cookie",
          flavorId: null,
          flavorName: null,
          quantity: 1,
          unitPriceCents: 500,
        },
      ]),
    );

    await expect(createSale(formData)).rejects.toThrow(
      "Este workspace está em modo somente leitura. Ative um plano para voltar a registrar.",
    );

    const saleCount = await testDb.sale.count({ where: { workspaceId: ws.id } });
    expect(saleCount).toBe(0);
  });
});
