"use client";

import { CipriIcon, Ink, SceneHome, Tap, scribble, timing, type GuideStep } from "./guide-parts";

function ChromePage() {
  return (
    <g>
      <rect x={38} y={18} width={164} height={50} className="fill-card" />
      <line x1={38} y1={68} x2={202} y2={68} className="stroke-border" />
      <g className="fill-foreground/70">
        <rect x={50} y={23} width={14} height={3} rx={1.5} />
        <rect x={170} y={23} width={20} height={3} rx={1.5} />
      </g>
      <g className="fill-none stroke-foreground/70" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M45 54 l6 -5.5 l6 5.5 M47 52 v6 h8 v-6" />
        <rect x={160} y={46} width={11} height={11} rx={2.5} />
      </g>
      <text x={165.5} y={54.5} fontSize={6} fontWeight={700} textAnchor="middle" className="fill-foreground/70">
        1
      </text>
      <rect x={62} y={40} width={92} height={24} rx={12} className="fill-muted" />
      <text x={108} y={55} fontSize={8} textAnchor="middle" className="fill-foreground">
        cipri.app
      </text>
      <g className="fill-foreground/80">
        <circle cx={188} cy={46} r={1.6} />
        <circle cx={188} cy={52} r={1.6} />
        <circle cx={188} cy={58} r={1.6} />
      </g>
      <CipriIcon x={50} y={82} size={16} />
      <rect x={72} y={87} width={30} height={6} rx={3} className="fill-primary/80" />
      <rect x={50} y={110} width={112} height={9} rx={4.5} className="fill-foreground/80" />
      <rect x={50} y={124} width={78} height={9} rx={4.5} className="fill-foreground/80" />
      <rect x={50} y={144} width={140} height={66} rx={10} className="fill-card stroke-border" />
      <rect x={60} y={156} width={46} height={5} rx={2.5} className="fill-muted-foreground/40" />
      <rect x={60} y={168} width={70} height={12} rx={4} className="fill-primary" />
      <path d="M62 200 C 82 192, 96 198, 116 188 S 156 182, 180 172" className="fill-none stroke-success" strokeWidth={2} strokeLinecap="round" />
      <rect x={50} y={220} width={66} height={58} rx={10} className="fill-accent" />
      <rect x={124} y={220} width={66} height={58} rx={10} className="fill-secondary" />
      <rect x={58} y={258} width={34} height={8} rx={4} className="fill-accent-foreground/60" />
      <rect x={132} y={258} width={40} height={8} rx={4} className="fill-secondary-foreground/50" />
      <rect x={50} y={288} width={140} height={60} rx={10} className="fill-card stroke-border" />
      <rect x={100} y={375} width={40} height={3} rx={1.5} className="fill-foreground/40" />
    </g>
  );
}

function SceneMenu() {
  return (
    <g>
      <ChromePage />
      <Ink d={scribble(188, 52, 9, 15)} delay={0.5} duration={0.7} />
      <Ink d="M100 250 C 96 190, 150 120, 178 76" delay={1.1} duration={0.6} width={2.5} />
      <Ink d="M168 80 L 179 74 L 181 87" delay={1.6} duration={0.25} width={2.5} />
      <text
        x={74}
        y={268}
        fontSize={11}
        fontWeight={700}
        transform="rotate(-6 74 268)"
        className="pwa-fade fill-warning-text"
        style={timing(1.05)}
      >
        aqui!
      </text>
      <Tap x={188} y={52} delay={2} />
    </g>
  );
}

const menuRows = [
  "Nova guia",
  "Nova guia anônima",
  "Histórico",
  "Downloads",
  "Favoritos",
  "Compartilhar…",
  "Instalar app",
];

function SceneInstallItem() {
  const target = menuRows.length - 1;
  const rowY = (i: number) => 74 + i * 24;
  const targetY = rowY(target) + 12;
  return (
    <g>
      <ChromePage />
      <g className="pwa-menu">
        <rect x={92} y={36} width={106} height={rowY(menuRows.length) + 6 - 36} rx={10} className="fill-card stroke-border" />
        <g className="fill-none stroke-foreground/70" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M101 56 h10 M107 52 l4 4 l-4 4" />
          <path d="M126 50 l2 4.5 l5 0.5 l-3.8 3.2 l1.2 4.8 l-4.4 -2.6 l-4.4 2.6 l1.2 -4.8 l-3.8 -3.2 l5 -0.5 z" />
          <path d="M146 50 v9 M142 55 l4 4 l4 -4 M141 62 h10" />
          <circle cx={166} cy={56} r={5} />
          <path d="M190 52 a5.5 5.5 0 1 0 1 5 M191 49 v4 h-4" />
        </g>
        {menuRows.map((label, i) => {
          const y = rowY(i);
          const highlighted = i === target;
          return (
            <g key={label}>
              {highlighted && (
                <rect x={92} y={y} width={106} height={24} className="pwa-fade fill-warning/20" style={timing(1.3)} />
              )}
              {highlighted ? (
                <g className="fill-none stroke-foreground" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
                  <rect x={101} y={y + 6} width={8} height={12} rx={2} />
                  <path d={`M105 ${y + 9} v5 M103 ${y + 12} l2 2 l2 -2`} />
                </g>
              ) : (
                <rect x={101} y={y + 8} width={8} height={8} rx={2} className="fill-muted" />
              )}
              <text
                x={116}
                y={y + 15}
                fontSize={7.5}
                fontWeight={highlighted ? 600 : 400}
                className="fill-foreground"
              >
                {label}
              </text>
            </g>
          );
        })}
      </g>
      <Ink d={scribble(146, targetY, 56, 14)} delay={1.2} duration={0.9} />
      <Tap x={150} y={targetY} delay={2.2} />
    </g>
  );
}

function SceneConfirm() {
  return (
    <g>
      <ChromePage />
      <rect x={38} y={18} width={164} height={364} className="pwa-fade fill-foreground/30" style={timing(0)} />
      <g className="pwa-dialog">
        <rect x={50} y={136} width={140} height={128} rx={18} className="fill-card" />
        <CipriIcon x={106} y={148} size={28} round />
        <text x={120} y={194} fontSize={10} fontWeight={600} textAnchor="middle" className="fill-foreground">
          Instalar app
        </text>
        <text x={120} y={208} fontSize={8} textAnchor="middle" className="fill-foreground">
          Cipri
        </text>
        <text x={120} y={219} fontSize={6.5} textAnchor="middle" className="fill-muted-foreground">
          cipri.app
        </text>
        <text x={128} y={248} fontSize={8} fontWeight={600} textAnchor="end" className="fill-primary">
          Cancelar
        </text>
        <rect x={138} y={236} width={44} height={18} rx={9} className="fill-primary" />
        <text x={160} y={248} fontSize={8} fontWeight={600} textAnchor="middle" className="fill-primary-foreground">
          Instalar
        </text>
      </g>
      <Ink d={scribble(160, 245, 30, 15)} delay={0.8} duration={0.8} />
      <Ink d="M96 330 C 120 316, 156 300, 160 270" delay={1.4} duration={0.55} width={2.5} />
      <Ink d="M152 278 L 160 268 L 167 279" delay={1.9} duration={0.25} width={2.5} />
      <Tap x={160} y={245} delay={2.3} />
    </g>
  );
}

export const androidSteps: GuideStep[] = [
  {
    title: "Abra o menu do Chrome",
    description: (
      <>
        No Chrome, toque nos três pontinhos{" "}
        <strong className="font-semibold text-foreground">⋮</strong> no canto de cima, ao lado do
        endereço.
      </>
    ),
    Scene: SceneMenu,
  },
  {
    title: "Toque em Instalar app",
    description: (
      <>
        No menu, toque em <strong className="font-semibold text-foreground">Instalar app</strong>.
        Em algumas versões aparece como{" "}
        <strong className="font-semibold text-foreground">Adicionar à tela inicial</strong>.
      </>
    ),
    Scene: SceneInstallItem,
  },
  {
    title: "Confirme em Instalar",
    description: (
      <>
        Na janela que abrir, toque em{" "}
        <strong className="font-semibold text-foreground">Instalar</strong>. Em segundos o Cipri
        vai para a tela inicial.
      </>
    ),
    Scene: SceneConfirm,
  },
  {
    title: "Pronto, o Cipri virou app",
    description: "Abra pelo ícone na tela inicial: tela cheia, mais rápido e sempre à mão.",
    Scene: () => <SceneHome variant="android" />,
  },
];
