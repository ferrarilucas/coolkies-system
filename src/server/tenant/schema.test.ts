import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";

describe("schema multi-tenant", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria produto vinculado a um workspace", async () => {
    const ws = await createWorkspace("Douce Vie");
    const product = await testDb.product.create({
      data: { name: "Cookie", workspaceId: ws.id },
    });
    expect(product.workspaceId).toBe(ws.id);
  });
});
