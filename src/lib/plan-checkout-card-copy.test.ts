import { describe, expect, it } from "vitest";
import { activeBannerText, readOnlyBannerText } from "./plan-banner-copy";
import { planCheckoutCardCopy } from "./plan-checkout-card-copy";

describe("cópia do card de checkout alinhada ao banner", () => {
  it("estado de espera: card e banner falam da mesma coisa — autorização recebida, falta a primeira cobrança", () => {
    const card = planCheckoutCardCopy("waiting");
    const banner = activeBannerText("PENDING_AUTH", true, null);

    expect(card.title).not.toBe("Autorização pendente");
    expect(card.description).toContain("autorização foi recebida");
    expect(banner?.headline).toContain("Autorização recebida");
    expect(banner?.body).toContain("primeira cobrança");
  });

  it("estado de carência vencida: card e banner dizem a mesma coisa — prazo passou sem confirmação de pagamento", () => {
    const card = planCheckoutCardCopy("expired");
    const banner = readOnlyBannerText("PENDING_AUTH", true);

    expect(card.description).toBe("O prazo passou sem confirmação de pagamento.");
    expect(banner.headline).toContain("O prazo passou sem confirmação de pagamento");
    expect(card.description).not.toContain("não debitada");
  });

  it("autorizar e esperar têm títulos diferentes — não colapsam mais no mesmo texto", () => {
    expect(planCheckoutCardCopy("authorize").title).not.toBe(
      planCheckoutCardCopy("waiting").title,
    );
  });
});
