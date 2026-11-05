import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageResponse } from "next/og";
import type { ChargeSelection } from "@/server/queries/charge-selection";
import {
  createChargeImageResponse,
  loadChargeImageAssets,
  loadChargeImageFonts,
  loadChargeImageLogo,
  resetChargeImageAssetCache,
} from "./charge-summary-image";
import { decodePng } from "./png-decode";
import { isRenderableCodePoint } from "./sanitize";

type Sale = ChargeSelection["sales"][number];

function sale(n: number, names: string[], parcels = 1, count = 3): Sale {
  return {
    id: `s${n}`,
    soldAt: new Date(Date.UTC(2026, 9, 1 + (n % 28), 15)),
    totalCents: 4590,
    installmentCount: count,
    items: names.map((name, i) => ({ id: `s${n}i${i}`, quantity: i + 1, productNameSnapshot: name, variantNameSnapshot: null })),
    selectedInstallments: Array.from({ length: parcels }, (_, i) => ({
      id: `s${n}p${i}`,
      number: i + 1,
      amountCents: 1530,
      dueDate: new Date(Date.UTC(2026, 10 + i, 10, 15)),
    })),
  };
}

function selection(sales: Sale[]): ChargeSelection {
  return {
    customer: { id: "c", name: "MARIA WWWWWW MMMMMMM DA SILVA SAUROS", sector: "ADMINISTRAÇÃO MWMW" },
    sales,
    totalCents: sales.reduce((sum, s) => sum + s.selectedInstallments.reduce((a, i) => a + i.amountCents, 0), 0),
  };
}

async function render(sel: ChargeSelection, workspaceName: string, pixKey: string | null, logo?: string | null) {
  const assets = await loadChargeImageAssets();
  const { response, model } = createChargeImageResponse(
    { selection: sel, workspaceName, pixKey, generatedAt: new Date(Date.UTC(2026, 10, 4, 15)) },
    logo === undefined ? assets : { ...assets, logo },
  );
  return { png: decodePng(Buffer.from(await response.arrayBuffer())), model };
}

function near([r, g, b]: [number, number, number], hex: string, tolerance = 12): boolean {
  const [er, eg, eb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.abs(r - er) <= tolerance && Math.abs(g - eg) <= tolerance && Math.abs(b - eb) <= tolerance;
}

function footerHasTotal(png: ReturnType<typeof decodePng>, footerHeight: number): boolean {
  for (let y = png.height - 48 - footerHeight; y < png.height - 48; y++) {
    for (let x = png.width / 2; x < png.width - 48; x += 2) {
      if (near(png.pixel(x, y), "#C94F32", 20)) return true;
    }
  }
  return false;
}

const LONG_ITEM = "COOKIE RECHEADO DE NUTELLA COM PEDAÇOS DE CHOCOLATE BELGA MEIO AMARGO WWW MMM — EMBALAGEM PRESENTE MWMW";

describe("imagem do resumo", () => {
  const fetchSpy = vi.fn(async () => {
    throw new Error("rede proibida na geração da imagem");
  });

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emoji e latin-ext não disparam busca de rede", async () => {
    const { png } = await render(selection([sale(1, ["Cookie 🍪", "Łódź Ștefan Őrs", "Pão 蛋糕 ❤️ ǅ"])]), "Doceria 🍰 São João", "ana@cipri.com.br");
    expect(png.width).toBe(1080);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("controle negativo: emoji sem sanitizar dispara busca de rede no satori", async () => {
    const { fonts } = await loadChargeImageAssets();
    const response = new ImageResponse(<div style={{ display: "flex", fontFamily: "Sora" }}>{"Cookie \u{1F36A}"}</div>, {
      width: 200,
      height: 60,
      fonts,
    });
    await response.arrayBuffer().catch(() => null);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("todo caractere aceito pelo sanitizador tem glifo local (sem rede)", async () => {
    let all = "";
    for (let codePoint = 0x20; codePoint <= 0x2215; codePoint++) {
      if (isRenderableCodePoint(codePoint)) all += String.fromCodePoint(codePoint);
    }
    const chunks = all.match(/.{1,80}/gsu) ?? [];
    await render(selection([sale(1, chunks.slice(0, 6)), sale(2, chunks.slice(6, 12))]), all.slice(0, 60), all.slice(60, 130));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("altura do PNG é a do modelo e o rodapé com o total aparece inteiro com textos largos", async () => {
    const sales = [sale(1, [LONG_ITEM, LONG_ITEM, LONG_ITEM, LONG_ITEM], 2, 4), sale(2, [LONG_ITEM, LONG_ITEM])];
    const { png, model } = await render(
      selection(sales),
      "DOCERIA MWMWMWMWMW WWWWWWWW MMMMMMMM DA ESQUINA DO BAIRRO ALTO LTDA",
      "maria.wwwwwwmmmmmmm.dasilva.sauros.administracao@empresa-muito-longa.com.br",
    );
    expect(png.height).toBe(model.height);
    expect(near(png.pixel(540, png.height - 20), "#F7F4ED")).toBe(true);
    expect(footerHasTotal(png, 330)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pior caso (200 vendas cheias) respeita o teto de altura", { timeout: 60000 }, async () => {
    const sales = Array.from({ length: 200 }, (_, i) => sale(i, Array(8).fill(LONG_ITEM), 8, 10));
    const { png, model } = await render(selection(sales), "Cipri", "ana@cipri.com.br");
    expect(png.height).toBeLessThanOrEqual(4500);
    expect(model.hiddenSales).toBeGreaterThan(0);
    expect(model.total).toBe("R$ 24.480,00");
    expect(footerHasTotal(png, 260)).toBe(true);
  });

  it("sem logo a imagem ainda renderiza", async () => {
    const { png } = await render(selection([sale(1, ["Cookie"])]), "Cipri", null, null);
    expect(png.width).toBe(1080);
    expect(near(png.pixel(150, 140), "#C94F32")).toBe(true);
  });

  it("com logo o wordmark claro aparece no cabeçalho", async () => {
    const { png } = await render(selection([sale(1, ["Cookie"])]), "Cipri", null);
    let light = 0;
    for (let y = 92; y < 188; y += 2) {
      for (let x = 96; x < 293; x += 2) if (near(png.pixel(x, y), "#F7F4ED", 20)) light++;
    }
    expect(light).toBeGreaterThan(200);
  });
});

describe("carregamento de assets", () => {
  beforeEach(() => {
    resetChargeImageAssetCache();
  });

  afterEach(() => {
    resetChargeImageAssetCache();
    vi.restoreAllMocks();
  });

  it("wordmark ausente vira null com um log só e tenta de novo depois", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadChargeImageLogo("/nao/existe.svg")).toBeNull();
    expect(await loadChargeImageLogo("/nao/existe.svg")).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[charge-image]");
    expect(await loadChargeImageLogo()).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("registra latin e latin-ext em famílias separadas", async () => {
    const fonts = await loadChargeImageFonts();
    expect(fonts.map((f) => `${f.name}-${f.weight}`).sort()).toEqual(["Sora-400", "Sora-600", "SoraExt-400", "SoraExt-600"]);
  });
});
