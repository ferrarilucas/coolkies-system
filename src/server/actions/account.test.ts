import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => sessionResult } } }));

const { deleteAccount } = await import("./account");

describe("deleteAccount", () => {
  beforeEach(async () => {
    await resetDb();
    await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    sessionResult = { user: { id: "u1" }, session: { id: "s1" } };
  });

  it("recusa quando o e-mail digitado não confere", async () => {
    const res = await deleteAccount("outra@example.com");
    expect(res).toEqual({ ok: false, error: "Digite o e-mail da sua conta para confirmar." });
    expect(await testDb.user.findUnique({ where: { id: "u1" } })).not.toBeNull();
  });

  it("aceita o e-mail com espaços e maiúsculas e exclui", async () => {
    const res = await deleteAccount("  ANA@example.com ");
    expect(res.ok).toBe(true);
    expect(await testDb.user.findUnique({ where: { id: "u1" } })).toBeNull();
  });
});
