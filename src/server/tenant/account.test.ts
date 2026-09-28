import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import { TERMS_VERSION } from "@/lib/legal";
import {
  acceptCurrentTerms,
  buildPersonalDataExport,
  getAcceptedTermsVersion,
  hasAcceptedCurrentTerms,
} from "./account";

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

describe("versão dos termos aceita", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("conta nova não tem versão aceita", async () => {
    await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    expect(await getAcceptedTermsVersion("u1")).toBeNull();
  });

  it("devolve a versão gravada, mesmo antiga", async () => {
    await testDb.user.create({
      data: { id: "u1", name: "Ana", email: "ana@example.com", termsVersion: "2020-01-01" },
    });
    expect(await getAcceptedTermsVersion("u1")).toBe("2020-01-01");
  });
});

describe("exportação de dados pessoais", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reúne perfil, formas de login, workspaces e assinatura", async () => {
    await testDb.user.create({
      data: { id: "u1", name: "Ana", email: "ana@example.com", cpf: "12345678909", termsVersion: TERMS_VERSION },
    });
    await testDb.account.create({
      data: { id: "a1", accountId: "g-1", providerId: "google", userId: "u1" },
    });
    const ws = await createWorkspace("Loja");
    await testDb.member.create({ data: { userId: "u1", workspaceId: ws.id, role: "OWNER" } });
    await testDb.subscription.create({ data: { userId: "u1", plan: "cresce", status: "ACTIVE" } });

    const data = await buildPersonalDataExport("u1", new Date("2026-09-27T12:00:00Z"));

    expect(data.exportedAt).toBe("2026-09-27T12:00:00.000Z");
    expect(data.user).toMatchObject({ name: "Ana", email: "ana@example.com", cpf: "12345678909" });
    expect(data.loginMethods).toEqual(["google"]);
    expect(data.workspaces).toEqual([expect.objectContaining({ name: "Loja", role: "OWNER" })]);
    expect(data.subscription).toMatchObject({ plan: "cresce", status: "ACTIVE" });
    expect(JSON.stringify(data)).not.toContain("password");
  });
});
