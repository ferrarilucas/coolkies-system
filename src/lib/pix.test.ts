import { describe, expect, it } from "vitest";
import {
  assemblePixPayload,
  buildPixCopyPaste,
  crc16,
  isPixConfigured,
  normalizePixKey,
  type PixKeyType,
} from "./pix";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n << 8;
  for (let i = 0; i < 8; i++)
    value = value & 0x8000 ? (value << 1) ^ 0x1021 : value << 1;
  return value & 0xffff;
});

function crc16Table(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  let crc = 0xffff;
  for (const byte of bytes)
    crc = ((crc << 8) & 0xffff) ^ CRC_TABLE[((crc >> 8) ^ byte) & 0xff];
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

describe("crc16", () => {
  it("CCITT-FALSE", () => expect(crc16("123456789")).toBe("29B1"));
});

describe("crc16Table (referência do teste)", () => {
  it("CCITT-FALSE", () => expect(crc16Table("123456789")).toBe("29B1"));
});

describe("assemblePixPayload", () => {
  it("lança com caractere fora de ASCII imprimível", () => {
    expect(() =>
      assemblePixPayload({ key: "a@b.co", name: "JOÃO", city: "B" }),
    ).toThrow();
    expect(() =>
      assemblePixPayload({ key: "a@b.co", name: "A\tB", city: "B" }),
    ).toThrow();
  });

  it("lança com campo maior que 99", () => {
    expect(() =>
      assemblePixPayload({ key: "a@b.co", name: "A".repeat(100), city: "B" }),
    ).toThrow();
    expect(() =>
      assemblePixPayload({ key: "k".repeat(78), name: "A", city: "B" }),
    ).toThrow();
  });

  it("reproduz o exemplo do manual do BC", () => {
    expect(
      assemblePixPayload({
        key: "123e4567-e12b-12d1-a456-426655440000",
        name: "Fulano de Tal",
        city: "BRASILIA",
      }),
    ).toBe(
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D",
    );
  });
});

describe("buildPixCopyPaste", () => {
  it("inclui valor, normaliza nome/cidade e fecha com CRC válido", () => {
    const code = buildPixCopyPaste({
      key: "+5511987654321",
      name: "Confeitaria São João da Barra Ltda",
      city: "São José dos Campos",
      amountCents: 123450,
    });
    expect(code).toContain("54071234.50");
    expect(code).toContain("5925CONFEITARIA SAO JOAO DA B");
    expect(code).toContain("6015SAO JOSE DOS CA");
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
  });

  it("valor de 5 centavos", () => {
    expect(
      buildPixCopyPaste({
        key: "a@b.co",
        name: "A",
        city: "B",
        amountCents: 5,
      }),
    ).toContain("54040.05");
  });

  it("troca tab e quebras de linha por espaço antes de limpar", () => {
    expect(
      buildPixCopyPaste({
        key: "a@b.co",
        name: "Doce\tCia",
        city: "Rio\nClaro",
        amountCents: 100,
      }),
    ).toContain("5908DOCE CIA6009RIO CLARO");
  });

  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "omite o campo 54 quando amountCents é %s",
    (amountCents) => {
      const code = buildPixCopyPaste({
        key: "a@b.co",
        name: "A",
        city: "B",
        amountCents,
      });
      expect(code).toContain("53039865802BR");
      expect(code).not.toMatch(/530398654/);
      expect(code.slice(-4)).toBe(crc16Table(code.slice(0, -4)));
    },
  );

  it("gera o código completo com valor igual à referência montada à mão", () => {
    const body =
      "000201" +
      "2633" +
      "0014br.gov.bcb.pix" +
      "0111loja@ex.com" +
      "52040000" +
      "5303986" +
      "540519.90" +
      "5802BR" +
      "5909LOJA DOCE" +
      "6008CURITIBA" +
      "62070503***" +
      "6304";
    const expected = body + crc16Table(body);
    expect(
      buildPixCopyPaste({
        key: "loja@ex.com",
        name: "Loja Doce",
        city: "Curitiba",
        amountCents: 1990,
      }),
    ).toBe(expected);
  });

  it("recusa chave com caractere fora de ASCII mesmo sem passar pela normalização", () => {
    expect(() =>
      buildPixCopyPaste({
        key: "joão@loja.com",
        name: "A",
        city: "B",
        amountCents: 100,
      }),
    ).toThrow();
  });

  it("remove caracteres fora do padrão do nome", () => {
    expect(
      buildPixCopyPaste({
        key: "a@b.co",
        name: "Doce & Cia.",
        city: "Itajaí",
        amountCents: 100,
      }),
    ).toContain("5908DOCE CIA6006ITAJAI");
  });
});

describe("normalizePixKey", () => {
  it.each([
    ["CPF", "529.982.247-25", { ok: true, key: "52998224725" }],
    ["CPF", "529.982.247-24", { ok: false }],
    ["CPF", "111.111.111-11", { ok: false }],
    ["CNPJ", "11.222.333/0001-81", { ok: true, key: "11222333000181" }],
    ["CNPJ", "11.222.333/0001-80", { ok: false }],
    ["PHONE", "(55) 99123-4567", { ok: true, key: "+5555991234567" }],
    ["PHONE", "123", { ok: false }],
    ["PHONE", "5511987654321", { ok: true, key: "+5511987654321" }],
    ["PHONE", "(11) 3456-7890", { ok: false }],
    ["PHONE", "551134567890", { ok: false }],
    ["EMAIL", " Loja@Ex.com ", { ok: true, key: "loja@ex.com" }],
    ["EMAIL", "loja@", { ok: false }],
    ["EMAIL", "joão@loja.com", { ok: false }],
    ["EMAIL", "loja@doçe.com", { ok: false }],
    [
      "EVP",
      "123E4567-E12B-12D1-A456-426655440000",
      { ok: true, key: "123e4567-e12b-12d1-a456-426655440000" },
    ],
    ["EVP", "abc", { ok: false }],
  ])("%s %s", (type, raw, expected) =>
    expect(normalizePixKey(type as PixKeyType, raw)).toMatchObject(expected),
  );

  it("recusa e-mail maior que 77", () => {
    expect(normalizePixKey("EMAIL", `${"a".repeat(70)}@exemplo.com`).ok).toBe(
      false,
    );
  });
});

describe("isPixConfigured", () => {
  it("exige os três campos", () => {
    expect(
      isPixConfigured({
        pixKey: "a@b.co",
        pixRecipientName: "Loja",
        pixCity: "Curitiba",
      }),
    ).toBe(true);
    expect(
      isPixConfigured({
        pixKey: "a@b.co",
        pixRecipientName: " ",
        pixCity: "Curitiba",
      }),
    ).toBe(false);
    expect(
      isPixConfigured({
        pixKey: null,
        pixRecipientName: "Loja",
        pixCity: "Curitiba",
      }),
    ).toBe(false);
  });

  it("recusa chave maior que 77", () => {
    expect(
      isPixConfigured({
        pixKey: "k".repeat(77),
        pixRecipientName: "Loja",
        pixCity: "Curitiba",
      }),
    ).toBe(true);
    expect(
      isPixConfigured({
        pixKey: "k".repeat(78),
        pixRecipientName: "Loja",
        pixCity: "Curitiba",
      }),
    ).toBe(false);
  });
});
