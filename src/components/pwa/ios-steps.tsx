"use client";

import { CipriIcon, Ink, SceneHome, Tap, scribble, timing, type GuideStep } from "./guide-parts";

function SafariPage() {
  return (
    <g>
      <CipriIcon x={50} y={50} size={16} />
      <rect x={72} y={55} width={30} height={6} rx={3} className="fill-primary/80" />
      <rect x={50} y={78} width={112} height={9} rx={4.5} className="fill-foreground/80" />
      <rect x={50} y={92} width={78} height={9} rx={4.5} className="fill-foreground/80" />
      <rect x={50} y={112} width={140} height={66} rx={10} className="fill-card stroke-border" />
      <rect x={60} y={124} width={46} height={5} rx={2.5} className="fill-muted-foreground/40" />
      <rect x={60} y={136} width={70} height={12} rx={4} className="fill-primary" />
      <path d="M62 168 C 82 160, 96 166, 116 156 S 156 150, 180 140" className="fill-none stroke-success" strokeWidth={2} strokeLinecap="round" />
      <rect x={50} y={188} width={66} height={58} rx={10} className="fill-accent" />
      <rect x={124} y={188} width={66} height={58} rx={10} className="fill-secondary" />
      <rect x={58} y={226} width={34} height={8} rx={4} className="fill-accent-foreground/60" />
      <rect x={132} y={226} width={40} height={8} rx={4} className="fill-secondary-foreground/50" />
      <rect x={50} y={256} width={140} height={34} rx={10} className="fill-card stroke-border" />
      <rect x={38} y={302} width={164} height={80} className="fill-card" />
      <line x1={38} y1={302} x2={202} y2={302} className="stroke-border" />
      <rect x={50} y={311} width={140} height={26} rx={13} className="fill-muted" />
      <text x={120} y={327} textAnchor="middle" fontSize={8.5} className="fill-foreground">
        cipri.app
      </text>
      <g className="fill-none stroke-foreground/70" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M62 351 l-5 5 l5 5" />
        <path d="M88 351 l5 5 l-5 5" className="stroke-foreground/30" />
        <path d="M115 354 h-3 v11 h16 v-11 h-3 M120 359 v-13 M116 350 l4 -4 l4 4" />
        <path d="M146 350 v12 c3 -2 7 -2 10 0 v-12 c-3 -2 -7 -2 -10 0" />
        <rect x={176} y={351} width={10} height={10} rx={2} />
        <path d="M179 348 h7 a3 3 0 0 1 3 3 v7" />
      </g>
    </g>
  );
}

function SceneShare() {
  return (
    <g>
      <SafariPage />
      <Ink d={scribble(120, 356, 16, 14)} delay={0.5} duration={0.8} />
      <Ink d="M184 258 C 204 292, 180 330, 142 348" delay={1.15} duration={0.6} width={2.5} />
      <Ink d="M152 340 L 141 349 L 155 352" delay={1.65} duration={0.25} width={2.5} />
      <text
        x={170}
        y={250}
        fontSize={11}
        fontWeight={700}
        transform="rotate(-8 170 250)"
        className="pwa-fade fill-warning-text"
        style={timing(1.1)}
      >
        aqui!
      </text>
      <Tap x={120} y={356} delay={2} />
    </g>
  );
}

const shareRows = [
  "Copiar",
  "Adicionar à Lista de Leitura",
  "Adicionar aos Favoritos",
  "Adicionar à Tela de Início",
  "Buscar na Página",
];

function SceneSheet() {
  const target = 3;
  return (
    <g>
      <g opacity={0.5}>
        <SafariPage />
      </g>
      <rect x={38} y={18} width={164} height={364} className="pwa-fade fill-foreground/25" style={timing(0)} />
      <g className="pwa-sheet">
        <rect x={38} y={118} width={164} height={290} rx={18} className="fill-card" />
        <rect x={108} y={125} width={24} height={4} rx={2} className="fill-muted-foreground/40" />
        <CipriIcon x={50} y={138} size={22} />
        <text x={80} y={148} fontSize={9} fontWeight={600} className="fill-foreground">
          Cipri
        </text>
        <rect x={80} y={153} width={46} height={4} rx={2} className="fill-muted-foreground/40" />
        {[62, 96, 130, 164].map((cx, i) => (
          <circle key={cx} cx={cx} cy={182} r={12} className={i === 0 ? "fill-accent" : "fill-muted"} />
        ))}
        <g className="pwa-scroll">
          <rect x={46} y={206} width={148} height={shareRows.length * 26} rx={10} className="fill-background" />
          {shareRows.map((label, i) => {
            const y = 206 + i * 26;
            const highlighted = i === target;
            return (
              <g key={label}>
                {highlighted && (
                  <rect x={46} y={y} width={148} height={26} className="pwa-fade fill-warning/20" style={timing(1.4)} />
                )}
                {i > 0 && <line x1={54} y1={y} x2={194} y2={y} className="stroke-border" />}
                <text
                  x={54}
                  y={y + 16}
                  fontSize={7.5}
                  fontWeight={highlighted ? 600 : 400}
                  className="fill-foreground"
                >
                  {label}
                </text>
                {highlighted ? (
                  <g className="fill-none stroke-foreground" strokeWidth={1.3} strokeLinecap="round">
                    <rect x={176} y={y + 7.5} width={11} height={11} rx={3} />
                    <path d={`M181.5 ${y + 10.5} v5 M179 ${y + 13} h5`} />
                  </g>
                ) : (
                  <rect x={177} y={y + 8.5} width={9} height={9} rx={2.5} className="fill-muted" />
                )}
              </g>
            );
          })}
        </g>
      </g>
      <Ink d={scribble(118, 297, 78, 15)} delay={1.25} duration={0.9} />
      <Tap x={150} y={297} delay={2.2} />
    </g>
  );
}

function SceneConfirm() {
  return (
    <g>
      <rect x={38} y={18} width={164} height={364} className="fill-muted" />
      <g className="pwa-fade" style={timing(0)}>
        <text x={48} y={64} fontSize={7.5} className="fill-primary">
          Cancelar
        </text>
        <text x={118} y={64} fontSize={7} fontWeight={600} textAnchor="middle" className="fill-foreground">
          Tela de Início
        </text>
        <text x={192} y={64} fontSize={8} fontWeight={700} textAnchor="end" className="fill-primary">
          Adicionar
        </text>
        <rect x={46} y={84} width={148} height={66} rx={12} className="fill-card" />
        <CipriIcon x={56} y={97} size={40} />
        <text x={106} y={113} fontSize={10} fontWeight={600} className="fill-foreground">
          Cipri
        </text>
        <line x1={106} y1={119} x2={184} y2={119} className="stroke-border" />
        <text x={106} y={134} fontSize={7} className="fill-muted-foreground">
          cipri.app
        </text>
        <rect x={46} y={160} width={148} height={30} rx={10} className="fill-card" />
        <text x={56} y={178} fontSize={7.5} className="fill-foreground">
          Abrir como App Web
        </text>
        <rect x={164} y={168.5} width={22} height={13} rx={6.5} className="fill-success" />
        <circle cx={179.5} cy={175} r={5} fill="#fff" />
        <rect x={50} y={200} width={128} height={4} rx={2} className="fill-muted-foreground/30" />
        <rect x={50} y={209} width={96} height={4} rx={2} className="fill-muted-foreground/30" />
      </g>
      <Ink d={scribble(175, 61, 23, 11)} delay={0.6} duration={0.8} />
      <Ink d="M150 240 C 196 226, 204 150, 186 82" delay={1.2} duration={0.7} width={2.5} />
      <Ink d="M180 92 L 186 81 L 193 91" delay={1.85} duration={0.25} width={2.5} />
      <Tap x={175} y={61} delay={2.2} />
    </g>
  );
}


export const iosSteps: GuideStep[] = [
  {
    title: "Toque em Compartilhar",
    description: (
      <>
        No Safari, toque no ícone de compartilhar na barra de baixo. Se ele não aparecer, toque
        antes em <strong className="font-semibold text-foreground">•••</strong>.
      </>
    ),
    Scene: SceneShare,
  },
  {
    title: "Adicionar à Tela de Início",
    description: (
      <>
        Role a lista de opções e toque em{" "}
        <strong className="font-semibold text-foreground">Adicionar à Tela de Início</strong>.
      </>
    ),
    Scene: SceneSheet,
  },
  {
    title: "Confirme em Adicionar",
    description: (
      <>
        Deixe <strong className="font-semibold text-foreground">Abrir como App Web</strong> ligado
        e toque em <strong className="font-semibold text-foreground">Adicionar</strong>, no canto
        de cima.
      </>
    ),
    Scene: SceneConfirm,
  },
  {
    title: "Pronto, o Cipri virou app",
    description: "Abra pelo ícone na tela de início: tela cheia, mais rápido e sempre à mão.",
    Scene: () => <SceneHome variant="ios" />,
  },
];
