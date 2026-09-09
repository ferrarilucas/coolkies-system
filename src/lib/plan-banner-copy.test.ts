import { describe, expect, it } from "vitest";
import { activeBannerText, readOnlyBannerText } from "./plan-banner-copy";

describe("readOnlyBannerText", () => {
  it("PENDING_AUTH sem autorização não afirma cancelamento nem falha de cobrança", () => {
    const text = readOnlyBannerText("PENDING_AUTH", false);
    expect(text.headline).not.toContain("cancelada");
    expect(text.headline).toContain("sem que o débito recorrente fosse autorizado");
  });

  it("PENDING_AUTH autorizado e com carência vencida não afirma que a cobrança não aconteceu", () => {
    const text = readOnlyBannerText("PENDING_AUTH", true);
    expect(text.headline).not.toContain("cancelada");
    expect(text.headline).not.toContain("não foi debitada");
    expect(text.headline).toContain("prazo passou sem confirmação de pagamento");
  });

  it("SUSPENDED diz que foi suspenso por falta de pagamento, não que foi cancelado", () => {
    const text = readOnlyBannerText("SUSPENDED", true);
    expect(text.headline).toContain("suspensa por falta de pagamento");
    expect(text.headline).not.toContain("cancelada");
  });

  it("AUTH_DENIED diz que o banco recusou, não que foi cancelado", () => {
    const text = readOnlyBannerText("AUTH_DENIED", false);
    expect(text.headline).toContain("recusou a autorização");
    expect(text.headline).not.toContain("cancelada");
  });

  it("status desconhecido continua caindo no texto de cancelamento", () => {
    expect(readOnlyBannerText("CANCELED", false).headline).toContain("cancelada");
  });
});

describe("activeBannerText", () => {
  it("PENDING_AUTH sem autorização, com acesso, não afirma modo somente leitura", () => {
    const text = activeBannerText("PENDING_AUTH", false, null);
    expect(text?.headline).not.toContain("somente leitura");
    expect(text?.headline).toContain("Aguardando autorização");
  });

  it("PENDING_AUTH autorizado, com acesso, avisa que aguarda a primeira cobrança", () => {
    const text = activeBannerText("PENDING_AUTH", true, null);
    expect(text?.headline).toContain("aguardando a primeira cobrança");
  });

  it("PAST_DUE não inventa prazo local de carência", () => {
    const text = activeBannerText("PAST_DUE", true, null);
    expect(text?.body).not.toContain("carência");
    expect(text?.body).not.toContain("antes que ela termine");
  });

  it("PAST_DUE por falha de infraestrutura explica que não é falta de pagamento do cliente", () => {
    const text = activeBannerText("PAST_DUE", true, "JANELA_DE_ENVIO_EXPIRADA");
    expect(text?.headline).toContain("Falha técnica");
    expect(text?.body).toContain("não por falta de pagamento");
    expect(text?.cta).toBeNull();
  });

  it("PAST_DUE por falha real de débito fala em pagamento pendente", () => {
    const text = activeBannerText("PAST_DUE", true, "saldo insuficiente");
    expect(text?.headline).toBe("Pagamento pendente.");
  });

  it("status sem banner ativo devolve null", () => {
    expect(activeBannerText("ACTIVE", true, null)).toBeNull();
  });
});
