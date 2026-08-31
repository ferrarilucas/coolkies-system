import { afterEach, describe, expect, it, vi } from "vitest";
import { asaasFetch, brlFromCents } from "./asaas";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cliente asaas", () => {
  it("converte centavos para o decimal que a API espera", () => {
    expect(brlFromCents(2990)).toBe(29.9);
    expect(brlFromCents(9990)).toBe(99.9);
    expect(brlFromCents(100)).toBe(1);
  });

  it("envia a chave no header access_token", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "sandbox");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "sub_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await asaasFetch("/subscriptions");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).access_token).toBe("chave-de-teste");
  });

  it("lanca com a mensagem da API quando a resposta falha", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "sandbox");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ errors: [{ description: "Cliente inválido" }] }),
          { status: 400 },
        ),
      ),
    );

    await expect(asaasFetch("/subscriptions")).rejects.toThrow("Cliente inválido");
  });

  it("lanca quando a chave nao esta configurada", async () => {
    vi.stubEnv("ASAAS_API_KEY", "");
    vi.stubEnv("ASAAS_ENV", "sandbox");
    await expect(asaasFetch("/subscriptions")).rejects.toThrow(
      "ASAAS_API_KEY não configurada",
    );
  });
});

describe("ambiente do asaas", () => {
  function fetchMock() {
    const mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "sub_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("production aponta para a api de producao", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "production");
    const mock = fetchMock();

    await asaasFetch("/subscriptions");

    expect(String(mock.mock.calls[0][0])).toBe("https://api.asaas.com/v3/subscriptions");
  });

  it("sandbox aponta para a api de sandbox", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "sandbox");
    const mock = fetchMock();

    await asaasFetch("/subscriptions");

    expect(String(mock.mock.calls[0][0])).toBe(
      "https://api-sandbox.asaas.com/v3/subscriptions",
    );
  });

  it("variavel ausente nao cai em sandbox: lanca erro", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", undefined);
    const mock = fetchMock();

    await expect(asaasFetch("/subscriptions")).rejects.toThrow("ASAAS_ENV");
    expect(mock).not.toHaveBeenCalled();
  });

  it("valor com typo nao cai em sandbox: lanca erro citando o valor recebido", async () => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "producao");
    const mock = fetchMock();

    await expect(asaasFetch("/subscriptions")).rejects.toThrow('"producao"');
    expect(mock).not.toHaveBeenCalled();
  });
});
