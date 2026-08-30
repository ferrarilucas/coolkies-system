import { describe, expect, it } from "vitest";
import { formatInviteCode, normalizeInviteCode } from "./workspaces";

describe("código de convite", () => {
  it("formata em dois grupos de quatro", () => {
    expect(formatInviteCode("ABCD2345")).toBe("ABCD-2345");
  });

  it("normaliza o que a pessoa digita", () => {
    expect(normalizeInviteCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeInviteCode(" abcd 2345 ")).toBe("ABCD2345");
    expect(normalizeInviteCode("ABCD_2345")).toBe("ABCD2345");
  });

  it("descarta caracteres que não existem no alfabeto do código", () => {
    expect(normalizeInviteCode("ab#cd@23$45")).toBe("ABCD2345");
  });

  it("ida e volta preserva o código", () => {
    const code = "MNPQ7899";
    expect(normalizeInviteCode(formatInviteCode(code))).toBe(code);
  });
});
