"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type GuideStep = {
  title: string;
  description: ReactNode;
  Scene: () => ReactNode;
};

export function timing(delay: number, duration?: number): CSSProperties {
  return {
    "--delay": `${delay}s`,
    ...(duration ? { "--dur": `${duration}s` } : {}),
  } as CSSProperties;
}

export function scribble(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M ${cx - rx * 0.9} ${cy - ry * 0.35}`,
    `C ${cx - rx * 0.8} ${cy - ry * 1.25}, ${cx + rx * 0.85} ${cy - ry * 1.3}, ${cx + rx * 1.02} ${cy - ry * 0.1}`,
    `C ${cx + rx * 1.15} ${cy + ry * 0.9}, ${cx + rx * 0.1} ${cy + ry * 1.2}, ${cx - rx * 0.6} ${cy + ry * 0.95}`,
    `C ${cx - rx * 1.25} ${cy + ry * 0.6}, ${cx - rx * 1.1} ${cy - ry * 0.75}, ${cx - rx * 0.25} ${cy - ry * 1.12}`,
  ].join(" ");
}

export function Ink({
  d,
  delay,
  duration,
  width = 3,
}: {
  d: string;
  delay: number;
  duration?: number;
  width?: number;
}) {
  return (
    <path
      d={d}
      pathLength={1}
      className="pwa-draw fill-none stroke-warning"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={timing(delay, duration)}
    />
  );
}

export function Tap({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} className="pwa-tap fill-warning/50" style={timing(delay)} />
      <circle cx={x} cy={y} r={6} className="pwa-press fill-warning" style={timing(delay)} />
    </g>
  );
}

export function CipriIcon({
  x,
  y,
  size,
  round = false,
  className,
  style,
}: {
  x: number;
  y: number;
  size: number;
  round?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const s = (size * 0.6) / 108;
  const tx = x + (size - 98 * s) / 2 - 65 * s;
  const ty = y + (size - 108 * s) / 2 - 47 * s;
  return (
    <g className={className} style={style}>
      <rect x={x} y={y} width={size} height={size} rx={round ? size / 2 : size * 0.23} fill="#0F3D34" />
      <g transform={`translate(${tx} ${ty}) scale(${s})`}>
        <path
          d="M65.875,99.545C66.594,95.722 68.312,79.487 84.87,66.999C101.576,54.4 136.517,51.968 132.248,74.455C128.897,92.11 113.527,78.202 101.592,88.613C81.275,106.337 103.455,135.603 126.418,123.346C136.998,117.698 137.513,105.222 148.465,116.534C154.024,122.275 157.184,124.022 155.028,128.265C142.109,153.693 91.774,166.117 70.789,127.342C65.261,117.129 65.796,101.802 65.875,99.545Z"
          fill="#F4F4EC"
        />
        <path
          d="M140.263,69.601C134.886,50.913 154.36,45.348 163.214,53.806C177.946,67.878 152.073,91.414 140.263,69.601Z"
          fill="#FCBB42"
        />
      </g>
    </g>
  );
}

export type PhoneVariant = "ios" | "android";

export function Phone({
  variant,
  children,
}: {
  variant: PhoneVariant;
  children: ReactNode;
}) {
  const clipId = useId();
  const ios = variant === "ios";
  return (
    <svg
      viewBox="0 0 240 400"
      className="h-full w-auto overflow-visible drop-shadow-xl"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={38} y={18} width={164} height={364} rx={ios ? 24 : 16} />
        </clipPath>
      </defs>
      <rect
        x={30}
        y={10}
        width={180}
        height={380}
        rx={ios ? 32 : 22}
        className="fill-card stroke-primary"
        strokeWidth={2.5}
      />
      {!ios && (
        <>
          <rect x={210} y={92} width={3} height={34} rx={1.5} className="fill-primary" />
          <rect x={210} y={136} width={3} height={20} rx={1.5} className="fill-primary" />
        </>
      )}
      <g clipPath={`url(#${clipId})`}>
        <rect x={38} y={18} width={164} height={364} className="fill-background" />
        {children}
      </g>
      {ios ? (
        <rect x={96} y={25} width={48} height={13} rx={6.5} className="fill-foreground" />
      ) : (
        <circle cx={120} cy={28} r={4.5} className="fill-foreground" />
      )}
    </svg>
  );
}

const homeSlots = Array.from({ length: 16 }, (_, i) => ({
  x: 50 + (i % 4) * 38,
  y: 60 + Math.floor(i / 4) * 46,
  i,
}));

function Slot({
  variant,
  x,
  y,
  size,
  className,
}: {
  variant: PhoneVariant;
  x: number;
  y: number;
  size: number;
  className: string;
}) {
  return variant === "ios" ? (
    <rect x={x} y={y} width={size} height={size} rx={size / 4} className={className} />
  ) : (
    <circle cx={x + size / 2} cy={y + size / 2} r={size / 2} className={className} />
  );
}

export function SceneHome({ variant }: { variant: PhoneVariant }) {
  const ios = variant === "ios";
  const cipriSlot = 9;
  const { x, y } = homeSlots[cipriSlot];
  return (
    <g>
      <rect x={38} y={18} width={164} height={364} className="fill-primary/10" />
      <circle cx={70} cy={330} r={70} className="fill-warning/15" />
      <circle cx={190} cy={70} r={50} className="fill-success/10" />
      {homeSlots.map((slot) =>
        slot.i === cipriSlot ? null : (
          <g key={slot.i} className="pwa-fade" style={timing(slot.i * 0.03)}>
            <Slot
              variant={variant}
              x={slot.x}
              y={slot.y}
              size={28}
              className={cn(
                slot.i % 3 === 0 ? "fill-card" : slot.i % 3 === 1 ? "fill-muted" : "fill-secondary",
              )}
            />
            <rect x={slot.x + 6} y={slot.y + 33} width={16} height={3} rx={1.5} className="fill-foreground/20" />
          </g>
        ),
      )}
      <circle cx={x + 14} cy={y + 14} r={24} className="pwa-glow fill-warning/30" style={timing(0.9)} />
      <g className="pwa-pop" style={timing(0.4)}>
        <CipriIcon x={x} y={y} size={28} round={!ios} />
        <text x={x + 14} y={y + 38} fontSize={6.5} fontWeight={600} textAnchor="middle" className="fill-foreground">
          Cipri
        </text>
      </g>
      <Ink d={`M${x - 10} ${y - 12} v10 M${x - 15} ${y - 7} h10`} delay={1.0} duration={0.3} width={2.2} />
      <Ink d={`M${x + 40} ${y - 4} v7 M${x + 36.5} ${y - 0.5} h7`} delay={1.15} duration={0.3} width={2} />
      <Ink d={`M${x + 38} ${y + 30} v6 M${x + 35} ${y + 33} h6`} delay={1.3} duration={0.3} width={1.8} />
      <Ink d={`M${x - 12} ${y + 48} C ${x + 2} ${y + 58}, ${x + 26} ${y + 58}, ${x + 40} ${y + 46}`} delay={1.45} duration={0.5} />
      {ios ? (
        <>
          <rect x={46} y={338} width={148} height={34} rx={14} className="fill-card/70" />
          {[56, 92, 128, 164].map((dx) => (
            <rect key={dx} x={dx} y={342} width={26} height={26} rx={7} className="fill-muted" />
          ))}
        </>
      ) : (
        <>
          {[56, 92, 128, 164].map((dx) => (
            <circle key={dx} cx={dx + 13} cy={318} r={13} className="fill-muted" />
          ))}
          <rect x={50} y={342} width={140} height={24} rx={12} className="fill-card/80" />
          <circle cx={64} cy={354} r={5} className="fill-none stroke-muted-foreground/60" strokeWidth={1.5} />
          <rect x={100} y={375} width={40} height={3} rx={1.5} className="fill-foreground/40" />
        </>
      )}
    </g>
  );
}
