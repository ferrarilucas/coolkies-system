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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.ctrlKey || e.metaKey) return;

    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      const digit = Number(e.key);
      setCents((prev) => {
        const next = prev * 10 + digit;
        return next > MAX_CENTS ? prev : next;
      });
    } else if (e.key === "Backspace") {
      e.preventDefault();
      setCents((prev) => Math.floor(prev / 10));
    } else if (e.key === "Delete") {
      e.preventDefault();
      setCents(() => 0);
    } else {
      e.preventDefault();
    }
  }

  function handleBeforeInput(e: InputEvent) {
    if (disabled) return;
    e.preventDefault();
    const char = e.data;
    if (char && char >= "0" && char <= "9") {
      const digit = Number(char);
      setCents((prev) => {
        const next = prev * 10 + digit;
        return next > MAX_CENTS ? prev : next;
      });
    }
  }

  return (
    <>
      {!isControlled && <input type="hidden" name={name} value={internalCents} />}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        readOnly
        disabled={disabled}
        value={formatDisplay(cents)}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput as unknown as React.FormEventHandler<HTMLInputElement>}
        autoFocus={autoFocus}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring focus-visible:ring-offset-2 tabular-nums cursor-text",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
    </>
  );
}
