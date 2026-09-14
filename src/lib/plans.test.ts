import { describe, expect, it } from "vitest";
import {
  chargeAmountCents,
  effectiveLimit,
  isKnownPlan,
  monthlyPriceCents,
  planLabel,
  planLimit,
  planMemberLimit,
} from "./plans";
import { isPeriodPaid } from "./period";

describe("preço mensal equivalente", () => {
  it("corre: as quatro combinações batem com a página pública", () => {
    expect(monthlyPriceCents("corre", "MONTHLY", "CARD")).toBe(3950);
    expect(monthlyPriceCents("corre", "MONTHLY", "PIX")).toBe(3450);
    expect(monthlyPriceCents("corre", "YEARLY", "CARD")).toBe(2950);
    expect(monthlyPriceCents("corre", "YEARLY", "PIX")).toBe(2450);
  });

  it("cresce: as quatro combinações batem com a página pública", () => {
    expect(monthlyPriceCents("cresce", "MONTHLY", "CARD")).toBe(9990);
    expect(monthlyPriceCents("cresce", "MONTHLY", "PIX")).toBe(9490);
    expect(monthlyPriceCents("cresce", "YEARLY", "CARD")).toBe(8990);
    expect(monthlyPriceCents("cresce", "YEARLY", "PIX")).toBe(8490);
  });

  it("escala não tem preço de tabela", () => {
    expect(monthlyPriceCents("escala", "MONTHLY", "PIX")).toBeNull();
  });
});

describe("valor da cobrança", () => {
  it("mensal cobra o valor do mês", () => {
    expect(chargeAmountCents("corre", "MONTHLY", "PIX")).toBe(3450);
  });

  it("anual cobra doze meses numa vez só", () => {
    expect(chargeAmountCents("corre", "YEARLY", "PIX")).toBe(29400);
    expect(chargeAmountCents("corre", "YEARLY", "CARD")).toBe(35400);
    expect(chargeAmountCents("cresce", "YEARLY", "PIX")).toBe(101880);
    expect(chargeAmountCents("cresce", "YEARLY", "CARD")).toBe(107880);
  });

  it("a economia anunciada de R$180 no anual com Pix se confirma", () => {
    const mensalNoAno = chargeAmountCents("corre", "MONTHLY", "CARD")! * 12;
    const anualPix = chargeAmountCents("corre", "YEARLY", "PIX")!;
    expect(mensalNoAno - anualPix).toBe(18000);
  });
});

describe("catálogo", () => {
  it("conhece os ids novos e não os antigos", () => {
    expect(isKnownPlan("corre")).toBe(true);
    expect(isKnownPlan("cresce")).toBe(true);
    expect(isKnownPlan("escala")).toBe(true);
    expect(isKnownPlan("solo")).toBe(false);
    expect(isKnownPlan("team")).toBe(false);
  });

  it("limita workspaces por plano", () => {
    expect(planLimit("corre")).toBe(1);
    expect(planLimit("cresce")).toBe(4);
    expect(planLimit("escala")).toBe(Number.POSITIVE_INFINITY);
  });

  it("trial vale por um workspace, qualquer que seja o plano gravado", () => {
    expect(effectiveLimit("cresce", "TRIALING")).toBe(1);
    expect(effectiveLimit("cresce", "ACTIVE")).toBe(4);
  });

  it("PENDING_AUTH não amplia o limite antes do primeiro pagamento", () => {
    expect(effectiveLimit("cresce", "PENDING_AUTH")).toBe(1);
    expect(effectiveLimit("escala", "PENDING_AUTH")).toBe(1);
  });

  it("CANCELED e PAST_DUE sem pagamento comprovado não recebem o limite cheio do plano", () => {
    expect(effectiveLimit("cresce", "CANCELED")).toBe(1);
    expect(effectiveLimit("cresce", "CANCELED", false)).toBe(1);
    expect(effectiveLimit("cresce", "PAST_DUE")).toBe(1);
    expect(effectiveLimit("cresce", "PAST_DUE", false)).toBe(1);
  });

  it("CANCELED e PAST_DUE com pagamento comprovado recebem o limite cheio do plano", () => {
    expect(effectiveLimit("cresce", "CANCELED", true)).toBe(4);
    expect(effectiveLimit("cresce", "PAST_DUE", true)).toBe(4);
  });

  it("rotula o plano pelo nome comercial", () => {
    expect(planLabel("corre")).toBe("Corre");
  });
});

describe("limite do plano concorda com a regra de acesso", () => {
  it("período em aberto não coberto pelo último pagamento: sem limite cheio, igual à regra de acesso", () => {
    const sub: Parameters<typeof isPeriodPaid>[0] = {
      paidThroughAt: new Date("2026-08-15"),
      currentPeriodEnd: new Date("2026-09-30"),
    };
    const paid = isPeriodPaid(sub);
    expect(paid).toBe(false);
    expect(effectiveLimit("cresce", "CANCELED", paid)).toBe(1);
  });

  it("período em aberto coberto pelo último pagamento: limite cheio, igual à regra de acesso", () => {
    const sub: Parameters<typeof isPeriodPaid>[0] = {
      paidThroughAt: new Date("2026-09-30"),
      currentPeriodEnd: new Date("2026-09-30"),
    };
    const paid = isPeriodPaid(sub);
    expect(paid).toBe(true);
    expect(effectiveLimit("cresce", "CANCELED", paid)).toBe(4);
  });
});

describe("catálogo de cartão x Stripe", () => {
  it("todo plano/ciclo cobrável tem uma env var de Price mapeada", async () => {
    const { priceEnvVar } = await import("@/server/tenant/stripe");
    const cycles = ["MONTHLY", "YEARLY"] as const;

    for (const cycle of cycles) {
      for (const plan of ["corre", "cresce", "escala"]) {
        const cobravel = chargeAmountCents(plan, cycle, "CARD") !== null;
        const mapeado = priceEnvVar(plan, cycle) !== null;
        expect(mapeado).toBe(cobravel);
      }
    }
  });
});

describe("limite de usuários por workspace", () => {
  it("corre permite só 2 usuários por workspace", () => {
    expect(planMemberLimit("corre")).toBe(2);
  });

  it("cresce e escala não limitam usuários", () => {
    expect(planMemberLimit("cresce")).toBe(Number.POSITIVE_INFINITY);
    expect(planMemberLimit("escala")).toBe(Number.POSITIVE_INFINITY);
  });
});
