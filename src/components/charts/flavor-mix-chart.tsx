"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

type Slice = { label: string; revenueCents: number; qty: number };

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

// Paleta cookie/chocolate/caramelo
const COLORS = [
  "hsl(25 45% 38%)",
  "hsl(22 40% 28%)",
  "hsl(33 55% 60%)",
  "hsl(38 70% 55%)",
  "hsl(15 45% 45%)",
  "hsl(43 50% 70%)",
  "hsl(8 40% 35%)",
  "hsl(30 25% 55%)",
];

export function FlavorMixChart({ data }: { data: Slice[] }) {
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

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="revenueCents"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={48}
          outerRadius={88}
          paddingAngle={2}
          stroke="hsl(var(--card))"
          strokeWidth={2}
        >
          {slices.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number, _n, p) =>
            [`${brl(v)} · ${p.payload.qty} un`, p.payload.label]
          }
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "0.5rem",
            fontSize: 12,
            color: "hsl(var(--popover-foreground))",
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          formatter={(value) => (
            <span style={{ color: "hsl(var(--muted-foreground))" }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
