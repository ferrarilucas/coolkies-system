"use client";

import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const MAX_CENTS = 99999999; // R$ 999.999,99

function formatDisplay(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

interface MoneyInputBaseProps {
  className?: string;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
}

// Modo não-controlado: submete via FormData com campo oculto
interface UncontrolledProps extends MoneyInputBaseProps {
  name: string;
  defaultValueCents?: number;
  valueCents?: never;
  onChangeCents?: never;
}

// Modo controlado: estado gerenciado pelo pai
interface ControlledProps extends MoneyInputBaseProps {
  name?: never;
  defaultValueCents?: never;
  valueCents: number;
  onChangeCents: (cents: number) => void;
}

type MoneyInputProps = UncontrolledProps | ControlledProps;

export function MoneyInput({
  name,
  defaultValueCents = 0,
  valueCents,
  onChangeCents,
  className,
  autoFocus,
  id,
  disabled,
}: MoneyInputProps) {
  const isControlled = valueCents !== undefined;
  const [internalCents, setInternalCents] = useState(defaultValueCents);
  const cents = isControlled ? valueCents : internalCents;

  // Sincroniza estado interno quando o pai atualiza (modo controlado)
  useEffect(() => {
    if (isControlled) setInternalCents(valueCents);
  }, [isControlled, valueCents]);

  function setCents(updater: (prev: number) => number) {
    const next = updater(cents);
    if (isControlled) {
      onChangeCents!(next);
    } else {
      setInternalCents(next);
    }
  }

  // Extrai apenas os dígitos do que está no campo e interpreta como centavos.
  // Funciona com teclado virtual (mobile) e físico, pois reage ao evento
  // `input`/`change` em vez de `keydown` — e o campo NÃO é readOnly, então o
  // teclado numérico abre normalmente no celular.
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return;
    const digits = e.target.value.replace(/\D/g, "");
    const parsed = digits ? Number.parseInt(digits, 10) : 0;
    setCents(() => (parsed > MAX_CENTS ? cents : parsed));
  }

  // Seleciona tudo ao focar: digitar substitui o valor de forma previsível.
  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.target.select();
  }

  return (
    <>
      {!isControlled && <input type="hidden" name={name} value={internalCents} />}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={formatDisplay(cents)}
        onChange={handleChange}
        onFocus={handleFocus}
        autoFocus={autoFocus}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring focus-visible:ring-offset-2 tabular-nums",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
    </>
  );
}
