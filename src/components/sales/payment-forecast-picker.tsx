"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  nextDayFive,
  fifthBusinessDay,
  type ForecastPreset,
} from "@/lib/business-days";

type PayState = "PAID" | ForecastPreset;

/**
 * Demonstra a regra de negócio de previsão de pagamento.
 * Em produção, este valor alimenta os campos `status`, `paymentForecastDate`
 * e `forecastPreset` da venda.
 */
export function PaymentForecastPicker() {
  const [state, setState] = useState<PayState>("PAID");
  const [custom, setCustom] = useState<string>("");

  const forecast =
    state === "DAY_FIVE"
      ? nextDayFive()
      : state === "FIFTH_BUSINESS_DAY"
        ? fifthBusinessDay()
        : state === "CUSTOM" && custom
          ? new Date(`${custom}T12:00:00`)
          : null;

  const options: Array<{ key: PayState; label: string }> = [
    { key: "PAID", label: "Pago agora" },
    { key: "DAY_FIVE", label: "Dia 5" },
    { key: "FIFTH_BUSINESS_DAY", label: "5º dia útil" },
    { key: "CUSTOM", label: "Data personalizada" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            variant={state === key ? "default" : "outline"}
            className={cn("justify-start", state === key && "ring-1 ring-ring")}
            onClick={() => setState(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {state === "CUSTOM" ? (
        <input
          type="date"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      ) : null}

      {state !== "PAID" && forecast ? (
        <p className="text-sm text-muted-foreground">
          Previsão de recebimento:{" "}
          <span className="font-medium text-foreground">
            {format(forecast, "PPP", { locale: ptBR })}
          </span>
        </p>
      ) : null}
    </div>
  );
}
