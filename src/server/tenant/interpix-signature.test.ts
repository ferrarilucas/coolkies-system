import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { isValidInterPixSignature } from "./interpix-signature";

const SECRET = "segredo-de-teste";

function sign(raw: string, timestamp: string): string {
  return createHmac("sha256", SECRET).update(`${timestamp}.${raw}`).digest("hex");
}

describe("assinatura do webhook InterPix", () => {
  const now = 1_800_000_000_000;
  const raw = '{"type":"cycle.paid","data":{},"eventId":"1"}';
  const ts = String(now - 1000);

  it("aceita assinatura correta dentro da janela", () => {
    expect(
      isValidInterPixSignature({ raw, timestamp: ts, signature: sign(raw, ts), secret: SECRET, now }),
    ).toBe(true);
  });

  it("recusa assinatura de outro segredo", () => {
    const outra = createHmac("sha256", "outro").update(`${ts}.${raw}`).digest("hex");
    expect(
      isValidInterPixSignature({ raw, timestamp: ts, signature: outra, secret: SECRET, now }),
    ).toBe(false);
  });

  it("recusa corpo alterado depois de assinado", () => {
    const assinatura = sign(raw, ts);
    const adulterado = raw.replace("cycle.paid", "cycle.failed");
    expect(
      isValidInterPixSignature({
        raw: adulterado,
        timestamp: ts,
        signature: assinatura,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("recusa timestamp com mais de cinco minutos", () => {
    const velho = String(now - 6 * 60 * 1000);
    expect(
      isValidInterPixSignature({
        raw,
        timestamp: velho,
        signature: sign(raw, velho),
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("recusa timestamp no futuro", () => {
    const futuro = String(now + 60 * 1000);
    expect(
      isValidInterPixSignature({
        raw,
        timestamp: futuro,
        signature: sign(raw, futuro),
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("recusa assinatura que não é hex, sem quebrar", () => {
    expect(
      isValidInterPixSignature({ raw, timestamp: ts, signature: "nao-e-hex", secret: SECRET, now }),
    ).toBe(false);
  });

  it("recusa timestamp que não é número", () => {
    expect(
      isValidInterPixSignature({ raw, timestamp: "ontem", signature: sign(raw, "ontem"), secret: SECRET, now }),
    ).toBe(false);
  });
});
