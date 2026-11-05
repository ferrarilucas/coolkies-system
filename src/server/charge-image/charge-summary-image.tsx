import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import {
  CHARGE_IMAGE_WIDTH,
  L,
  buildChargeImageModel,
  moreInstallmentsLabel,
  moreItemsLabel,
  moreSalesLabel,
  type ChargeImageInput,
  type ChargeImageModel,
} from "./layout";

export { CHARGE_IMAGE_WIDTH, buildChargeImageModel, type ChargeImageInput, type ChargeImageModel } from "./layout";

const COLORS = {
  page: "#F7F4ED",
  card: "#FFFDF8",
  border: "#E8DCC6",
  lift: "#E2D2B6",
  sand: "#D7B98E",
  ink: "#25251F",
  muted: "#6B6558",
  primary: "#C94F32",
  primaryDark: "#A63E25",
  primarySoft: "#FBE7DF",
  onPrimary: "#F7F4ED",
  onPrimaryMuted: "#F3D9CC",
};

const FONT_FAMILY = "Sora, SoraExt";
const FONT_DIR = path.join(process.cwd(), "src/server/charge-image/fonts");
const WORDMARK_PATH = path.join(process.cwd(), "public/brand/cipri-wordmark-reverse.svg");

type FontEntry = { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" };

export type ChargeImageAssets = { fonts: FontEntry[]; logo: string | null };

let fontsPromise: Promise<FontEntry[]> | null = null;
let logoPromise: Promise<string | null> | null = null;
let logoFailureLogged = false;

async function loadFont(file: string, name: "Sora" | "SoraExt", weight: 400 | 600): Promise<FontEntry> {
  const buffer = await readFile(path.join(FONT_DIR, file));
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return { name, data, weight, style: "normal" };
}

export function loadChargeImageFonts(): Promise<FontEntry[]> {
  fontsPromise ??= Promise.all([
    loadFont("sora-400-latin.woff", "Sora", 400),
    loadFont("sora-600-latin.woff", "Sora", 600),
    loadFont("sora-400-latin-ext.woff", "SoraExt", 400),
    loadFont("sora-600-latin-ext.woff", "SoraExt", 600),
  ]).catch((error) => {
    fontsPromise = null;
    throw error;
  });
  return fontsPromise;
}

export function loadChargeImageLogo(file: string = WORDMARK_PATH): Promise<string | null> {
  logoPromise ??= readFile(file)
    .then((buffer) => {
      logoFailureLogged = false;
      return `data:image/svg+xml;base64,${buffer.toString("base64")}`;
    })
    .catch((error) => {
      logoPromise = null;
      if (!logoFailureLogged) {
        logoFailureLogged = true;
        console.error("[charge-image] wordmark indisponível, gerando sem logo", error);
      }
      return null;
    });
  return logoPromise;
}

export function resetChargeImageAssetCache(): void {
  fontsPromise = null;
  logoPromise = null;
  logoFailureLogged = false;
}

export async function loadChargeImageAssets(): Promise<ChargeImageAssets> {
  const [fonts, logo] = await Promise.all([loadChargeImageFonts(), loadChargeImageLogo()]);
  return { fonts, logo };
}

function clamp(lines: number) {
  return { display: "block", lineClamp: lines, overflow: "hidden", wordBreak: "break-word" } as const;
}

export function ChargeSummaryImage({ model, logo }: { model: ChargeImageModel; logo: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: L.pagePadding,
        backgroundColor: COLORS.page,
        fontFamily: FONT_FAMILY,
        color: COLORS.ink,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          padding: `${L.headerPaddingY}px ${L.headerPaddingX}px`,
          backgroundColor: COLORS.primary,
          borderRadius: L.headerRadius,
          color: COLORS.onPrimary,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: L.logoHeight }}>
          {logo ? (
            <div
              style={{
                display: "flex",
                width: L.logoWidth,
                height: L.logoHeight,
                backgroundImage: `url(${logo})`,
                backgroundSize: `${L.logoWidth}px ${L.logoHeight}px`,
                backgroundRepeat: "no-repeat",
              }}
            />
          ) : (
            <div style={{ display: "flex", width: L.logoWidth, height: L.logoHeight }} />
          )}
          <div
            style={{
              display: "flex",
              fontSize: 22,
              lineHeight: 1.3,
              fontWeight: 600,
              color: COLORS.onPrimary,
              backgroundColor: "rgba(37, 37, 31, 0.18)",
              borderRadius: 999,
              padding: "10px 22px",
            }}
          >
            {model.generatedAt}
          </div>
        </div>
        <div
          style={{
            ...clamp(1),
            marginTop: L.titleGap,
            fontSize: L.titleSize,
            lineHeight: L.titleLineHeight,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          Resumo das compras
        </div>
        <div
          style={{
            ...clamp(L.workspaceLines),
            marginTop: L.workspaceGap,
            fontSize: L.workspaceSize,
            lineHeight: L.workspaceLineHeight,
            color: COLORS.onPrimaryMuted,
          }}
        >
          {model.workspaceName}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 1,
          minHeight: 0,
          overflow: "hidden",
          paddingTop: L.listGap,
        }}
      >
        {model.sales.map((sale) => (
          <div
            key={sale.id}
            style={{
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              marginBottom: L.cardGap,
              padding: `${L.cardPaddingY}px ${L.cardPaddingX}px`,
              backgroundColor: COLORS.card,
              border: `${L.cardBorder}px solid ${COLORS.border}`,
              borderBottom: `${L.cardBorder + L.cardLift}px solid ${COLORS.lift}`,
              borderRadius: L.cardRadius,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: L.saleHeadSize,
                lineHeight: L.saleHeadLineHeight,
                fontWeight: 600,
              }}
            >
              <span>{sale.date}</span>
              <span>{sale.total}</span>
            </div>
            {sale.items.map((item) => (
              <div
                key={item.id}
                style={{
                  ...clamp(L.itemLines),
                  marginTop: L.itemGap,
                  fontSize: L.itemSize,
                  lineHeight: L.itemLineHeight,
                  color: COLORS.muted,
                }}
              >
                {item.label}
              </div>
            ))}
            {sale.hiddenItems > 0 && (
              <div
                style={{
                  ...clamp(1),
                  marginTop: L.itemGap,
                  fontSize: L.itemSize,
                  lineHeight: L.itemLineHeight,
                  color: COLORS.muted,
                  fontWeight: 600,
                }}
              >
                {moreItemsLabel(sale.hiddenItems)}
              </div>
            )}
            {sale.installments.length > 0 && <div style={{ display: "flex", height: L.pillFirstGap - L.pillGap }} />}
            {sale.installments.map((inst) => (
              <div key={inst.id} style={{ display: "flex", marginTop: L.pillGap }}>
                <div
                  style={{
                    ...clamp(1),
                    fontSize: L.pillSize,
                    lineHeight: L.pillLineHeight,
                    fontWeight: 600,
                    color: COLORS.primaryDark,
                    backgroundColor: COLORS.primarySoft,
                    borderRadius: 999,
                    padding: `${L.pillPaddingY}px ${L.pillPaddingX}px`,
                  }}
                >
                  {inst.label}
                </div>
              </div>
            ))}
            {sale.hiddenInstallments > 0 && (
              <div
                style={{
                  ...clamp(1),
                  marginTop: L.pillGap,
                  fontSize: L.moreSize,
                  lineHeight: L.moreLineHeight,
                  fontWeight: 600,
                  color: COLORS.primaryDark,
                }}
              >
                {moreInstallmentsLabel(sale.hiddenInstallments)}
              </div>
            )}
          </div>
        ))}
        {model.hiddenSales > 0 && (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              justifyContent: "center",
              marginBottom: L.cardGap,
              padding: `${L.hiddenSalesPaddingY}px 32px`,
              fontSize: L.hiddenSalesSize,
              lineHeight: L.hiddenSalesLineHeight,
              fontWeight: 600,
              color: COLORS.muted,
              border: `2px dashed ${COLORS.sand}`,
              borderRadius: L.cardRadius,
            }}
          >
            {moreSalesLabel(model.hiddenSales)}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          marginTop: L.footerGap,
          padding: `${L.footerPaddingY}px ${L.footerPaddingX}px`,
          backgroundColor: COLORS.card,
          border: `${L.footerBorder}px solid ${COLORS.sand}`,
          borderRadius: L.footerRadius,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: L.totalSize * L.totalLineHeight }}>
          <span style={{ fontSize: 30, fontWeight: 600, color: COLORS.ink }}>Total</span>
          <span style={{ fontSize: L.totalSize, lineHeight: L.totalLineHeight, fontWeight: 600, color: COLORS.primary, letterSpacing: -1 }}>
            {model.total}
          </span>
        </div>
        {model.pixKey && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: L.pixGap,
              padding: `${L.pixPaddingY}px ${L.pixPaddingX}px`,
              backgroundColor: COLORS.page,
              borderRadius: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: L.pixLabelSize,
                lineHeight: L.pixLabelLineHeight,
                fontWeight: 600,
                letterSpacing: 2,
                color: COLORS.primary,
              }}
            >
              PIX
            </div>
            <div
              style={{
                ...clamp(L.pixKeyMaxLines),
                marginTop: L.pixLabelGap,
                fontSize: L.pixKeySize,
                lineHeight: L.pixKeyLineHeight,
                fontWeight: 600,
                wordBreak: "break-all",
              }}
            >
              {model.pixKey}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function createChargeImageResponse(input: ChargeImageInput, assets: ChargeImageAssets) {
  const model = buildChargeImageModel(input);
  const response = new ImageResponse(<ChargeSummaryImage model={model} logo={assets.logo} />, {
    width: CHARGE_IMAGE_WIDTH,
    height: model.height,
    fonts: assets.fonts,
  });
  return { response, model };
}
