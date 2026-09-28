import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { GET } = await import("./route");

describe("GET /account/export", () => {
  beforeEach(async () => {
    await resetDb();
    sessionResult = null;
  });

  it("sem sessão responde 401", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("quem ainda não aceitou os termos atuais consegue baixar os dados", async () => {
    await testDb.user.create({
      data: { id: "u1", name: "Ana", email: "ana@example.com", termsVersion: "2020-01-01" },
    });
    sessionResult = { user: { id: "u1" } };

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const body = await res.json();
    expect(body.user.email).toBe("ana@example.com");
  });
});
