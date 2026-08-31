import { describe, expect, it } from "vitest";
import { expectedStatusFor } from "./reconcile-status";

describe("classificacao do status remoto da assinatura", () => {
  it("ACTIVE mapeia para ACTIVE local", () => {
    expect(expectedStatusFor("ACTIVE")).toBe("ACTIVE");
  });

  it("EXPIRED nao mapeia para nada, por falta de certeza documentada", () => {
    expect(expectedStatusFor("EXPIRED")).toBeNull();
  });

  it("INACTIVE nao mapeia para nada, por falta de certeza documentada", () => {
    expect(expectedStatusFor("INACTIVE")).toBeNull();
  });

  it("qualquer valor nao previsto tambem cai em desconhecido", () => {
    expect(expectedStatusFor("STATUS_FUTURO_QUE_NAO_EXISTE_AINDA")).toBeNull();
    expect(expectedStatusFor("")).toBeNull();
    expect(expectedStatusFor("active")).toBeNull();
  });
});
