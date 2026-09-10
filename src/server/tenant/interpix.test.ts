import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amountFromCents,
  cancelInterPixSubscription,
  createInterPixSubscription,
  InterPixApiError,
} from "./interpix";

beforeEach(() => {
  vi.stubEnv("INTERPIX_API_URL", "https://interpix.test");
  vi.stubEnv("INTERPIX_API_TOKEN", "token-de-teste-com-24-chars");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("amountFromCents", () => {
  it("sempre usa duas casas, que é o que a API aceita", () => {
    expect(amountFromCents(2990)).toBe("29.90");
    expect(amountFromCents(3450)).toBe("34.50");
    expect(amountFromCents(29400)).toBe("294.00");
    expect(amountFromCents(101880)).toBe("1018.80");
    expect(amountFromCents(100)).toBe("1.00");
  });

  it("nunca produz uma casa só", () => {
    expect(amountFromCents(2990)).not.toBe("29.9");
  });
});

describe("createInterPixSubscription", () => {
  it("manda o token no Authorization e devolve o copia-e-cola", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: "sub-1",
            status: "PENDING_AUTH",
            externalUserId: "usr_1",
            planCode: "corre",
            amount: "34.50",
            nextDueDate: "2026-09-20",
            authorization: { pixCopyPaste: "00020126...", url: "https://qr.test/1" },
          }),
          { status: 201, headers: { "X-Request-Id": "req-1" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createInterPixSubscription({
      externalUserId: "usr_1",
      planCode: "corre",
      amountCents: 3450,
      intervalMonths: 1,
      firstDueDate: "2026-09-20",
      debtor: { taxId: "12345678901", name: "Fulano de Tal" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://interpix.test/subscriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-de-teste-com-24-chars",
    );
    expect(JSON.parse(init.body as string).amount).toBe("34.50");
    expect(result.authorization?.pixCopyPaste).toBe("00020126...");
  });

  it("expõe o code do erro, não a mensagem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ code: "BAD_REQUEST", message: "Payload invalido.", details: [] }),
            { status: 400 },
          ),
      ),
    );

    await expect(
      createInterPixSubscription({
        externalUserId: "usr_1",
        planCode: "corre",
        amountCents: 3450,
        intervalMonths: 1,
        firstDueDate: "2026-09-20",
        debtor: { taxId: "123", name: "X" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lança quando a configuração está ausente, sem cair em padrão silencioso", async () => {
    vi.stubEnv("INTERPIX_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createInterPixSubscription({
        externalUserId: "usr_1",
        planCode: "corre",
        amountCents: 3450,
        intervalMonths: 1,
        firstDueDate: "2026-09-20",
        debtor: { taxId: "12345678901", name: "X" },
      }),
    ).rejects.toThrow("INTERPIX_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resposta com corpo que não é JSON", () => {
  it("status 200 com corpo inválido lança InterPixApiError com code INTERNAL_ERROR e o requestId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response("não é json", { status: 200, headers: { "X-Request-Id": "req-200" } }),
      ),
    );

    const error = await createInterPixSubscription({
      externalUserId: "usr_1",
      planCode: "corre",
      amountCents: 3450,
      intervalMonths: 1,
      firstDueDate: "2026-09-20",
      debtor: { taxId: "12345678901", name: "Fulano de Tal" },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(InterPixApiError);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.requestId).toBe("req-200");
  });

  it("status 502 com página HTML lança InterPixApiError sem deixar o SyntaxError escapar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response("<html><body>Bad Gateway</body></html>", {
            status: 502,
            headers: { "X-Request-Id": "req-502" },
          }),
      ),
    );

    const error = await createInterPixSubscription({
      externalUserId: "usr_1",
      planCode: "corre",
      amountCents: 3450,
      intervalMonths: 1,
      firstDueDate: "2026-09-20",
      debtor: { taxId: "12345678901", name: "Fulano de Tal" },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(InterPixApiError);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.requestId).toBe("req-502");
  });

  it("registra o X-Request-Id mesmo quando o corpo não é JSON", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response("<html><body>Bad Gateway</body></html>", {
            status: 502,
            headers: { "X-Request-Id": "req-502" },
          }),
      ),
    );

    await createInterPixSubscription({
      externalUserId: "usr_1",
      planCode: "corre",
      amountCents: 3450,
      intervalMonths: 1,
      firstDueDate: "2026-09-20",
      debtor: { taxId: "12345678901", name: "Fulano de Tal" },
    }).catch(() => undefined);

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "interpix",
      "/subscriptions",
      502,
      "req-502",
    );
    consoleInfoSpy.mockRestore();
  });
});

describe("cancelInterPixSubscription", () => {
  it("trata 409 INVALID_TRANSITION como sucesso, porque cancelar não é idempotente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ code: "INVALID_TRANSITION", message: "..." }), {
            status: 409,
          }),
      ),
    );

    await expect(cancelInterPixSubscription("sub-1")).resolves.toEqual({ pendingCycle: null });
  });

  it("outros erros continuam sendo erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
      ),
    );

    await expect(cancelInterPixSubscription("sub-1")).rejects.toBeInstanceOf(InterPixApiError);
  });

  it("devolve o pendingCycle quando o cancelamento reporta uma cobrança já a caminho", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ pendingCycle: { cycleSeq: 3, dueDate: "2026-09-15" } }),
            { status: 200 },
          ),
      ),
    );

    await expect(cancelInterPixSubscription("sub-1")).resolves.toEqual({
      pendingCycle: { cycleSeq: 3, dueDate: "2026-09-15" },
    });
  });

  it("sem pendingCycle na resposta, devolve null em vez de undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 })),
    );

    await expect(cancelInterPixSubscription("sub-1")).resolves.toEqual({ pendingCycle: null });
  });
});
