import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("monta cabeçalho e linhas na ordem das colunas", () => {
    const csv = toCsv(
      [{ name: "Ana", total: 100 }],
      [
        { key: "name", label: "Nome" },
        { key: "total", label: "Total" },
      ],
    );
    expect(csv).toBe("Nome,Total\r\nAna,100");
  });

  it("escapa vírgula, aspas e quebra de linha", () => {
    const csv = toCsv(
      [{ name: 'Ana, "Confeitaria"\nfilial 2' }],
      [{ key: "name", label: "Nome" }],
    );
    expect(csv).toBe('Nome\r\n"Ana, ""Confeitaria""\nfilial 2"');
  });

  it("lista vazia gera só o cabeçalho", () => {
    expect(toCsv([], [{ key: "name", label: "Nome" }])).toBe("Nome");
  });
});
