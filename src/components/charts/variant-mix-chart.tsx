"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

type Slice = { label: string; revenueCents: number; qty: number };

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const COLORS = [
  "hsl(var(--primary))",
  "hsl(35 48% 70%)",
  "hsl(150 30% 34%)",
  "hsl(32 85% 48%)",
  "hsl(12 45% 70%)",
  "hsl(60 9% 30%)",
  "hsl(150 22% 58%)",
  "hsl(38 40% 82%)",
];

export function VariantMixChart({ data }: { data: Slice[] }) {
  // top 7 + "Outros"
  const top = data.slice(0, 7);
  const rest = data.slice(7);
  const slices = [...top];
  if (rest.length > 0) {
    slices.push({
      label: "Outros",
      revenueCents: rest.reduce((s, d) => s + d.revenueCents, 0),
      qty: rest.reduce((s, d) => s + d.qty, 0),
    });
  }

  const chartData = slices.map((s) => ({
    ...s,
    shortLabel: s.label,
  }));

  const height = Math.max(180, chartData.length * 36);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 0, right: 8, left: 4, bottom: 0 }}
        barCategoryGap="20%"
      >
        <XAxis
          type="number"
          dataKey="revenueCents"
          hide
        />
        <YAxis
          type="category"
          dataKey="shortLabel"
          width={108}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted)/0.3)" }}
          formatter={(v: number, _n, p) => [
            `${brl(v)} · ${p.payload.qty} un`,
            p.payload.label,
          ]}
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.5rem",
            fontSize: 12,
            color: "hsl(var(--popover-foreground))",
          }}
        />
        <Bar dataKey="revenueCents" radius={[0, 4, 4, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
