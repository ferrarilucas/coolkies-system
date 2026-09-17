import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";

describe("schema multi-tenant", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria item vinculado a um workspace", async () => {
    const ws = await createWorkspace("Douce Vie");
    const item = await testDb.item.create({
      data: { name: "Cookie", workspaceId: ws.id },
    });
    expect(item.workspaceId).toBe(ws.id);
  });
});
