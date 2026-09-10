import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatBRL } from "@/lib/money";
import type { CustomerReport } from "@/server/queries/customers";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const BOTTOM = 56;

const COL_DATE_X = MARGIN;
const COL_DATE_W = 66;
const COL_PRODUCT_X = COL_DATE_X + COL_DATE_W + 10;
const COL_VALUE_RIGHT = PAGE_WIDTH - MARGIN;
const COL_VALUE_W = 76;
const COL_PRODUCT_W = COL_VALUE_RIGHT - COL_VALUE_W - 10 - COL_PRODUCT_X;

const INK = rgb(0.1, 0.09, 0.08);
const MUTED = rgb(0.42, 0.39, 0.36);
const RULE = rgb(0.82, 0.79, 0.75);

const REPLACEMENTS: Record<string, string> = {
  "\u00a0": " ",
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2026": "...",
};

function sanitize(value: string): string {
  return value
    .replace(/[\u00a0\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/g, (c) => REPLACEMENTS[c])
    .replace(/[^\u0020-\u00ff]/g, "");
}

function money(cents: number): string {
  return sanitize(formatBRL(cents));
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

type Cursor = { page: PDFPage; y: number };

type TextOptions = { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> };

export type CustomerReportPdfInput = {
  report: CustomerReport;
  fromLabel: string;
  toLabel: string;
  generatedAtLabel: string;
  saleDateLabels: Record<string, string>;
};

export async function buildCustomerReportPdf({
  report,
  fromLabel,
  toLabel,
  generatedAtLabel,
  saleDateLabels,
}: CustomerReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { customer, sales, totalCents, paidCents, pendingCents } = report;

  pdf.setTitle(sanitize(`Relatório de compras - ${customer.name}`));

  const cursor: Cursor = {
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN,
  };

  function text(value: string, x: number, y: number, opts: TextOptions = {}) {
    cursor.page.drawText(sanitize(value), {
      x,
      y,
      size: opts.size ?? 9.5,
      font: opts.font ?? regular,
      color: opts.color ?? INK,
    });
  }

  function rightText(value: string, right: number, y: number, opts: TextOptions = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.font ?? regular;
    const clean = sanitize(value);
    text(clean, right - font.widthOfTextAtSize(clean, size), y, opts);
  }

  function line(y: number) {
    cursor.page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.5,
      color: RULE,
    });
  }

  function drawTableHead() {
    text("DATA", COL_DATE_X, cursor.y, { size: 7.5, font: bold, color: MUTED });
    text("PRODUTO", COL_PRODUCT_X, cursor.y, { size: 7.5, font: bold, color: MUTED });
    rightText("VALOR", COL_VALUE_RIGHT, cursor.y, { size: 7.5, font: bold, color: MUTED });
    cursor.y -= 6;
    line(cursor.y);
    cursor.y -= 14;
  }

  function ensure(space: number, repeatHead: boolean) {
    if (cursor.y - space >= BOTTOM) return;
    cursor.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursor.y = PAGE_HEIGHT - MARGIN;
    if (repeatHead) drawTableHead();
  }

  text("RELATÓRIO DE COMPRAS", MARGIN, cursor.y, { size: 8, font: bold, color: MUTED });
  cursor.y -= 24;
  text(customer.name, MARGIN, cursor.y, { size: 18, font: bold });
  cursor.y -= 18;

  const meta = [
    customer.sector ? `Setor: ${customer.sector}` : null,
    customer.email ? `E-mail: ${customer.email}` : null,
    customer.phone ? `Telefone: ${customer.phone}` : null,
    `Período: ${fromLabel} a ${toLabel}`,
    `Gerado em: ${generatedAtLabel}`,
  ].filter((entry): entry is string => entry !== null);

  for (const entry of meta) {
    text(entry, MARGIN, cursor.y, { size: 9, color: MUTED });
    cursor.y -= 12;
  }

  cursor.y -= 6;
  line(cursor.y);
  cursor.y -= 20;

  if (sales.length === 0) {
    text("Nenhuma compra encontrada no período.", MARGIN, cursor.y, { color: MUTED });
  } else {
    drawTableHead();

    for (const sale of sales) {
      const itemLines = sale.items.flatMap((item) =>
        wrap(
          `${item.quantity}x ${item.productNameSnapshot}${
            item.flavorNameSnapshot ? ` - ${item.flavorNameSnapshot}` : ""
          }`,
          regular,
          9.5,
          COL_PRODUCT_W,
        ),
      );
      if (itemLines.length === 0) itemLines.push("-");
      const statusLine = sale.status === "PENDING";
      if (statusLine) itemLines.push("Em aberto");

      ensure(itemLines.length * 12 + 12, true);

      const top = cursor.y;
      text(saleDateLabels[sale.id] ?? "", COL_DATE_X, top);
      rightText(money(sale.totalCents), COL_VALUE_RIGHT, top);

      itemLines.forEach((entry, index) => {
        const isStatus = statusLine && index === itemLines.length - 1;
        text(entry, COL_PRODUCT_X, top - index * 12, {
          size: isStatus ? 8 : 9.5,
          color: isStatus ? MUTED : INK,
        });
      });

      cursor.y = top - (itemLines.length - 1) * 12 - 10;
      line(cursor.y);
      cursor.y -= 16;
    }

    ensure(72, false);
    cursor.y -= 4;

    const summary: [string, string, boolean][] = [
      [`Compras no período (${sales.length})`, money(totalCents), true],
      ["Pago", money(paidCents), false],
      ["Em aberto", money(pendingCents), false],
    ];

    for (const [label, value, strong] of summary) {
      text(label, MARGIN, cursor.y, {
        font: strong ? bold : regular,
        color: strong ? INK : MUTED,
      });
      rightText(value, COL_VALUE_RIGHT, cursor.y, { font: strong ? bold : regular });
      cursor.y -= 14;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const label = `${index + 1} de ${pages.length}`;
    page.drawText(label, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(label, 8),
      y: BOTTOM - 24,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return pdf.save();
}
