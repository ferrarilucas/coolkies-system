import { formatInTimeZone } from "date-fns-tz";
import { formatChargeAmount } from "@/lib/charge-message";
import type { ChargeSelection } from "@/server/queries/charge-selection";
import { sanitizeImageText } from "./sanitize";

export const CHARGE_IMAGE_WIDTH = 1080;
export const CHARGE_IMAGE_MAX_HEIGHT = 4500;
export const CHARGE_IMAGE_MAX_ITEMS = 6;
export const CHARGE_IMAGE_MAX_INSTALLMENTS = 6;

const TIME_ZONE = "America/Sao_Paulo";

export const L = {
  pagePadding: 48,
  headerPaddingY: 44,
  headerPaddingX: 48,
  headerRadius: 32,
  logoWidth: 197,
  logoHeight: 96,
  titleSize: 50,
  titleLineHeight: 1.2,
  titleGap: 28,
  workspaceSize: 28,
  workspaceLineHeight: 1.3,
  workspaceGap: 8,
  workspaceLines: 1,
  listGap: 28,
  cardGap: 20,
  cardBorder: 2,
  cardLift: 3,
  cardPaddingY: 28,
  cardPaddingX: 32,
  cardRadius: 20,
  saleHeadSize: 30,
  saleHeadLineHeight: 1.3,
  itemSize: 24,
  itemLineHeight: 1.35,
  itemGap: 10,
  itemLines: 2,
  pillGap: 10,
  pillFirstGap: 16,
  pillSize: 22,
  pillLineHeight: 1.3,
  pillPaddingY: 8,
  pillPaddingX: 18,
  moreSize: 22,
  moreLineHeight: 1.3,
  hiddenSalesPaddingY: 20,
  hiddenSalesSize: 24,
  hiddenSalesLineHeight: 1.3,
  footerGap: 8,
  footerBorder: 2,
  footerPaddingY: 36,
  footerPaddingX: 40,
  footerRadius: 28,
  totalSize: 60,
  totalLineHeight: 1.15,
  pixGap: 24,
  pixPaddingY: 20,
  pixPaddingX: 24,
  pixLabelSize: 20,
  pixLabelLineHeight: 1.3,
  pixLabelGap: 6,
  pixKeySize: 28,
  pixKeyLineHeight: 1.3,
  pixKeyMaxLines: 2,
  safety: 16,
} as const;

const CARD_TEXT_WIDTH = CHARGE_IMAGE_WIDTH - 2 * L.pagePadding - 2 * L.cardBorder - 2 * L.cardPaddingX;
const PIX_TEXT_WIDTH =
  CHARGE_IMAGE_WIDTH - 2 * L.pagePadding - 2 * L.footerBorder - 2 * L.footerPaddingX - 2 * L.pixPaddingX;

const WIDEST = new Set(["ẞ"]);
const WIDE = new Set([..."WMmw@ŒœÆæ%¾—ŴŵẀẁẂẃẄẅ™"]);
const SEMI_WIDE = new Set([..."½¼…"]);
const NARROW = new Set([..." .,:;!|'iljI()[]-·"]);

function charWidth(char: string): number {
  if (WIDEST.has(char)) return 1.33;
  if (WIDE.has(char)) return 1.13;
  if (NARROW.has(char)) return 0.51;
  if (SEMI_WIDE.has(char) || char !== char.toLowerCase()) return 0.87;
  return 0.76;
}

export function estimateLines(text: string, fontSize: number, width: number, maxLines: number): number {
  const space = charWidth(" ") * fontSize;
  let lines = 1;
  let current = 0;
  const place = (word: string) => {
    for (const char of word) {
      const w = charWidth(char) * fontSize;
      if (current > 0 && current + w > width) {
        lines += 1;
        current = 0;
      }
      current += w;
    }
  };
  for (const word of text.split(" ").filter(Boolean)) {
    const w = [...word].reduce((sum, char) => sum + charWidth(char) * fontSize, 0);
    if (current === 0) place(word);
    else if (current + space + w <= width) current += space + w;
    else {
      lines += 1;
      current = 0;
      place(word);
    }
  }
  return Math.min(lines, maxLines);
}

export type ChargeImageSale = {
  id: string;
  date: string;
  total: string;
  items: { id: string; label: string; lines: number }[];
  hiddenItems: number;
  installments: { id: string; label: string }[];
  hiddenInstallments: number;
};

export type ChargeImageModel = {
  workspaceName: string;
  generatedAt: string;
  total: string;
  pixKey: string | null;
  pixKeyLines: number;
  sales: ChargeImageSale[];
  hiddenSales: number;
  height: number;
};

export type ChargeImageInput = {
  selection: ChargeSelection;
  workspaceName: string;
  pixKey: string | null;
  generatedAt: Date;
};

function fmt(date: Date, pattern: string): string {
  return formatInTimeZone(date, TIME_ZONE, pattern);
}

function plural(count: number, one: string, many: string): string {
  return `+ ${count} ${count === 1 ? one : many}`;
}

export function moreItemsLabel(count: number): string {
  return plural(count, "item", "itens");
}

export function moreInstallmentsLabel(count: number): string {
  return plural(count, "parcela", "parcelas");
}

export function moreSalesLabel(count: number): string {
  return plural(count, "venda", "vendas");
}

function toSale(sale: ChargeSelection["sales"][number]): ChargeImageSale {
  const items = sale.items.slice(0, CHARGE_IMAGE_MAX_ITEMS).map((item) => {
    const variant = item.variantNameSnapshot ? ` — ${sanitizeImageText(item.variantNameSnapshot)}` : "";
    const label = sanitizeImageText(`${item.quantity}x ${sanitizeImageText(item.productNameSnapshot)}${variant}`);
    return { id: item.id, label, lines: estimateLines(label, L.itemSize, CARD_TEXT_WIDTH, L.itemLines) };
  });
  const parceled = sale.installmentCount > 1;
  const shown = parceled ? sale.selectedInstallments.slice(0, CHARGE_IMAGE_MAX_INSTALLMENTS) : [];
  return {
    id: sale.id,
    date: fmt(sale.soldAt, "dd/MM/yyyy"),
    total: formatChargeAmount(sale.totalCents),
    items,
    hiddenItems: sale.items.length - items.length,
    installments: shown.map((inst) => ({
      id: inst.id,
      label: sanitizeImageText(
        `Parcela ${inst.number}/${sale.installmentCount} · ${formatChargeAmount(inst.amountCents)}${
          inst.dueDate ? ` · vence ${fmt(inst.dueDate, "dd/MM/yyyy")}` : ""
        }`,
      ),
    })),
    hiddenInstallments: parceled ? sale.selectedInstallments.length - shown.length : 0,
  };
}

export function saleCardHeight(sale: ChargeImageSale): number {
  const itemLine = L.itemSize * L.itemLineHeight;
  const items = sale.items.reduce((sum, item) => sum + L.itemGap + item.lines * itemLine, 0);
  const moreItems = sale.hiddenItems > 0 ? L.itemGap + itemLine : 0;
  const pill = L.pillSize * L.pillLineHeight + 2 * L.pillPaddingY;
  const pills = sale.installments.length > 0 ? L.pillFirstGap - L.pillGap + sale.installments.length * (L.pillGap + pill) : 0;
  const morePills = sale.hiddenInstallments > 0 ? L.pillGap + L.moreSize * L.moreLineHeight : 0;
  return (
    2 * L.cardBorder +
    L.cardLift +
    2 * L.cardPaddingY +
    L.saleHeadSize * L.saleHeadLineHeight +
    items +
    moreItems +
    pills +
    morePills +
    L.cardGap
  );
}

export function hiddenSalesHeight(): number {
  return 2 * L.hiddenSalesPaddingY + L.hiddenSalesSize * L.hiddenSalesLineHeight + L.cardGap;
}

export function headerHeight(): number {
  return (
    2 * L.headerPaddingY +
    L.logoHeight +
    L.titleGap +
    L.titleSize * L.titleLineHeight +
    L.workspaceGap +
    L.workspaceLines * L.workspaceSize * L.workspaceLineHeight
  );
}

export function footerHeight(pixKeyLines: number): number {
  const pix = pixKeyLines > 0
    ? L.pixGap +
      2 * L.pixPaddingY +
      L.pixLabelSize * L.pixLabelLineHeight +
      L.pixLabelGap +
      pixKeyLines * L.pixKeySize * L.pixKeyLineHeight
    : 0;
  return L.footerGap + 2 * L.footerBorder + 2 * L.footerPaddingY + L.totalSize * L.totalLineHeight + pix;
}

export function buildChargeImageModel({ selection, workspaceName, pixKey, generatedAt }: ChargeImageInput): ChargeImageModel {
  const cleanPix = pixKey ? sanitizeImageText(pixKey) : "";
  const pixKeyLines = cleanPix ? estimateLines(cleanPix, L.pixKeySize, PIX_TEXT_WIDTH, L.pixKeyMaxLines) : 0;
  const fixed = 2 * L.pagePadding + headerHeight() + L.listGap + footerHeight(pixKeyLines) + L.safety;
  const sales: ChargeImageSale[] = [];
  let used = fixed;
  for (let index = 0; index < selection.sales.length; index++) {
    const sale = toSale(selection.sales[index]);
    const card = saleCardHeight(sale);
    const remaining = selection.sales.length - index - 1;
    const reserve = remaining > 0 ? hiddenSalesHeight() : 0;
    if (sales.length > 0 && used + card + reserve > CHARGE_IMAGE_MAX_HEIGHT) break;
    sales.push(sale);
    used += card;
  }
  const hiddenSales = selection.sales.length - sales.length;
  if (hiddenSales > 0) used += hiddenSalesHeight();
  return {
    workspaceName: sanitizeImageText(workspaceName),
    generatedAt: `Gerado em ${fmt(generatedAt, "dd/MM/yyyy")}`,
    total: formatChargeAmount(selection.totalCents),
    pixKey: cleanPix || null,
    pixKeyLines,
    sales,
    hiddenSales,
    height: Math.ceil(used),
  };
}
