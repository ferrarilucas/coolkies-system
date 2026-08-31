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
    await expect(asaasFetch("/subscriptions")).rejects.toThrow(
      "ASAAS_API_KEY não configurada",
    );
  });
});
