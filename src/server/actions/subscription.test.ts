import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { subscribe, resumeCheckout } = await import("./subscription");

async function userWithWorkspace(id: string, email: string) {
  const user = await testDb.user.create({ data: { id, name: "Dona", email } });
  const ws = await testDb.workspace.create({
    data: { name: "WS", slug: `ws-${id}` },
  });
  await testDb.member.create({
    data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
  });
  sessionResult = {
    user: { id: user.id },
    session: { id: `s-${id}`, activeWorkspaceId: ws.id },
  };
  return { user, ws };
}

function stubInterPixFetch() {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          id: "ipx-novo",
          status: "PENDING_AUTH",
          externalUserId: "usr",
          planCode: "corre",
          amount: "34.50",
          nextDueDate: "2026-09-20",
          authorization: { pixCopyPaste: "00020126-copia-e-cola", url: "https://qr.test/1" },
        }),
        { status: 201 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubInterPixFetchWithCancel() {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/cancel")) {
      return new Response(null, { status: 200 });
    }
    return new Response(
      JSON.stringify({
        id: "ipx-novo",
        status: "PENDING_AUTH",
        externalUserId: "usr",
        planCode: "corre",
        amount: "34.50",
        nextDueDate: "2026-09-20",
        authorization: { pixCopyPaste: "00020126-copia-e-cola", url: "https://qr.test/1" },
      }),
      { status: 201 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubInterPixFetchWithoutCopyPaste() {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          id: "ipx-sem-copia",
          status: "PENDING_AUTH",
          externalUserId: "usr",
          planCode: "corre",
          amount: "34.50",
          nextDueDate: "2026-09-20",
        }),
        { status: 201 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubInterPixFetchWithValidationError() {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ code: "BAD_REQUEST", message: "CPF inválido para a InterPix" }),
        { status: 400 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubInterPixFetchWithFailingCancel() {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/cancel")) {
      return new Response(
        JSON.stringify({ code: "INTERNAL_ERROR", message: "falha ao cancelar" }),
        { status: 500 },
      );
    }
    return new Response(
      JSON.stringify({
        id: "ipx-novo",
        status: "PENDING_AUTH",
        externalUserId: "usr",
        planCode: "corre",
        amount: "34.50",
        nextDueDate: "2026-09-20",
        authorization: { pixCopyPaste: "00020126-copia-e-cola", url: "https://qr.test/1" },
      }),
      { status: 201 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("subscribe", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("INTERPIX_API_URL", "https://interpix.test");
    vi.stubEnv("INTERPIX_API_TOKEN", "token-de-teste-com-24-chars");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("cria a assinatura, grava o mapeamento e devolve o copia-e-cola", async () => {
    const { user } = await userWithWorkspace("u-sub", "sub@example.com");
    stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "123.456.789-09");

    const result = await subscribe(formData);
    expect(result.ok).toBe(true);
    expect(result.data?.pixCopyPaste).toBe("00020126-copia-e-cola");

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.interpixSubscriptionId).toBe("ipx-novo");
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.provider).toBe("INTERPIX");
  });

  it("manda o valor do Pix, não o do cartão", async () => {
    await userWithWorkspace("u-valor", "valor@example.com");
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");
    await subscribe(formData);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).amount).toBe("34.50");
  });

  it("plano anual manda os doze meses numa cobrança só", async () => {
    await userWithWorkspace("u-anual", "anual@example.com");
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "YEARLY");
    formData.set("cpfCnpj", "12345678909");
    await subscribe(formData);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.amount).toBe("294.00");
    expect(body.intervalMonths).toBe(12);
  });

  it("manda o CPF sem máscara", async () => {
    await userWithWorkspace("u-doc", "doc@example.com");
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "123.456.789-09");
    await subscribe(formData);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).debtor.taxId).toBe(
      "12345678909",
    );
  });

  it("recusa assinatura atribuída manualmente, sem chamar a InterPix", async () => {
    const { user } = await userWithWorkspace("u-manual", "manual@example.com");
    await testDb.subscription.create({
      data: { userId: user.id, plan: "escala", provider: "MANUAL", status: "ACTIVE" },
    });
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa troca de plano de assinante com mandato ativo, sem chamar a InterPix", async () => {
    const { user } = await userWithWorkspace("u-ativo", "ativo@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        cycle: "MONTHLY",
        provider: "INTERPIX",
        status: "ACTIVE",
        interpixSubscriptionId: "ipx-ativo",
        interpixPixCopyPaste: "00020126-antigo",
      },
    });
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "cresce");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.interpixSubscriptionId).toBe("ipx-ativo");
    expect(sub?.plan).toBe("corre");
  });

  it("recusa troca de plano de assinante com atraso (PAST_DUE), sem chamar a InterPix", async () => {
    const { user } = await userWithWorkspace("u-atraso", "atraso@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        cycle: "MONTHLY",
        provider: "INTERPIX",
        status: "PAST_DUE",
        interpixSubscriptionId: "ipx-atraso",
        interpixPixCopyPaste: "00020126-antigo",
      },
    });
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "cresce");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancela o mandato pendente antigo antes de criar um novo ao trocar de plano", async () => {
    const { user } = await userWithWorkspace("u-troca", "troca@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        cycle: "MONTHLY",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        interpixSubscriptionId: "ipx-antigo",
        interpixPixCopyPaste: "00020126-antigo",
      },
    });
    const fetchMock = stubInterPixFetchWithCancel();

    const formData = new FormData();
    formData.set("plan", "cresce");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(true);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/subscriptions/ipx-antigo/cancel");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/subscriptions");
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("/cancel");

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.interpixSubscriptionId).toBe("ipx-novo");
    expect(sub?.plan).toBe("cresce");
  });

  it("não cria assinatura nova se o cancelamento do mandato antigo falhar", async () => {
    const { user } = await userWithWorkspace("u-falha-cancela", "falhacancela@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        cycle: "MONTHLY",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        interpixSubscriptionId: "ipx-antigo",
        interpixPixCopyPaste: "00020126-antigo",
      },
    });
    const fetchMock = stubInterPixFetchWithFailingCancel();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const formData = new FormData();
    formData.set("plan", "cresce");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(errorSpy).toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.interpixSubscriptionId).toBe("ipx-antigo");
    expect(sub?.plan).toBe("corre");

    errorSpy.mockRestore();
  });

  it("resumeCheckout devolve o copia-e-cola guardado, sem criar outra assinatura", async () => {
    const { user } = await userWithWorkspace("u-resume", "resume@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        interpixSubscriptionId: "ipx-existente",
        interpixPixCopyPaste: "00020126-guardado",
        currentPeriodEnd: new Date("2026-09-20"),
      },
    });
    const fetchMock = stubInterPixFetch();

    const result = await resumeCheckout();
    expect(result.ok).toBe(true);
    expect(result.data?.pixCopyPaste).toBe("00020126-guardado");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resumeCheckout sem autorização pendente devolve erro", async () => {
    await userWithWorkspace("u-resume-sem-pendencia", "resumesempendencia@example.com");
    const fetchMock = stubInterPixFetch();

    const result = await resumeCheckout();
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa plano de atendimento (escala), sem chamar a InterPix", async () => {
    await userWithWorkspace("u-escala", "escala@example.com");
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "escala");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa CPF/CNPJ inválido, sem chamar a InterPix", async () => {
    await userWithWorkspace("u-cpf-invalido", "cpfinvalido@example.com");
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "123");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa plano desconhecido, sem chamar a InterPix", async () => {
    await userWithWorkspace("u-plano-desconhecido", "planodesconhecido@example.com");
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "inexistente");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa ciclo de cobrança inválido, sem chamar a InterPix", async () => {
    await userWithWorkspace("u-ciclo-invalido", "cicloinvalido@example.com");
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "SEMANAL");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("assinante em teste, sem id de assinatura, consegue contratar o mesmo plano do teste", async () => {
    const { user } = await userWithWorkspace("u-trial-mesmo-plano", "trialmesmoplano@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        cycle: "MONTHLY",
        provider: "INTERPIX",
        status: "TRIALING",
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("recusa novo pedido do mesmo plano quando já há mandato pendente com copia-e-cola, sem chamar a InterPix", async () => {
    const { user } = await userWithWorkspace("u-pendente-copia", "pendentecopia@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        cycle: "MONTHLY",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        interpixSubscriptionId: "ipx-pendente",
        interpixPixCopyPaste: "00020126-pendente",
      },
    });
    const fetchMock = stubInterPixFetch();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.interpixSubscriptionId).toBe("ipx-pendente");
  });

  it("autorização negada no mesmo plano não é recusada: cancela o mandato antigo e cria um novo", async () => {
    const { user } = await userWithWorkspace("u-auth-negada", "authnegada@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        cycle: "MONTHLY",
        provider: "INTERPIX",
        status: "AUTH_DENIED",
        interpixSubscriptionId: "ipx-negado",
        interpixPixCopyPaste: "00020126-negado",
      },
    });
    const fetchMock = stubInterPixFetchWithCancel();

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/subscriptions/ipx-negado/cancel");

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.interpixSubscriptionId).toBe("ipx-novo");
  });

  it("quando a InterPix não devolve o copia-e-cola, grava o mapeamento e loga o erro", async () => {
    const { user } = await userWithWorkspace("u-sem-copia", "semcopia@example.com");
    const fetchMock = stubInterPixFetchWithoutCopyPaste();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.interpixSubscriptionId).toBe("ipx-sem-copia");
    expect(sub?.status).toBe("PENDING_AUTH");

    errorSpy.mockRestore();
  });

  it("repassa a mensagem de validação da InterPix ao usuário", async () => {
    await userWithWorkspace("u-validacao-gateway", "validacaogateway@example.com");
    stubInterPixFetchWithValidationError();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CPF inválido para a InterPix");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("erro de configuração não vaza para o cliente e é logado", async () => {
    await userWithWorkspace("u-infra", "infra@example.com");
    vi.stubEnv("INTERPIX_API_TOKEN", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const formData = new FormData();
    formData.set("plan", "corre");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("INTERPIX_API_TOKEN");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
