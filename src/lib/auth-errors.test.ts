import { describe, expect, it } from "vitest";
import { authErrorMessage, GENERIC_AUTH_ERROR } from "./auth-errors";

describe("authErrorMessage", () => {
  it("traduz os códigos conhecidos", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("E-mail ou senha incorretos.");
    expect(authErrorMessage({ code: "EMAIL_NOT_VERIFIED" })).toContain("Confirme seu e-mail");
    expect(authErrorMessage({ code: "INVALID_TOKEN" })).toContain("expirou ou já foi usado");
  });

  it("429 vira aviso de muitas tentativas, qualquer que seja o código", () => {
    expect(authErrorMessage({ status: 429 })).toBe("Muitas tentativas. Espere um pouco e tente de novo.");
  });

  it("código desconhecido ou erro ausente cai na mensagem genérica", () => {
    expect(authErrorMessage({ code: "ALGO_NOVO" })).toBe(GENERIC_AUTH_ERROR);
    expect(authErrorMessage(null)).toBe(GENERIC_AUTH_ERROR);
  });
});
