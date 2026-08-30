import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

let canWriteResult = true;
vi.mock("./subscription", () => ({
  canWriteInWorkspace: async () => canWriteResult,
}));

const { assertCanWrite } = await import("./context");

describe("assertCanWrite", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedActiveMembership() {
    const user = await testDb.user.create({
      data: { id: "u-assert", name: "Dono", email: "assert@example.com" },
    });
    const ws = await testDb.workspace.create({
      data: { name: "WS", slug: "ws-assert" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });
    sessionResult = {
      user: { id: user.id },
      session: { id: "s-assert", activeWorkspaceId: ws.id },
    };
  }

  it("lança quando o contexto não permite escrita", async () => {
    await seedActiveMembership();
    canWriteResult = false;

    await expect(assertCanWrite()).rejects.toThrow(
      "Este workspace está em modo somente leitura. Ative um plano para voltar a registrar.",
    );
  });

  it("passa quando o contexto permite escrita", async () => {
    await seedActiveMembership();
    canWriteResult = true;

    await expect(assertCanWrite()).resolves.toBeUndefined();
  });
});
