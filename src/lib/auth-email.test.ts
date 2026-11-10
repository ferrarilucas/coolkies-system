import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";

let requestHeaders: Headers;
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const sent = vi.hoisted(() => ({
  verification: [] as string[],
  reset: [] as string[],
  result: { sent: true } as { sent: boolean; reason?: string },
}));

vi.mock("./email", () => ({
  EMAIL_NOT_CONFIGURED: "Envio de e-mail não configurado.",
  sendVerificationEmail: async ({ url }: { url: string }) => {
    sent.verification.push(url);
    return sent.result;
  },
  sendPasswordResetEmail: async ({ url }: { url: string }) => {
    sent.reset.push(url);
    return sent.result;
  },
}));

const { auth } = await import("./auth");
const { switchWorkspace } = await import("@/server/actions/workspaces");
const { getWorkspaceContext } = await import("@/server/tenant/context");

const email = "ana@example.com";
const password = "senha-segura-1";

async function signUp() {
  return auth.api.signUpEmail({ body: { name: "Ana", email, password } });
}

function tokenFromVerification(url: string): string {
  return new URL(url).searchParams.get("token") as string;
}

function tokenFromReset(url: string): string {
  return new URL(url).pathname.split("/").pop() as string;
}

it("lê o workspace selecionado na sessão autenticada e respeita os vínculos", async () => {
  await resetDb();
  await signUp();
  const user = await testDb.user.update({ where: { email }, data: { emailVerified: true } });
  const first = await createWorkspace("Primeiro");
  const second = await createWorkspace("Segundo");
  const outside = await createWorkspace("Sem acesso");
  await testDb.member.createMany({
    data: [
      { userId: user.id, workspaceId: first.id, role: "OWNER", createdAt: new Date(0) },
      { userId: user.id, workspaceId: second.id, role: "MEMBER" },
    ],
  });
  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  requestHeaders = new Headers({
    cookie: headers.getSetCookie().map((value) => value.split(";")[0]).join("; "),
  });

  await expect(getWorkspaceContext()).resolves.toMatchObject({ workspaceId: first.id });
  await expect(switchWorkspace(second.id)).resolves.toEqual({ ok: true });
  await expect(getWorkspaceContext()).resolves.toMatchObject({ workspaceId: second.id, role: "MEMBER" });
  await expect(switchWorkspace(outside.id)).resolves.toEqual({
    ok: false,
    error: "Você não participa deste workspace.",
  });
  await expect(getWorkspaceContext()).resolves.toMatchObject({ workspaceId: second.id });
  await expect(switchWorkspace(first.id)).resolves.toEqual({ ok: true });
  await expect(getWorkspaceContext()).resolves.toMatchObject({ workspaceId: first.id });
  await expect(switchWorkspace(second.id)).resolves.toEqual({ ok: true });
  await testDb.member.deleteMany({ where: { userId: user.id, workspaceId: second.id } });
  await expect(getWorkspaceContext()).resolves.toMatchObject({ workspaceId: first.id });
});

describe("verificação de e-mail", () => {
  beforeEach(async () => {
    await resetDb();
    sent.verification.length = 0;
    sent.reset.length = 0;
    sent.result = { sent: true };
  });

  it("cadastro envia o link e não abre sessão", async () => {
    const res = await signUp();
    expect(res.token).toBeNull();
    expect(sent.verification).toHaveLength(1);
    expect(sent.verification[0]).toContain("/api/auth/verify-email?token=");
  });

  it("login antes de confirmar é recusado com EMAIL_NOT_VERIFIED", async () => {
    await signUp();
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject({
      body: { code: "EMAIL_NOT_VERIFIED" },
    });
  });

  it("depois de confirmar, o login funciona", async () => {
    await signUp();
    await auth.api.verifyEmail({ query: { token: tokenFromVerification(sent.verification[0]) } });
    const res = await auth.api.signInEmail({ body: { email, password } });
    expect(res.token).toBeTruthy();
  });
});

describe("redefinição de senha", () => {
  beforeEach(async () => {
    await resetDb();
    sent.verification.length = 0;
    sent.reset.length = 0;
    sent.result = { sent: true };
    await signUp();
    await testDb.user.update({ where: { email }, data: { emailVerified: true } });
  });

  it("pedido envia o link de redefinição", async () => {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
    });
    expect(sent.reset).toHaveLength(1);
    expect(sent.reset[0]).toContain("/api/auth/reset-password/");
  });

  it("redirectTo relativo passa pela checagem de origem e volta para o app", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email, redirectTo: "/reset-password" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(sent.reset).toHaveLength(1);

    const link = await auth.handler(new Request(sent.reset[0]));
    const location = new URL(link.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe("http://localhost:3000/reset-password");
    expect(location.searchParams.get("token")).toBe(tokenFromReset(sent.reset[0]));
  });

  it("pedido para e-mail inexistente não envia nada e não revela nada", async () => {
    await auth.api.requestPasswordReset({
      body: { email: "ninguem@example.com", redirectTo: "http://localhost:3000/reset-password" },
    });
    expect(sent.reset).toHaveLength(0);
  });

  it("troca a senha, derruba as sessões antigas e o token não serve duas vezes", async () => {
    await auth.api.signInEmail({ body: { email, password } });
    const user = await testDb.user.findUniqueOrThrow({ where: { email } });
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(1);

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
    });
    const token = tokenFromReset(sent.reset[0]);

    await auth.api.resetPassword({ body: { newPassword: "outra-senha-2", token } });

    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toBeTruthy();
    const ok = await auth.api.signInEmail({ body: { email, password: "outra-senha-2" } });
    expect(ok.token).toBeTruthy();

    await expect(
      auth.api.resetPassword({ body: { newPassword: "terceira-senha-3", token } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } });

    await expect(auth.api.signInEmail({ body: { email, password: "outra-senha-2" } })).resolves.toMatchObject({
      token: expect.any(String),
    });
    await expect(
      auth.api.signInEmail({ body: { email, password: "terceira-senha-3" } }),
    ).rejects.toBeTruthy();
  });

  it("token expirado é recusado e a senha original continua valendo", async () => {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
    });
    const token = tokenFromReset(sent.reset[0]);

    await testDb.verification.updateMany({
      where: { identifier: `reset-password:${token}` },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      auth.api.resetPassword({ body: { newPassword: "outra-senha-2", token } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } });

    const ok = await auth.api.signInEmail({ body: { email, password } });
    expect(ok.token).toBeTruthy();
  });
});

describe("falha no envio dos e-mails de autenticação", () => {
  beforeEach(async () => {
    await resetDb();
    sent.verification.length = 0;
    sent.reset.length = 0;
    sent.result = { sent: true };
  });

  function loggedText(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
  }

  it("registra o motivo quando a verificação não sai, sem o link", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sent.result = { sent: false, reason: "Resend fora do ar" };

    await signUp();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith("auth: e-mail de verificação não enviado", "Resend fora do ar"));

    const token = tokenFromVerification(sent.verification[0]);
    expect(loggedText(errorSpy)).not.toContain(token);
    errorSpy.mockRestore();
  });

  it("registra o motivo quando a redefinição não sai, sem o link", async () => {
    await signUp();
    await testDb.user.update({ where: { email }, data: { emailVerified: true } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sent.result = { sent: false, reason: "Resend fora do ar" };

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
    });
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("auth: e-mail de redefinição de senha não enviado", "Resend fora do ar"),
    );

    const token = tokenFromReset(sent.reset[0]);
    expect(loggedText(errorSpy)).not.toContain(token);
    errorSpy.mockRestore();
  });

  it("sem RESEND_API_KEY não registra erro, porque o link já sai no console de dev", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sent.result = { sent: false, reason: "Envio de e-mail não configurado." };

    await signUp();
    await vi.waitFor(() => expect(sent.verification).toHaveLength(1));

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
