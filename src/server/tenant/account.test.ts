import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { TERMS_VERSION } from "@/lib/legal";
import { acceptCurrentTerms, hasAcceptedCurrentTerms } from "./account";

describe("aceite dos termos", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("conta nova ainda não aceitou", async () => {
    await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    expect(await hasAcceptedCurrentTerms("u1")).toBe(false);
  });

  it("aceitar grava a versão e a data", async () => {
    await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const now = new Date("2026-09-27T15:00:00Z");
    await acceptCurrentTerms("u1", now);
    const user = await testDb.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.termsVersion).toBe(TERMS_VERSION);
    expect(user.termsAcceptedAt).toEqual(now);
    expect(await hasAcceptedCurrentTerms("u1")).toBe(true);
  });

  it("aceite de versão antiga não vale", async () => {
    await testDb.user.create({
      data: { id: "u1", name: "Ana", email: "ana@example.com", termsVersion: "2020-01-01" },
    });
    expect(await hasAcceptedCurrentTerms("u1")).toBe(false);
  });
});
