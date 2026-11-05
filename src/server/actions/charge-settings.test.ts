import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import { DEFAULT_CHARGE_TEMPLATE } from "@/lib/charge-message";
import * as chargeSettingsStore from "@/server/tenant/charge-settings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Role = "OWNER" | "ADMIN" | "MEMBER";
const context: { workspaceId: string; userId: string; role: Role; canWrite: boolean } = {
  workspaceId: "",
  userId: "u-dona",
  role: "OWNER",
  canWrite: true,
};

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceContext: async () => ({ ...context }),
  requireRole: async (...allowed: Role[]) => {
    if (!allowed.includes(context.role)) throw new Error("Não autorizado");
    return { ...context };
  },
  writeBlocked: async () => (context.canWrite ? null : { ok: false, error: "Somente leitura" }),
}));

const { updateChargeSettings } = await import("./charge-settings");

function readSettings() {
  return chargeSettingsStore.getChargeSettings(context.workspaceId);
}

function fd(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const complete = {
  template: "Oi {nome}",
  sendImage: "on",
  pixKeyType: "CPF",
  pixKey: "529.982.247-25",
  pixRecipientName: " Loja ",
  pixCity: "Curitiba",
};

describe("configuração de cobrança", () => {
  beforeEach(async () => {
    await resetDb();
    context.workspaceId = (await createWorkspace("Loja")).id;
    context.role = "OWNER";
    context.canWrite = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("padrões de um workspace novo", async () => {
    expect(await readSettings()).toEqual({
      workspaceName: "Loja",
      template: null,
      sendImage: true,
      pixKeyType: null,
      pixKey: null,
      pixRecipientName: null,
      pixCity: null,
    });
  });

  it("OWNER salva tudo normalizado", async () => {
    expect(await updateChargeSettings(fd(complete))).toEqual({ ok: true });
    expect(await readSettings()).toMatchObject({
      template: "Oi {nome}",
      sendImage: true,
      pixKeyType: "CPF",
      pixKey: "52998224725",
      pixRecipientName: "Loja",
      pixCity: "Curitiba",
    });
  });

  it("ADMIN também salva", async () => {
    context.role = "ADMIN";
    expect(await updateChargeSettings(fd(complete))).toEqual({ ok: true });
  });

  it("sendImage ausente grava false", async () => {
    const { sendImage: _ignored, ...rest } = complete;
    await updateChargeSettings(fd(rest));
    expect((await readSettings()).sendImage).toBe(false);
  });

  it("sendImage alterna on, ausente, on", async () => {
    const { sendImage: _ignored, ...rest } = complete;
    await updateChargeSettings(fd(complete));
    expect((await readSettings()).sendImage).toBe(true);
    await updateChargeSettings(fd(rest));
    expect((await readSettings()).sendImage).toBe(false);
    await updateChargeSettings(fd(complete));
    expect((await readSettings()).sendImage).toBe(true);
  });

  it("falha inesperada ao salvar não vaza a mensagem crua", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("Invalid `prisma.workspace.update()`");
    vi.spyOn(chargeSettingsStore, "saveChargeSettings").mockRejectedValue(failure);
    expect(await updateChargeSettings(fd(complete))).toEqual({ ok: false, error: "Algo deu errado." });
    expect(consoleError).toHaveBeenCalledWith("[charge-settings] falha ao salvar", failure);
  });

  it("template igual ao padrão ou vazio grava null", async () => {
    await updateChargeSettings(fd({ ...complete, template: DEFAULT_CHARGE_TEMPLATE }));
    expect((await readSettings()).template).toBeNull();
    await updateChargeSettings(fd({ ...complete, template: "Outro" }));
    await updateChargeSettings(fd({ ...complete, template: "   " }));
    expect((await readSettings()).template).toBeNull();
  });

  it("template com quebras de linha do navegador vira \\n", async () => {
    await updateChargeSettings(fd({ ...complete, template: "a\r\nb" }));
    expect((await readSettings()).template).toBe("a\nb");
  });

  it("MEMBER é recusado", async () => {
    context.role = "MEMBER";
    expect(await updateChargeSettings(fd(complete))).toEqual({ ok: false, error: "Não autorizado" });
  });

  it("somente leitura é recusado", async () => {
    context.canWrite = false;
    expect(await updateChargeSettings(fd(complete))).toEqual({ ok: false, error: "Somente leitura" });
    expect((await readSettings()).pixKey).toBeNull();
  });

  it("chave inválida é recusada e nada muda", async () => {
    expect(await updateChargeSettings(fd({ ...complete, pixKey: "111" }))).toEqual({
      ok: false,
      error: "Chave Pix inválida para CPF.",
    });
    expect((await readSettings()).template).toBeNull();
  });

  it("chave sem tipo é recusada", async () => {
    expect(await updateChargeSettings(fd({ ...complete, pixKeyType: "" }))).toEqual({
      ok: false,
      error: "Escolha o tipo da chave Pix.",
    });
  });

  it("tipo adulterado é recusado", async () => {
    expect((await updateChargeSettings(fd({ ...complete, pixKeyType: "BOLETO" }))).ok).toBe(false);
  });

  it("limites de tamanho", async () => {
    expect(await updateChargeSettings(fd({ ...complete, template: "a".repeat(1001) }))).toEqual({
      ok: false,
      error: "A mensagem pode ter até 1000 caracteres.",
    });
    expect(await updateChargeSettings(fd({ ...complete, pixRecipientName: "a".repeat(26) }))).toEqual({
      ok: false,
      error: "O nome pode ter até 25 caracteres.",
    });
    expect(await updateChargeSettings(fd({ ...complete, pixCity: "a".repeat(16) }))).toEqual({
      ok: false,
      error: "A cidade pode ter até 15 caracteres.",
    });
  });

  it("chave vazia limpa tipo e chave", async () => {
    await updateChargeSettings(fd(complete));
    await updateChargeSettings(fd({ ...complete, pixKey: "  ", pixKeyType: "CPF" }));
    expect(await readSettings()).toMatchObject({ pixKey: null, pixKeyType: null });
  });

  it("não altera outro workspace", async () => {
    const other = await createWorkspace("Outra");
    await updateChargeSettings(fd(complete));
    const row = await testDb.workspace.findUnique({ where: { id: other.id } });
    expect(row?.pixKey).toBeNull();
  });
});
